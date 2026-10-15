import { useEffect, useState } from "react";
import type { PublicClient } from "viem";

import type { AppConfig, Role } from "../lib/config/app-config";
import {
  readAllBallots,
  readDescription,
  recordProposal,
  castOnGovernor,
  VOTE_ABSTAIN,
  VOTE_AGAINST,
  VOTE_FOR,
  type Ballot,
  type ProposalRecord,
} from "../lib/actions";
import type { DelegationSet } from "../lib/delegation/delegation-set";
import type { DomainGraph } from "../lib/graph/domain-graph";
import { ballotFor } from "../lib/ballots";
import { ROLE_CLASS } from "../lib/delegation/grant";
import { shortHex } from "../lib/chain/network";
import { Button, Empty, Field, Mono, Panel, Status, TxLink, type Verdict } from "./primitives";

interface Feedback {
  verdict: Verdict;
  text: string;
  txHash?: `0x${string}`;
}

const SUPPORT_LABELS = ["against", "for", "abstain"];

/**
 * Who voted on a proposal, and how, without opening it.
 *
 * All of this was already in hand on the collapsed path — `readAllBallots` runs once for
 * the whole page and the row reads its result to work out whether *you* have voted. The
 * expanded view bought no new data, only room. So the room comes to the row instead.
 *
 * On a second grid line rather than in a column of its own, which matters more than it
 * sounds. At 901px — one pixel above the width where the domain rail collapses, and the
 * narrowest a row ever gets — the title track is already down to 175px. A fixed column
 * wide enough for three pills would take it to 51px, about six characters. Spanning the
 * line borrows no width at all, and renders nothing when nobody has voted, so the common
 * opening state costs exactly what it did before.
 *
 * Bounded at three by the chain: OpenZeppelin allows one ballot per account per proposal
 * and there are three accounts, so this can never become a list that needs scrolling.
 */
