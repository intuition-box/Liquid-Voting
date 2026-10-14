/**
 * What happened to one account's voice: what it holds, what it handed over, and every
 * share of its weight anybody has cast.
 *
 * The gap the Intuition Box review called the heart of the thing. Delegating by domain is
 * only worth doing if a delegator stays accountable for what was done in its name, and
 * until now the app could not answer that question at all: OpenZeppelin indexes the
 * account that *submitted* a vote, so A handing its treasury to B and B voting with it
 * left A's own view of the world completely unchanged.
 *
 * The governor now logs `VoteCastOnBehalf` once per voice a vote carried, indexed by
 * principal, so this is one filtered query — and every figure on screen is the one the
 * chain counted rather than a reconstruction of it.
 */
import { useEffect, useState } from "react";
import type { PublicClient } from "viem";

import { readVoicesCarriedFor, type CarriedVoice, type ProposalRecord } from "../lib/actions";
import type { AppConfig } from "../lib/config/app-config";
import { ROLE_CLASS, type Role } from "../lib/delegation/grant";
import { AddressLink, Empty, Mono, Panel, TxLink } from "./primitives";

export function VoicePanel({
  config,
  client,
  role,
  proposals,
  holdings,
  lent,
  /** Bumped by the app after anything lands, so this refetches with everything else. */
  tick,
}: {
  config: AppConfig;
  client: PublicClient;
  role: Role;
  proposals: ProposalRecord[];
  holdings?: Record<Role, { balance: bigint; votes: bigint }>;
  lent?: Partial<Record<Role, { amount: bigint; scope: string }>>;
  tick: number;
}) {
  const [voices, setVoices] = useState<CarriedVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const account = config.accounts[role].smartAccount;

  useEffect(() => {
    let live = true;
    setLoading(true);
    readVoicesCarriedFor(client, config, account)
      .then((found) => {
        if (!live) return;
        setVoices(found);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, config, account, tick]);

  const held = holdings?.[role];
  const lending = lent?.[role];
  const describe = (id: bigint): string =>
    proposals.find((proposal) => proposal.id === id)?.description ?? `proposal ${id.toString().slice(0, 10)}…`;

  return (
    <div className="stack">
      <Panel title={`${role}'s standing`}>
        <dl className="voice-standing">
          <div>
            <dt>account</dt>
            <dd>
              <AddressLink address={account} />
            </dd>
          </div>
          <div>
            <dt>holds</dt>
            <dd>
              {held ? <Mono>{held.balance.toString()} DVOTE</Mono> : <span className="muted">reading…</span>}
              {held && held.balance > 0n && held.votes === 0n ? (
                <span className="voice-note">not self-delegated, so it counts for nothing</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>handed over</dt>
            <dd>
              {lending ? (
                <>
                  <Mono>{lending.amount.toString()}</Mono> on <strong>{lending.scope}</strong>
                  <span className="voice-note">
                    and on every domain beneath it, as the graph has it
                  </span>
                </>
              ) : (
                <span className="muted">nothing — it votes for itself everywhere</span>
              )}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel title="Cast in its name">
        {error ? <p className="status status-fail">could not read the log: {error}</p> : null}
        {loading && voices.length === 0 ? <Empty>reading the governor&rsquo;s log…</Empty> : null}

        {!loading && voices.length === 0 ? (
          <Empty>
            Nothing yet. Hand a domain over, then vote as the delegate — the voice will appear here, under the
            name of whoever carried it.
          </Empty>
        ) : null}

        {voices.length > 0 ? (
          <ol className="voice-list">
            {voices.map((voice) => (
              <li key={`${voice.proposalId}-${voice.txHash}`} className="voice-row">
                <div className="voice-head">
                  {/* The claim the whole feature exists to make, in one line. */}
                  <span className="voice-claim">
                    <Mono>{voice.weight.toString()}</Mono>
                    {voice.byItself ? (
                      <> cast by {role} itself</>
                    ) : (
                      <>
                        {" "}of {role}&rsquo;s weight, carried by{" "}
                        <span className={`voice-who ${voice.carriedBy ? ROLE_CLASS[voice.carriedBy] : ""}`}>
                          {voice.carriedBy ?? <AddressLink address={voice.carriedByAddress} />}
                        </span>
                      </>
                    )}
                  </span>
                  <TxLink hash={voice.txHash} />
                </div>
                <p className="voice-on">
                  on &ldquo;{describe(voice.proposalId)}&rdquo;
                  <span className="voice-block"> · block {voice.block.toString()}</span>
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </Panel>
    </div>
  );
}
