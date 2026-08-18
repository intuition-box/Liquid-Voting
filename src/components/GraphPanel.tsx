import { formatEther } from "viem";

import type { EdgeState } from "../lib/graph";
import type { DemoConfig } from "../lib/demo-config";
import { Empty, Mono, Panel } from "./primitives";

/**
 * The seeded graph. Each edge shows the attesting position, because under ADR 0004 the
 * stake — not the triple's existence — is what authorizes a hop.
 */
export function GraphPanel({ config, edges, loading }: { config: DemoConfig; edges: EdgeState[]; loading: boolean }) {
  const linked = new Set(edges.flatMap((edge) => [edge.child, edge.parent]));
  const orphans = config.nodes.filter((node) => !linked.has(node.label));

  return (
    <Panel
      index="01"
      title="Domain graph"
      subtitle={`predicate “${config.predicate.label}” · attestation read live from the MultiVault`}
    >
      {loading && edges.length === 0 ? (
        <Empty>reading graph state from the MultiVault…</Empty>
      ) : (
        <ul className="edges">
          {edges.map((edge) => (
            <li key={edge.tripleId} className={edge.isAuthorizing ? "edge" : "edge edge-dead"}>
              <div className="edge-relation">
                <strong>{edge.child}</strong>
                <span className="muted"> is a sub-domain of </span>
                <strong>{edge.parent}</strong>
              </div>
              <div className="edge-meta">
                <Mono dim>{edge.tripleId.slice(0, 14)}…</Mono>
                <span className={edge.vaultType === 1 ? "tag tag-ok" : "tag tag-bad"}>
                  {edge.vaultType === 1 ? "positive triple" : edge.vaultType === null ? "not created" : `vault type ${edge.vaultType}`}
                </span>
                <span className={edge.attestorShares > 0n ? "tag tag-ok" : "tag tag-bad"}>
                  {edge.attestorShares > 0n ? `attested · ${formatEther(edge.attestorShares)} shares` : "no attestor position"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {orphans.length > 0 ? (
        <p className="note">
          unlinked: {orphans.map((node) => node.label).join(", ")} — reachable by no path, so no delegation can scope to
          {orphans.length === 1 ? " it" : " them"}.
        </p>
      ) : null}
    </Panel>
  );
}