function Voters({ ballots }: { ballots: Ballot[] | undefined }) {
  if (!ballots || ballots.length === 0) return null;
  return (
    <span className="proposal-voters">
      {ballots.map((ballot) => {
        // Every entry on one ballot shares a carrier — it is the account that submitted
        // it — so any entry answers who voted. The rest are the voices it brought along.
        const voter = ballot.entries[0]?.carriedBy ?? null;
        const carried = ballot.entries
          .filter((entry) => entry.principal !== null && entry.principal !== voter)
          .map((entry) => entry.principal as Role);
        const said = SUPPORT_LABELS[ballot.support] ?? "?";
        const who = voter ?? shortHex(ballot.entries[0]?.carriedByAddress ?? "0x", 6, 4);
        return (
          <span
            key={`${who}-${ballot.support}`}
            className="voter-pill"
            // The row is a button, so a pill cannot be its own control. A title is what
            // the weight badge beside it already does.
            title={
              carried.length > 0
                ? `${who} voted ${said}, carrying ${carried.join(" and ")}`
                : `${who} voted ${said} with its own weight`
            }
          >
            <span className={`voter-who ${voter ? ROLE_CLASS[voter] : ""}`}>{who}</span>
            <span className={`voter-said voter-said-${said}`}>{said}</span>
            <Mono dim>{ballot.total.toString()}</Mono>
            {carried.length > 0 ? (
              <span className="voter-carried">
                carrying{" "}
                {carried.map((principal, index) => (
                  <span key={principal} className={ROLE_CLASS[principal]}>
                    {index > 0 ? ", " : ""}
                    {principal}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
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
  config: AppConfig;
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
  const [ballots, setBallots] = useState<Record<string, Ballot[]>>({});

  // Every row's ballots, in one read of the governor's log.
  //
  // Reading only the open row was not enough: whether you may vote is decided per
  // proposal, so a row has to know its own ballots before it is opened. One query for the
  // page costs about the same as one for a single row.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await readAllBallots(client, config);
        if (!cancelled) setBallots(all);
      } catch {
        // A log read that fails leaves the tallies on screen; it is detail, not the vote.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, config, feedback]);

  // A proposal on a domain the graph no longer carries has nothing to be scoped against,
  // so it is left out rather than shown against a name nobody recognises.
  const rows = proposals.flatMap((proposal) => {
    const domain = graph.labelOf(proposal.domainId);
    if (!domain) return [];
    return [{ proposal, domain, weight: votingPowerOf(weights, proposal.domainId, role) }];
  });

  // A domain covers everything beneath it, which is exactly what a delegation on it
  // reaches — so the rail's selection lists the subtree, not one node.
  //
  // Defeated proposals are left out: their voting window has closed, so they are a record
  // rather than something to act on, and they crowd out the ones that can still be voted.
  /**
   * What is on screen, open ones first.
   *
   * The list was newest-first and nothing else, so a closed proposal from an earlier
   * run sat above the fresh one that replaced it, looking identical — the only tell was
   * that its buttons were disabled. Open proposals are what a visitor can act on, so
   * they come first; the rest are history and keep their own newest-first order
   * underneath.
   *
   * Defeated ones stay hidden. A proposal whose voting period ran out without a vote is
   * `Defeated` to OpenZeppelin, and a board full of those says nothing except that time
   * passed.
   */
  const shown = rows
    .filter((row) => graph.isDescendantOf(row.domain, domain) && row.proposal.state !== "defeated")
    .sort((a, b) => Number(b.proposal.state === "active") - Number(a.proposal.state === "active"));

  async function vote(proposal: ProposalRecord, domain: string, support: number): Promise<void> {
    const key = proposal.id.toString();
    setBusy(key);
    setFeedback((current) => ({ ...current, [key]: { verdict: "pass", text: "voting…" } }));
    try {
      // With no borrowed voice this is a plain vote for oneself. With one, it is a
      // redemption, and each link of each chain carries the witness for its own scope:
      // the caveat recomputes that hop against the graph rather than believing it.
      const carried = delegations.chainFor(role, domain);
      const result = await castOnGovernor(
        client,
        config,
        role,
        proposal.id,
        support,
        carried,
        graph.domainPathOf(domain),
        (voice) => voice.scopes.map((scope) => graph.witnessTo(domain, scope)),
      );
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
    <Panel title={`Proposals on “${domain}” and below`}>
      {shown.length === 0 ? (
        <Empty>None yet.</Empty>
      ) : (
        <>
          <div className="proposal-legend">
            <span className="legend-spacer" />
            <span className="legend-col">for</span>
            <span className="legend-col">against</span>
            {/* "abstain", which is what SUPPORT_LABELS and the detail below both say.
                This header was the only place in the app that called it neutral. */}
            <span className="legend-col">abstain</span>
            <span className="legend-col">weight</span>
          </div>
          <ul className="proposals">
          {shown.map(({ proposal, domain, weight }) => {
            const key = proposal.id.toString();
            const said = feedback[key];
            const open = expanded === key;
            const mine = ballotFor(ballots[key], role);
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
                  <span className="proposal-title">{readDescription(proposal.description).title}</span>
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
                    {/* Your weight is per domain; whether it is still spendable is per
                        proposal. Once you have voted here, this row reads as cast. */}
                    {/* A closed proposal cannot take your weight, so printing it would
                        be answering a question nobody can act on. Saying so here is what
                        tells an old row from a live one without opening it. */}
                    {proposal.state !== "active" ? (
                      <span className="weight-badge weight-badge-closed" title={`voting is over — ${proposal.state}`}>
                        <Mono>closed</Mono>
                      </span>
                    ) : mine ? (
                      <span className="weight-badge weight-badge-cast" title={`you voted ${SUPPORT_LABELS[mine.support] ?? ""}`}>
                        <Mono>voted</Mono>
                      </span>
                    ) : (
                      <span className={weight > 1n ? "weight-badge weight-badge-full" : "weight-badge"}>
                        <Mono>{weight.toString()}</Mono>
                      </span>
                    )}
                  </span>
                  <Voters ballots={ballots[key]} />
                </button>

                {open ? (
                  <div className="proposal-detail">
                    <dl className="kv">
                      {/* Where the timestamp goes. It is stamped into every description
                          because an OZ proposal id hashes it, and a list of titles each
                          ending in an ISO string is unreadable — but the date itself is
                          worth having, once, down here. */}
                      {readDescription(proposal.description).recordedAt ? (
                        <>
                          <dt>recorded</dt>
                          <dd>{readDescription(proposal.description).recordedAt?.replace("T", " at ")}</dd>
                        </>
                      ) : null}
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
                          {mine
                            ? mine.carriedBy
                              ? `already on this ballot — ${mine.carriedBy} carried it`
                              : "already cast on this proposal"
                            : weight === 0n
                              ? `you delegated “${domain}” away`
                              : weight === 1n
                                ? "your own vote"
                                : "yours plus what was delegated to you"}
                        </span>
                      </dd>
                    </dl>

                    <Ballots entries={ballots[key]} />

                    {/* What the viewer already cast, read back from the governor's logs —
                        the vote stays on screen instead of vanishing into the tally. */}
                    {mine && mine.carriedBy === null ? (
                      <p className="voted">
                        You voted <strong>{SUPPORT_LABELS[mine.support] ?? "?"}</strong> here, weighing{" "}
                        <Mono>{mine.weight.toString()}</Mono>
                        {mine.carried.length > 0 ? `, yours plus ${mine.carried.join(" and ")}` : ", your own voice"}
                        . The governor counts an account once per proposal, so it cannot be changed.
                      </p>
                    ) : null}

                    {/* The case the interface used to hide. You did not vote here — your
                        delegate did, in your name — and the plain way to say that is that
                        you have already voted, because you have. */}
                    {mine && mine.carriedBy !== null ? (
                      <p className="voted voted-carried">
                        You have already voted <strong>{SUPPORT_LABELS[mine.support] ?? "?"}</strong> here:{" "}
                        <span className={ROLE_CLASS[mine.carriedBy]}>{mine.carriedBy}</span> carried your voice,
                        weighing <Mono>{mine.weight.toString()}</Mono>. Taking the domain back stops the next one
                        — it does not undo this, and the governor counts a voice once per proposal.
                      </p>
                    ) : null}

                    <div className="vote-row">
                      {OPTIONS.map((option) => (
                        <Button
                          key={option.label}
                          onClick={() => void vote(proposal, domain, option.support)}
                          busy={busy === key}
                          // Voting is decided per proposal: your weight on the domain, and
                          // whether you have already voted on this one. What anyone else
                          // did here does not stop you.
                          disabled={!writable || proposal.state !== "active" || weight === 0n || mine !== null}
                          // The accent marks the option you chose, not a default. Before
                          // you vote, no button is singled out.
                          variant={mine?.support === option.support ? "primary" : undefined}
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

/**
 * Who voted, and whose voices came along.
 *
 * A delegated vote reaches the governor as one number, which hides what it is made of.
 * The contract logs the split — one `VoteCastOnBehalf` per principal — so it can be shown
 * as what it is: one vote, cast by one account, carrying the voices lent to it.
 *
 * Drawn the way the domain rail is, and for the same reason: the carried voices belong
 * *under* the account that cast them, not beside it. A ballot with nothing riding along
 * has no twisty, exactly like a domain with no children.
 */
function Ballots({ entries }: { entries?: Ballot[] }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  if (!entries || entries.length === 0) return null;

  const toggle = (index: number): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };

  return (
    <div className="ballots">
      <h5 className="section-label">who voted</h5>
      {entries.map((ballot, index) => {
        // The voter's own entry is the one it carried itself; the rest rode along.
        const own = ballot.entries.find((entry) => entry.principal === entry.carriedBy);
        const carried = ballot.entries.filter((entry) => entry.principal !== entry.carriedBy);
        const voter = own ?? ballot.entries[0];
        if (!voter) return null;
        const open = carried.length > 0 && !collapsed.has(index);

        return (
          <ul key={index} className="ballot">
            <li className="ballot-node">
              <div className="ballot-row">
                {carried.length > 0 ? (
                  <button
                    type="button"
                    className="tree-twisty"
                    onClick={() => toggle(index)}
                    aria-expanded={open}
                    aria-label={`${open ? "Collapse" : "Expand"} the voices carried by ${voter.carriedBy ?? "this account"}`}
                  >
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                  </button>
                ) : (
                  <span className="tree-twisty tree-twisty-empty" aria-hidden="true" />
                )}
                <span className={`ballot-who ${voter.carriedBy ? ROLE_CLASS[voter.carriedBy] : ""}`}>
                  {voter.carriedBy ?? shortHex(voter.carriedByAddress)}
                </span>
                <span className="ballot-note muted">
                  voted {SUPPORT_LABELS[ballot.support] ?? "?"}
                  {carried.length > 0
                    ? ` · carrying ${carried.length} other ${carried.length > 1 ? "voices" : "voice"}`
                    : " · its own voice"}
                </span>
                {/* The total, which is the sum of the lines below it. */}
                <Mono>{ballot.total.toString()}</Mono>
              </div>

              {open ? (
                <ul className="ballot">
                  {[own, ...carried].filter(Boolean).map((entry) => (
                    <li key={entry!.principalAddress} className="ballot-node">
                      <div className="ballot-row ballot-row-nested">
                        <span className="tree-twisty tree-twisty-empty" aria-hidden="true" />
                        <span className={`ballot-who ${entry!.principal ? ROLE_CLASS[entry!.principal] : ""}`}>
                          {entry!.principal ?? shortHex(entry!.principalAddress)}
                        </span>
                        <span className="ballot-note muted">
                          {entry!.principal === entry!.carriedBy ? "its own voice" : "lent to the voter"}
                        </span>
                        <Mono dim>{entry!.weight.toString()}</Mono>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          </ul>
        );
      })}
    </div>
  );
}
