import { useState } from "react";
import { parseEther, type PublicClient } from "viem";

import type { EdgeState } from "../lib/graph";
import type { DemoConfig, SessionDomain } from "../lib/demo-config";
import { extendGraph } from "../lib/demo-actions";
import { Button, Empty, Field, Panel, Status, TxLink, type Verdict } from "./primitives";

const STAKE = parseEther("0.005");

interface TreeNode {
  label: string;
  children: TreeNode[];
  /** False when the edge to this node's parent carries no stake and cannot be used. */
  usable: boolean;
}

interface Outcome {
  verdict: Verdict;
  text: string;
  txHash?: `0x${string}`;
}

/**
 * The domain graph, as a tree — the shape on screen is the shape of the scope.
 *
 * Adding a domain here is the demo's centrepiece: a delegation signed earlier authorizes
 * it immediately, with no redeploy and no new signature.
 */
export function GraphPanel({
  config,
  client,
  edges,
  loading,
  writable,
  sessionDomainCount,
  onRegistered,
  onResetSession,
}: {
  config: DemoConfig;
  client: PublicClient;
  edges: EdgeState[];
  loading: boolean;
  writable: boolean;
  sessionDomainCount: number;
  onRegistered: (domain: SessionDomain) => void;
  onResetSession: () => void;
}) {
  const [label, setLabel] = useState("motion design");
  const [parent, setParent] = useState("design");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  const childrenOf = new Map<string, EdgeState[]>();
  for (const edge of edges) {
    childrenOf.set(edge.parent, [...(childrenOf.get(edge.parent) ?? []), edge]);
  }
  const hasParent = new Set(edges.map((edge) => edge.child));
  const roots = [...new Set(edges.map((edge) => edge.parent))].filter((name) => !hasParent.has(name));

  function build(name: string, usable: boolean): TreeNode {
    return {
      label: name,
      usable,
      children: (childrenOf.get(name) ?? []).map((edge) => build(edge.child, edge.isAuthorizing)),
    };
  }

  const tree = roots.map((name) => build(name, true));
  const linked = new Set(edges.flatMap((edge) => [edge.child, edge.parent]));
  const orphans = config.nodes.filter((node) => !linked.has(node.label));

  async function add(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await extendGraph(client, config, label, parent, STAKE);
      onRegistered({ label, termId: result.atomId, parent, tripleId: result.tripleId });
      setOutcome({
        verdict: "pass",
        text: `“${label}” is now under “${parent}” — the delegations signed earlier already cover it`,
        txHash: result.stakeTx,
      });
    } catch (error) {
      setOutcome({ verdict: "fail", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      {loading && edges.length === 0 ? (
        <Empty>reading the graph…</Empty>
      ) : (
        <ul className="tree">
          {tree.map((node) => (
            <TreeBranch key={node.label} node={node} depth={0} />
          ))}
        </ul>
      )}

      {orphans.length > 0 ? (
        <p className="note">
          Outside the tree: {orphans.map((node) => node.label).join(", ")}. No delegation reaches
          {orphans.length === 1 ? " it" : " them"}.
        </p>
      ) : null}

      <h4 className="section-label">add a domain</h4>
      <div className="form-row">
        <Field label="name">
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label="under">
          <select value={parent} onChange={(event) => setParent(event.target.value)}>
            {config.nodes.map((node) => (
              <option key={node.termId} value={node.label}>
                {node.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="actions">
        <Button onClick={() => void add()} busy={busy} disabled={!writable} variant="primary">
          add to the graph
        </Button>
        {sessionDomainCount > 0 ? (
          <Button onClick={onResetSession}>
            reset ({sessionDomainCount} added)
          </Button>
        ) : null}
        {!writable ? <span className="muted">read-only build</span> : null}
      </div>

      {outcome ? (
        <Status verdict={outcome.verdict}>
          {outcome.text}
          {outcome.txHash ? (
            <>
              {" · "}
              <TxLink hash={outcome.txHash} />
            </>
          ) : null}
        </Status>
      ) : null}
    </Panel>
  );
}

function TreeBranch({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <li className="tree-node">
      <span className={node.usable ? "tree-label" : "tree-label tree-label-dead"} style={{ paddingLeft: depth * 22 }}>
        {depth > 0 ? <span className="tree-tick">└</span> : null}
        {node.label}
        {node.usable ? null : <span className="tree-flag">unusable</span>}
      </span>
      {node.children.length > 0 ? (
        <ul className="tree">
          {node.children.map((child) => (
            <TreeBranch key={child.label} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
