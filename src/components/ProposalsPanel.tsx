import { useState } from "react";
import type { PublicClient } from "viem";

import type { DemoConfig, Role } from "../lib/demo-config";
import {
  planVoteForcingWitness,
  recordProposal,
  submitVote,
  VOTE_ABSTAIN,
  VOTE_AGAINST,
  VOTE_FOR,
  type ProposalRecord,
} from "../lib/demo-actions";
import type { DelegationSet } from "../lib/delegation-set";
import type { DomainGraph } from "../lib/domain-graph";
import { Button, Empty, Field, Mono, Panel, Status, TxLink, type Verdict } from "./primitives";

interface Feedback {
  verdict: Verdict;
  text: string;
  txHash?: `0x${string}`;
}

const OPTIONS = [
  { support: VOTE_FOR, label: "for" },
  { support: VOTE_AGAINST, label: "against" },
  { support: VOTE_ABSTAIN, label: "abstain" },
];

/**
 * Every proposal, each with its own vote buttons.
 *
 * B votes on all of them, but the weight differs: inside the delegated domain A's weight
 * comes along, outside it B votes alone. That contrast is the demo.
 */
/** The weight a role casts on one domain, defaulting to nothing while reads are in flight. */
function votingPowerOf(
  weights: Record<string, Record<Role, bigint>>,
  domainId: string,
  role: Role,
): bigint {
  return weights[domainId.toLowerCase()]?.[role] ?? 0n;
}

