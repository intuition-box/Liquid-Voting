import { useState } from "react";
import { parseEther, type PublicClient } from "viem";

import { extendGraph } from "../lib/actions";
import type { AppConfig, SessionDomain } from "../lib/config/app-config";
import { checkDomainLabel, MAX_DOMAIN_LABEL, type DomainGraph } from "../lib/graph/domain-graph";
import type { EdgeState } from "../lib/graph/edges";
import { DomainTree } from "./DomainTree";
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
  sessionDomainCount: number;
  onSelect: (domain: string) => void;
  onRegistered: (domain: SessionDomain) => void;
  onResetSession: () => void;
}) {
  const [label, setLabel] = useState("motion design");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // Checked on every keystroke, not on submit: minting is three transactions and real
  // money, and the reason a label is refused belongs next to the field rather than in a
  // revert. `check.label` is the trimmed string — mint exactly what was validated.
  const check = checkDomainLabel(label, graph);

  async function add(): Promise<void> {
    if (!check.ok) return;
    const minting = check.label;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await extendGraph(client, config, minting, selected, STAKE);
      onRegistered({ label: minting, termId: result.atomId, parent: selected, tripleId: result.tripleId });
      onSelect(minting);
      setOutcome({ verdict: "pass", text: `“${minting}” is now under “${selected}”`, txHash: result.stakeTx });
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
          onSelect={onSelect}
        />
      )}

      <div className="rail-foot">
        {open ? (
          <>
            <Field label={`new domain under “${selected}”`}>
              <input
                value={label}
                maxLength={MAX_DOMAIN_LABEL}
                onChange={(event) => setLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && check.ok && !busy) void add();
                }}
              />
            </Field>
            {check.ok ? null : <p className="muted">{check.reason}</p>}
            <div className="actions">
              <Button onClick={() => void add()} busy={busy} disabled={!writable || !check.ok} variant="primary">
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
