import { useState } from "react";
import { parseEther, type PublicClient } from "viem";

import { extendGraph } from "../lib/actions";
import type { AppConfig, Role, SessionDomain } from "../lib/config/app-config";
import type { DomainGraph } from "../lib/graph/domain-graph";
import type { EdgeState } from "../lib/graph/edges";
import { DomainTree, type Held } from "./DomainTree";
import { Button, Empty, Field, Status, TxLink, type Verdict } from "./primitives";

const STAKE = parseEther("0.005");

interface Outcome {
  verdict: Verdict;
  text: string;
  txHash?: `0x${string}`;
}

/**
 * The app's left rail: the domain tree, and the form that grows it.
 *
 * Selecting a branch here scopes whatever the centre is showing, so the graph is the
 * navigation rather than a panel of its own. Adding a domain is the demo's centrepiece:
 * a delegation signed earlier covers it immediately, with no redeploy and no signature.
 */
export function DomainNav({
  config,
  client,
  graph,
  edges,
  loading,
  writable,
  selected,
  grantedTo,
  viewer,
  sessionDomainCount,
  onSelect,
  onRegistered,
  onResetSession,
}: {
  config: AppConfig;
  client: PublicClient;
  graph: DomainGraph;
  edges: EdgeState[];
  loading: boolean;
  writable: boolean;
  /** The domain scoping the centre; its whole subtree reads as covered. */
  selected: string;
  /** Who handed each domain to whom, drawn as a badge on the row. */
  grantedTo?: Map<string, Held[]>;
  /** Who the viewer is acting as; the badges are written from their side. */
  viewer: Role;
  sessionDomainCount: number;
  onSelect: (domain: string) => void;
  onRegistered: (domain: SessionDomain) => void;
  onResetSession: () => void;
}) {
  const [label, setLabel] = useState("motion design");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function add(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await extendGraph(client, config, label, selected, STAKE);
      onRegistered({ label, termId: result.atomId, parent: selected, tripleId: result.tripleId });
      onSelect(label);
      setOutcome({ verdict: "pass", text: `“${label}” is now under “${selected}”`, txHash: result.stakeTx });
      setOpen(false);
    } catch (error) {
      setOutcome({ verdict: "fail", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <nav className="rail" aria-label="domains">
      {loading && edges.length === 0 ? (
        <Empty>reading the graph…</Empty>
      ) : (
        <DomainTree
          graph={graph}
          selected={selected}
          grantedTo={grantedTo}
          viewer={viewer}
          onSelect={onSelect}
        />
      )}

      <div className="rail-foot">
        {open ? (
          <>
            <Field label={`new domain under “${selected}”`}>
              <input value={label} onChange={(event) => setLabel(event.target.value)} />
            </Field>
            <div className="actions">
              <Button onClick={() => void add()} busy={busy} disabled={!writable} variant="primary">
                add
              </Button>
              <Button onClick={() => setOpen(false)}>cancel</Button>
            </div>
          </>
        ) : (
          <div className="actions">
            <Button onClick={() => setOpen(true)} disabled={!writable}>
              + add a domain
            </Button>
            {sessionDomainCount > 0 ? <Button onClick={onResetSession}>reset ({sessionDomainCount})</Button> : null}
          </div>
        )}
        {!writable ? <p className="muted">read-only build</p> : null}
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
      </div>
    </nav>
  );
}
