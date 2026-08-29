/**
 * The domain hierarchy, indexed once and asked everywhere.
 *
 * "branding sits under design" is one question, and this class is the only place that
 * answers it client-side. Before it, the same traversal lived in five places — the tree
 * rebuilt its own index on every render, the panels re-walked the graph per row, and
 * whoever needed a delegation's ancestors wrote the slice by hand.
 *
 * The complement to the on-chain verification (ADR 0003): the MultiVault has no reverse
 * index, so the contract can never discover intermediate nodes and the redeemer must
 * supply the path as a witness. Discovery happens here, verification happens there — so
 * every path this class produces is one the enforcer and the governor will accept.
 */
import type { Hex } from "viem";

import type { DomainNode, EdgeState, PathResult, PathStep } from "./graph";

/** Root of the governance hierarchy — every domain path climbs to it. */
export const ROOT_DOMAIN = "governance";

/** Separator in the manifest's `child->parent` triple keys. */
export const EDGE_KEY_SEPARATOR = "->";

/**
 * The governor's own bounds, read from chain rather than copied (see `readGraphLimits`).
 * They exist here so the UI can refuse a path the contract would reject anyway, never as
 * a substitute for the on-chain check.
 */
export interface GraphLimits {
  /** `MockGovernor.MAX_DOMAIN_PATH` — longest domain path a voter may present. */
  maxDomainPath: number;
}

/** One node of the rendered hierarchy. */
export interface TreeNode {
  label: string;
  children: TreeNode[];
  /** False when the edge that attaches this node authorizes nothing (ADR 0004). */
  usable: boolean;
}

export class DomainGraph {
  private constructor(
    private readonly nodes: readonly DomainNode[],
    private readonly edges: readonly EdgeState[],
    private readonly termIdOf: ReadonlyMap<string, Hex>,
    private readonly authorizingFromChild: ReadonlyMap<string, readonly EdgeState[]>,
    private readonly edgesFromParent: ReadonlyMap<string, readonly EdgeState[]>,
    private readonly limits: GraphLimits | null,
  ) {}

  /**
   * Indexes the graph once. Every lookup below is then a map read rather than a rebuild.
   *
   * Two adjacency maps, because they answer different questions: climbing towards a root
   * follows *authorizing* edges only (that is what a witness may claim), while drawing the
   * tree shows every edge, so an unusable one stays visible and diagnosable.
   */
  static from(nodes: DomainNode[], edges: EdgeState[], limits?: GraphLimits): DomainGraph {
    const termIdOf = new Map(nodes.map((node) => [node.label, node.termId]));
    const authorizingFromChild = new Map<string, EdgeState[]>();
    const edgesFromParent = new Map<string, EdgeState[]>();

    for (const edge of edges) {
      if (edge.isAuthorizing) {
        const climbing = authorizingFromChild.get(edge.child) ?? [];
        climbing.push(edge);
        authorizingFromChild.set(edge.child, climbing);
      }
      const descending = edgesFromParent.get(edge.parent) ?? [];
      descending.push(edge);
      edgesFromParent.set(edge.parent, descending);
    }

    return new DomainGraph(nodes, edges, termIdOf, authorizingFromChild, edgesFromParent, limits ?? null);
  }

  /** Term id of a domain, or undefined when the label is unknown. */
  termId(label: string): Hex | undefined {
    return this.termIdOf.get(label);
  }

  /** Label carried by a term id — the reverse lookup the panels need to name a proposal. */
  labelOf(termId: Hex): string | undefined {
    const wanted = termId.toLowerCase();
    return this.nodes.find((node) => node.termId.toLowerCase() === wanted)?.label;
  }

  /**
   * Shortest chain of attested sub-domain edges from `from` up to `to`.
   *
   * Walks authorizing edges only, so the result is a witness the enforcer accepts. A path
   * longer than the governor's cap is refused here rather than sent to revert on chain.
   */
  pathTo(from: string, to: string): PathResult {
    const fromId = this.termIdOf.get(from);
    if (!fromId) return { found: false, reason: `unknown domain “${from}”` };
    if (!this.termIdOf.has(to)) return { found: false, reason: `unknown domain “${to}”` };

    if (from === to) return { found: true, path: [fromId], labels: [from], steps: [] };

    const previous = new Map<string, EdgeState>();
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      // Safe: the while condition guarantees a non-empty queue.
      const current = queue.shift() as string;
      if (current === to) break;
      for (const edge of this.authorizingFromChild.get(current) ?? []) {
        if (seen.has(edge.parent)) continue;
        seen.add(edge.parent);
        previous.set(edge.parent, edge);
        queue.push(edge.parent);
      }
    }
    if (!seen.has(to)) {
      return { found: false, reason: `no attested chain of sub-domain edges from “${from}” up to “${to}”` };
    }

