import type { PublicClient } from "viem";

import { multiVaultAbi } from "./abis";

export interface DomainNode {
  label: string;
  termId: `0x${string}`;
}

export interface DomainEdge {
  /** Child domain — the subject of `child is a sub-domain of parent`. */
  child: string;
  parent: string;
  tripleId: `0x${string}`;
}

/** Live MultiVault state for one edge — what actually authorizes it (ADR 0004). */
export interface EdgeState extends DomainEdge {
  /** 0 = ATOM, 1 = TRIPLE, 2 = COUNTER_TRIPLE, null = never created or unreadable. */
  vaultType: number | null;
  attestorShares: bigint;
  /** A hop only verifies when it is a positive triple AND the attestor holds a position. */
  isAuthorizing: boolean;
  /**
   * Set when the RPC itself failed. Without this a network blip is indistinguishable
   * from "this edge authorizes nothing", which would make the demo fail for a reason
   * nobody in the room can diagnose.
   */
  readError: string | null;
}

export interface PathStep {
  from: string;
  to: string;
  tripleId: `0x${string}`;
}

export type PathResult =
  | { found: true; path: `0x${string}`[]; labels: string[]; steps: PathStep[] }
  | { found: false; reason: string };

/**
 * Client-side path discovery — the complement to the on-chain verification (ADR 0003).
 *
 * The MultiVault has no reverse index, so the contract can never discover intermediate
 * nodes; the redeemer must supply the path as a witness. This BFS walks the *authorizing*
 * edges only (positive triples the attestor staked), so the witness it produces is one
 * the enforcer will accept — discovery here, verification there.
 */
export function computePath(edges: EdgeState[], nodes: DomainNode[], from: string, to: string): PathResult {
  const termIdOf = new Map(nodes.map((node) => [node.label, node.termId]));
  const fromId = termIdOf.get(from);
  const toId = termIdOf.get(to);
  if (!fromId) return { found: false, reason: `unknown domain “${from}”` };
  if (!toId) return { found: false, reason: `unknown domain “${to}”` };

  if (from === to) {
    return { found: true, path: [fromId], labels: [from], steps: [] };
  }

  const outgoing = new Map<string, EdgeState[]>();
  for (const edge of edges) {
    if (!edge.isAuthorizing) continue;
    const list = outgoing.get(edge.child) ?? [];
    list.push(edge);
    outgoing.set(edge.child, list);
  }

  const previous = new Map<string, EdgeState>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    // Safe: the while condition guarantees a non-empty queue.
    const current = queue.shift() as string;
    if (current === to) break;
    for (const edge of outgoing.get(current) ?? []) {
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
  // Safe: every label came from an edge whose endpoints are nodes in termIdOf.
  const path = labels.map((label) => termIdOf.get(label) as `0x${string}`);
  return { found: true, path, labels, steps };
}

function describe(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.split("\n")[0] ?? "read failed";
}

/** A contract revert is an answer; anything else is a transport problem worth surfacing. */
function isContractRevert(cause: unknown): boolean {
  const name = cause instanceof Error ? cause.name : "";
  return name.includes("ContractFunctionExecutionError") || name.includes("ContractFunctionRevertedError");
}

/** Reads each edge's live authorization state: positive-triple check + attestor position. */
export async function readEdgeStates(
  client: PublicClient,
  multiVault: `0x${string}`,
  edges: DomainEdge[],
  attestor: `0x${string}`,
  curveId: bigint,
): Promise<EdgeState[]> {
  return Promise.all(
    edges.map(async (edge) => {
      // getVaultType reverts for a never-created term — that is a legitimate "no", not a
      // transport failure, so it is caught separately from the shares read.
      let vaultType: number | null = null;
      let readError: string | null = null;
      try {
        vaultType = await client.readContract({
          address: multiVault,
          abi: multiVaultAbi,
          functionName: "getVaultType",
          args: [edge.tripleId],
        });
      } catch (cause) {
        vaultType = null;
        if (!isContractRevert(cause)) readError = describe(cause);
      }

      let attestorShares = 0n;
      try {
        attestorShares = await client.readContract({
          address: multiVault,
          abi: multiVaultAbi,
          functionName: "getShares",
          args: [attestor, edge.tripleId, curveId],
        });
      } catch (cause) {
        readError = readError ?? describe(cause);
      }

      return {
        ...edge,
        vaultType,
        attestorShares,
        isAuthorizing: readError === null && vaultType === 1 && attestorShares > 0n,
        readError,
      };
    }),
  );
}
