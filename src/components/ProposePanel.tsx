import { useMemo, useState } from "react";
import type { PublicClient } from "viem";

import type { DemoConfig } from "../lib/demo-config";
import {
  planProposalForcingWitness,
  preflightProposal,
  submitProposal,
  type ChainLevel,
  type ProposalRecord,
} from "../lib/demo-actions";
import type { EdgeState } from "../lib/graph";
import { AddressLink, Button, Empty, Field, Mono, Panel, Status, TxLink, type Verdict } from "./primitives";

interface Outcome {
  verdict: Verdict;
  message: string;
  txHash?: `0x${string}`;
}

/**
 * Propose. The path computation is deliberately visible: it is the client-side half of
 * the witness pattern (ADR 0003), and the thing a reviewer most needs to understand.
 * Every attempt is simulated first with eth_call from the redeeming account, so a
 * failure shows the enforcer's own revert reason instead of a generic error.
 */
export function ProposePanel({
  config,
  client,
  edges,
  writable,
  proposals,
  onSettled,
}: {
  config: DemoConfig;
  client: PublicClient;
  edges: EdgeState[];
  writable: boolean;
  proposals: ProposalRecord[];
  onSettled: () => void;
}) {
  const [domain, setDomain] = useState("UX");
  const [level, setLevel] = useState<ChainLevel>("full");
  const [description, setDescription] = useState("Refresh the checkout flow");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () => planProposalForcingWitness(config, edges, level, domain, description),
    [config, edges, level, domain, description],
  );
  const labelOf = useMemo(
    () => new Map(config.nodes.map((node) => [node.termId.toLowerCase(), node.label])),
    [config.nodes],
  );

  async function check(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await preflightProposal(client, config, plan);
      setOutcome(
        result.ok
          ? { verdict: "pass", message: "simulation passed — every caveat verified against live graph state" }
          : { verdict: "fail", message: result.revert ? `rejected: ${result.revert.formatted}` : `rejected: ${result.raw}` },
      );
    } catch (error) {
      setOutcome({ verdict: "fail", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await submitProposal(client, config, plan);
      setOutcome(
        result.success
          ? { verdict: "pass", message: "proposal recorded on chain, in the voter's name", txHash: result.txHash }
          : {
              verdict: "fail",
              message: result.revert ? `reverted: ${result.revert.formatted}` : "the user operation reverted",
              txHash: result.txHash,
            },
      );
      onSettled();
    } catch (error) {
      setOutcome({ verdict: "fail", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel index="03" title="Propose" subtitle="path computed here, verified on chain — hop by hop">
      <div className="form-row">
        <Field label="domain">
          <select value={domain} onChange={(event) => setDomain(event.target.value)}>
            {config.nodes.map((node) => (
              <option key={node.termId} value={node.label}>
                {node.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="redeem through">
          {/* Safe: the only option values rendered below are the two ChainLevel members. */}
          <select value={level} onChange={(event) => setLevel(event.target.value as ChainLevel)}>
            <option value="full">full chain — executor (scoped UX, then design)</option>
            <option value="root">root only — delegate (scoped design)</option>
          </select>
        </Field>
      </div>
      <Field label="description">
        <input value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>

      <div className="witness">
        <h4>witness computed client-side</h4>
        {plan.paths.map((entry) => (
          <div key={entry.rootLabel} className="witness-level">
            <span className="witness-scope">to “{entry.rootLabel}”</span>
            {entry.result.found ? (
              <>
                <span className="witness-path">{entry.result.labels.join("  →  ")}</span>
                <span className="muted">
                  {entry.result.steps.length === 0
                    ? "exact match, 0 hop to verify"
                    : `${entry.result.steps.length} hop${entry.result.steps.length > 1 ? "s" : ""} the enforcer will verify`}
                </span>
              </>
            ) : (
              <span className="witness-none">{entry.result.reason}</span>
            )}
          </div>
        ))}
        {plan.blocked ? (
          <p className="note">
            No attested path exists, so this witness cannot verify — submitting it anyway is how the demo shows the
            enforcer rejecting a domain live.
          </p>
        ) : null}
      </div>

      <div className="actions">
        <Button onClick={() => void check()} busy={busy}>
          simulate
        </Button>
        <Button onClick={() => void submit()} busy={busy} disabled={!writable} variant="primary">
          submit on chain
        </Button>
        {!writable ? <span className="muted">read-only build — no submitter key</span> : null}
      </div>

      {outcome ? (
        <Status verdict={outcome.verdict}>
          {outcome.message}
          {outcome.txHash ? (
            <>
              {" · "}
              <TxLink hash={outcome.txHash} />
            </>
          ) : null}
        </Status>
      ) : null}

      <h4 className="section-label">recorded proposals</h4>
      {proposals.length === 0 ? (
        <Empty>None yet. A successful proposal appears here, recorded in the voter's name.</Empty>
      ) : (
        <ul className="proposals">
          {proposals.map((proposal) => (
            <li key={proposal.id.toString()}>
              <Mono dim>#{proposal.id.toString()}</Mono>
              <strong>{labelOf.get(proposal.domainId.toLowerCase()) ?? proposal.domainId.slice(0, 12)}</strong>
              <span className="muted">{proposal.description}</span>
              <AddressLink address={proposal.proposer} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