    const steps: PathStep[] = [];
    for (let cursor = to; cursor !== from; ) {
      const edge = previous.get(cursor);
      if (!edge) return { found: false, reason: "path reconstruction failed" };
      steps.unshift({ from: edge.child, to: edge.parent, tripleId: edge.tripleId });
      cursor = edge.child;
    }

    const labels = [from, ...steps.map((step) => step.to)];
    if (this.limits && labels.length > this.limits.maxDomainPath) {
      return {
        found: false,
        reason: `path of ${labels.length} domains exceeds the governor's cap of ${this.limits.maxDomainPath}`,
      };
    }
    // Safe: every label came from an edge whose endpoints are nodes in termIdOf.
    const path = labels.map((label) => this.termIdOf.get(label) as Hex);
    return { found: true, path, labels, steps };
  }

  /** The path from a domain up to the governance root — what the governor asks for. */
  pathToRoot(domain: string): PathResult {
    return this.pathTo(domain, ROOT_DOMAIN);
  }

  /** Every domain above this one, nearest first. Empty when it is a root or unreachable. */
  ancestorsOf(domain: string): string[] {
    const path = this.pathToRoot(domain);
    return path.found ? path.labels.slice(1) : [];
  }

  /**
   * Whether `domain` sits under `ancestor` — the question a grant asks: a delegation on a
   * domain reaches everything beneath it. A domain is its own descendant, since a grant on
   * it covers it exactly.
   */
  isDescendantOf(domain: string, ancestor: string): boolean {
    return this.pathTo(domain, ancestor).found;
  }

  /** Direct children of a domain, in manifest order. */
  childrenOf(domain: string): string[] {
    return (this.edgesFromParent.get(domain) ?? []).map((edge) => edge.child);
  }

  /** Domains no edge attaches to a parent — where the tree starts. */
  roots(): string[] {
    const hasParent = new Set(this.edges.map((edge) => edge.child));
    return [...new Set(this.edges.map((edge) => edge.parent))].filter((name) => !hasParent.has(name));
  }

  /**
   * The hierarchy as a tree, ready to render.
   *
   * Nodes no edge mentions are appended as roots of their own: an atom minted but not yet
   * linked is real, and hiding it would make the graph look like it lost a domain. Cycles
   * are cut here rather than left to overflow the stack — a cycle is a chain nobody signed,
   * so it must not take the page down during a demo.
   */
  tree(): TreeNode[] {
    const build = (name: string, usable: boolean, ancestry: ReadonlySet<string>): TreeNode => {
      if (ancestry.has(name)) return { label: name, usable, children: [] };
      const deeper = new Set(ancestry).add(name);
      return {
        label: name,
        usable,
        children: (this.edgesFromParent.get(name) ?? []).map((edge) =>
          build(edge.child, edge.isAuthorizing, deeper),
        ),
      };
    };

    const linked = new Set(this.edges.flatMap((edge) => [edge.child, edge.parent]));
    const orphans = this.nodes.filter((node) => !linked.has(node.label));
    return [
      ...this.roots().map((name) => build(name, true, new Set())),
      ...orphans.map((node) => build(node.label, true, new Set())),
    ];
  }

  /**
   * Path witness for a caveat, as term ids. Empty when no attested path exists — callers
   * that want the chain to reject a bad claim on its own terms pass that empty array on.
   */
  witnessTo(from: string, to: string): Hex[] {
    const path = this.pathTo(from, to);
    return path.found ? path.path : [];
  }

  /**
   * The `domainPath` argument the governor expects: the domain and its parents up to the
   * root. Single point of truth for it, so a third caller cannot drift from the contract.
   */
  domainPathOf(domain: string): Hex[] {
    return this.witnessTo(domain, ROOT_DOMAIN);
  }
}
