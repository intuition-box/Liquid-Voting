import { useState } from "react";
import { parseEther, type PublicClient } from "viem";

import type { DemoConfig, SessionDomain } from "../lib/demo-config";
import { extendGraph, previewExtension, type ExtendResult } from "../lib/demo-actions";
import { Button, Field, Mono, Panel, Status, TxLink, type Verdict } from "./primitives";

const STAKE = parseEther("0.005");

interface Message {
  verdict: Verdict;
  text: string;
}

interface Outcome extends Message {
  result?: ExtendResult;
}

/**
 * The thesis, performed live: mint a domain that did not exist when the delegations were
 * signed, attest it, and watch the same untouched signatures authorize it. No redeploy,
 * no re-signature — the graph is the authority.
 */
export function ExtendPanel({
  config,
  client,
  writable,
  onRegistered,
}: {
  config: DemoConfig;
  client: PublicClient;
  writable: boolean;
  onRegistered: (domain: SessionDomain) => void;
}) {
  const [label, setLabel] = useState("motion design");
  const [parent, setParent] = useState("design");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [before, setBefore] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  /** Prove the domain is unauthorized *before* touching the graph — the contrast is the point. */
  async function checkBefore(): Promise<void> {
    setBusy(true);
    setBefore(null);
    setOutcome(null);
    try {
      const preview = await previewExtension(client, config, label);
      setBefore({ verdict: preview.status === "authorized" ? "pass" : "fail", text: preview.message });
    } catch (error) {
      setBefore({ verdict: "fail", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function extend(): Promise<void> {
    setBusy(true);
    setBefore(null);
    setOutcome(null);
    try {
      const result = await extendGraph(client, config, label, parent, STAKE);
      onRegistered({ label, termId: result.atomId, parent, tripleId: result.tripleId });
      setOutcome({
        verdict: "pass",
        text: `“${label}” is now a sub-domain of “${parent}”, attested with ${result.shares} shares — it is in the graph and the picker above, with no redeploy and no new signature`,
        result,
      });
    } catch (error) {
      setOutcome({ verdict: "fail", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      index="05"
      title="Extend the graph, live"
      subtitle="a delegation signed earlier authorizes a domain that did not exist at signing time"
    >
      <div className="form-row">
        <Field label="new domain">
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label="parent domain">
          <select value={parent} onChange={(event) => setParent(event.target.value)}>
            {config.nodes.map((node) => (
              <option key={node.termId} value={node.label}>
                {node.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="note">
        Creates the atom, links it under “{parent}” with the “{config.predicate.label}” predicate, and stakes{" "}
        <Mono>0.005 tTRUST</Mono> as the attestor — because an unattested edge authorizes nothing.
      </p>

      <div className="actions">
        <Button onClick={() => void checkBefore()} busy={busy}>
          check it fails today
        </Button>
        <Button onClick={() => void extend()} busy={busy} disabled={!writable} variant="primary">
          create + attest
        </Button>
      </div>

      {before ? <Status verdict={before.verdict}>{before.text}</Status> : null}

      {outcome ? (
        <>
          <Status verdict={outcome.verdict}>{outcome.text}</Status>
          {outcome.result ? (
            <dl className="kv">
              <dt>atom</dt>
              <dd>
                <Mono dim>{outcome.result.atomId}</Mono>{" "}
                {outcome.result.atomTx ? (
                  <TxLink hash={outcome.result.atomTx} label="created" />
                ) : (
                  <span className="muted">already existed</span>
                )}
              </dd>
              <dt>triple</dt>
              <dd>
                <Mono dim>{outcome.result.tripleId}</Mono>{" "}
                {outcome.result.tripleTx ? (
                  <TxLink hash={outcome.result.tripleTx} label="created" />
                ) : (
                  <span className="muted">already existed</span>
                )}
              </dd>
              <dt>stake</dt>
              <dd>
                <TxLink hash={outcome.result.stakeTx} label="deposit" />
              </dd>
            </dl>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}
