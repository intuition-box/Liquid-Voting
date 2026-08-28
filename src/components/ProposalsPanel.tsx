import { useMemo, useState } from "react";
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
import type { EdgeState } from "../lib/graph";
import { ROLE_LABELS, weightOn, type Grant } from "../lib/grants";
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
export function ProposalsPanel({
  config,
  client,
  edges,
  proposals,
  votingPower,
  grants,
  role,
  writable,
  onSettled,
}: {
  config: DemoConfig;
  client: PublicClient;
  edges: EdgeState[];
  proposals: ProposalRecord[];
  votingPower: Record<Role, bigint>;
  /** Every delegation in force. */
  grants: Grant[];
  /** Who the viewer is acting as. */
  role: Role;
  writable: boolean;
  onSettled: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("branding");
  const [title, setTitle] = useState("Fund the Q3 identity refresh");
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const labelOf = useMemo(
    () => new Map(config.nodes.map((node) => [node.termId.toLowerCase(), node.label])),
    [config.nodes],
  );

  const rows = proposals.map((proposal) => {
    const domain = labelOf.get(proposal.domainId.toLowerCase()) ?? "unknown";
    return { proposal, domain, weight: weightOn(config, edges, grants, votingPower, role, domain) };
  });

  const domains = [...new Set(rows.map((row) => row.domain))];
  const shown = filter ? rows.filter((row) => row.domain === filter) : rows;

  async function vote(proposal: ProposalRecord, domain: string, support: number): Promise<void> {
    const key = proposal.id.toString();
    setBusy(key);
    setFeedback((current) => ({ ...current, [key]: { verdict: "pass", text: "voting…" } }));
    try {
      const level = role === "executor" ? "full" : "root";
      const plan = planVoteForcingWitness(config, edges, level, domain, proposal.id, support);
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
      const created = await recordProposal(client, config, newDomain, title);
      setFeedback((current) => ({
        ...current,
        new: { verdict: "pass", text: `#${created.proposalId} added to “${newDomain}”`, txHash: created.txHash },
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
      <div className="filters">
        <button type="button" className={filter === "" ? "chip chip-on" : "chip"} onClick={() => setFilter("")}>
          all
        </button>
        {domains.map((name) => (
          <button
            key={name}
            type="button"
            className={filter === name ? "chip chip-on" : "chip"}
            onClick={() => setFilter(name)}
          >
            {name}
          </button>
        ))}
      </div>

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
                    <span className={weight.carried.length > 0 ? "weight-badge weight-badge-full" : "weight-badge"}>
                      <Mono>{weight.total.toString()}</Mono>
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
                        {weight.passedTo ? (
                          <span className="muted">
                            0 — you delegated “{domain}” to {ROLE_LABELS[weight.passedTo]}
                          </span>
                        ) : (
                          <>
                            <Mono>{weight.total.toString()}</Mono>{" "}
                            <span className="muted">
                              {weight.carried.length === 0
                                ? "— your own vote"
                                : `— yours plus ${weight.carried.map((entry) => ROLE_LABELS[entry]).join(" and ")}`}
                            </span>
                          </>
                        )}
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
                          disabled={!writable || proposal.state !== "active" || weight.total === 0n}
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
        <Field label="domain">
          <select value={newDomain} onChange={(event) => setNewDomain(event.target.value)}>
            {config.nodes.map((node) => (
              <option key={node.termId} value={node.label}>
                {node.label}
              </option>
            ))}
          </select>
        </Field>
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