export function ProposalsPanel({
  config,
  client,
  graph,
  delegations,
  proposals,
  weights,
  domain,
  role,
  writable,
  onSettled,
}: {
  config: DemoConfig;
  client: PublicClient;
  graph: DomainGraph;
  /** The grants in force — which signed chain a vote is redeemed through. */
  delegations: DelegationSet;
  proposals: ProposalRecord[];
  /** What each role casts per domain, read from the governor. */
  weights: Record<string, Record<Role, bigint>>;
  /** The domain picked in the rail; its whole subtree is listed. */
  domain: string;
  /** Who the viewer is acting as. */
  role: Role;
  writable: boolean;
  onSettled: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [title, setTitle] = useState("Fund the Q3 identity refresh");
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const rows = proposals.map((proposal) => {
    const domain = graph.labelOf(proposal.domainId) ?? "unknown";
    const own = votingPowerOf(weights, proposal.domainId, role);
    return { proposal, domain, weight: own };
  });

  // A domain covers everything beneath it, which is exactly what a delegation on it
  // reaches — so the rail's selection lists the subtree, not one node.
  const shown = rows.filter((row) => graph.isDescendantOf(row.domain, domain));

  async function vote(proposal: ProposalRecord, domain: string, support: number): Promise<void> {
    const key = proposal.id.toString();
    setBusy(key);
    setFeedback((current) => ({ ...current, [key]: { verdict: "pass", text: "voting…" } }));
    try {
      // The chain comes from the grants actually signed, so whoever the viewer is acting
      // as redeems in its own name — with whatever weight was delegated to it, or alone.
      const resolved = delegations.chainFor(role, domain);
      if (!resolved) throw new Error(`nobody delegated “${domain}” to ${role} — vote as yourself instead`);
      const plan = planVoteForcingWitness(config, graph, resolved, domain, proposal.id, support);
      const result = await submitVote(client, config, plan);
      setFeedback((current) => ({
        ...current,
        [key]: result.success
          ? { verdict: "pass", text: "vote counted", txHash: result.txHash }
          : {
              verdict: "fail",
              text: result.revert ? result.revert.formatted : "the vote reverted",
              txHash: result.txHash,
            },
      }));
      onSettled();
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [key]: { verdict: "fail", text: error instanceof Error ? error.message : String(error) },
      }));
    } finally {
      setBusy(null);
    }
  }

  async function add(): Promise<void> {
    setBusy("new");
    try {
      const created = await recordProposal(client, config, domain, title);
      setFeedback((current) => ({
        ...current,
        new: { verdict: "pass", text: `#${created.proposalId} added to “${domain}”`, txHash: created.txHash },
      }));
      onSettled();
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        new: { verdict: "fail", text: error instanceof Error ? error.message : String(error) },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      {shown.length === 0 ? (
        <Empty>None yet.</Empty>
      ) : (
        <>
          <div className="proposal-legend">
            <span className="legend-spacer" />
            <span className="legend-col">for</span>
            <span className="legend-col">against</span>
            <span className="legend-col">neutral</span>
            <span className="legend-col legend-weight">weight</span>
          </div>
          <ul className="proposals">
          {shown.map(({ proposal, domain, weight }) => {
            const key = proposal.id.toString();
            const said = feedback[key];
            const open = expanded === key;
            return (
              <li key={key} className={open ? "proposal proposal-open" : "proposal"}>
                <button
                  type="button"
                  className="proposal-summary"
                  onClick={() => setExpanded(open ? null : key)}
                  aria-expanded={open}
                >
                  <span className="proposal-caret" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="proposal-title">{proposal.description}</span>
                  <span className="proposal-domain">{domain}</span>
                  <span className="stat-col">
                    <Mono>{proposal.forVotes.toString()}</Mono>
                  </span>
                  <span className="stat-col">
                    <Mono>{proposal.againstVotes.toString()}</Mono>
                  </span>
                  <span className="stat-col">
                    <Mono>{proposal.abstainVotes.toString()}</Mono>
                  </span>
                  <span className="stat-col">
                    <span className={weight > 1n ? "weight-badge weight-badge-full" : "weight-badge"}>
                      <Mono>{weight.toString()}</Mono>
                    </span>
                  </span>
                </button>

                {open ? (
                  <div className="proposal-detail">
                    <dl className="kv">
                      <dt>id</dt>
                      <dd>
                        <Mono dim>#{key}</Mono>
                      </dd>
                      <dt>status</dt>
                      <dd>
                        <span className={`state state-${proposal.state}`}>{proposal.state}</span>
                      </dd>
                      <dt>your weight</dt>
                      <dd>
                        <Mono>{weight.toString()}</Mono>{" "}
                        <span className="muted">
                          {weight === 0n
                            ? `— you delegated “${domain}” away`
                            : weight === 1n
                              ? "— your own vote"
                              : "— yours plus what was delegated to you"}
                        </span>
                      </dd>
                      <dt>votes</dt>
                      <dd>
                        <Mono>{proposal.forVotes.toString()}</Mono> for ·{" "}
                        <Mono>{proposal.againstVotes.toString()}</Mono> against ·{" "}
                        <Mono>{proposal.abstainVotes.toString()}</Mono> abstain
                      </dd>
                    </dl>

                    <div className="vote-row">
                      {OPTIONS.map((option) => (
                        <Button
                          key={option.label}
                          onClick={() => void vote(proposal, domain, option.support)}
                          busy={busy === key}
                          disabled={!writable || proposal.state !== "active" || weight === 0n}
                          variant={option.support === VOTE_FOR ? "primary" : undefined}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>

                    {said ? (
                      <Status verdict={said.verdict}>
                        {said.text}
                        {said.txHash ? (
                          <>
                            {" · "}
                            <TxLink hash={said.txHash} />
                          </>
                        ) : null}
                      </Status>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
          </ul>
        </>
      )}

      <h4 className="section-label">add a proposal</h4>
      <p className="muted note-inline">Anyone can propose. Only voting is delegated.</p>
      <div className="form-row">
        <Field label="title">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
      </div>
      <div className="actions">
        <Button onClick={() => void add()} busy={busy === "new"} disabled={!writable}>
          add proposal
        </Button>
      </div>
      {feedback["new"] ? (
        <Status verdict={feedback["new"].verdict}>
          {feedback["new"].text}
          {feedback["new"].txHash ? (
            <>
              {" · "}
              <TxLink hash={feedback["new"].txHash} />
            </>
          ) : null}
        </Status>
      ) : null}
    </Panel>
  );
}
