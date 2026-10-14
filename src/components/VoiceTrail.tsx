/**
 * What has been done with the acting identity's voice, under the cards it belongs to.
 *
 * This was a tab of its own, and reaching it was the worst detour in the app: after
 * watching your delegate vote you switched identity, then switched tab, to read a fact
 * that had been on screen two clicks earlier inside the open proposal. Its other panel —
 * "standing": account, holds, delegating — was a strict subset of the identity card
 * above it.
 *
 * So the standing is gone, being a duplicate, and the part that existed nowhere else
 * sits at the foot of the Delegations tab, reporting on whichever identity you are
 * acting as. One line when there is anything to say, nothing at all when there is not.
 *
 * Delegations and not Proposals, which is where it first went and where it did not
 * belong: that tab names every voter on every row now, so a second account of the same
 * votes, filtered to one identity, was saying it twice. Here it completes a reading —
 * who holds this domain, how to hand it over, and what came of having done so.
 */
import { useEffect, useState } from "react";
import type { PublicClient } from "viem";

import { readVoicesCarriedFor, type CarriedVoice, type ProposalRecord } from "../lib/actions";
import type { AppConfig } from "../lib/config/app-config";
import { ROLE_CLASS, type Role } from "../lib/delegation/grant";
import { AddressLink, Mono, TxLink } from "./primitives";

export function VoiceTrail({
  config,
  client,
  role,
  proposals,
  tick,
}: {
  config: AppConfig;
  client: PublicClient;
  role: Role;
  proposals: ProposalRecord[];
  /** Bumped by every refresh, so this settles with the rest of the page. */
  tick: number;
}) {
  const [voices, setVoices] = useState<CarriedVoice[]>([]);
  const [open, setOpen] = useState(false);
  const account = config.accounts[role].smartAccount;

  useEffect(() => {
    let live = true;
    readVoicesCarriedFor(client, config, account)
      .then((found) => {
        if (live) setVoices(found);
      })
      .catch(() => {
        // A log that cannot be read is not worth an error banner of its own — the page
        // already has one, and this strip simply does not appear.
        if (live) setVoices([]);
      });
    return () => {
      live = false;
    };
  }, [client, config, account, tick]);

  if (voices.length === 0) return null;

  const byOthers = voices.filter((voice) => !voice.byItself).length;
  const describe = (id: bigint): string =>
    proposals.find((proposal) => proposal.id === id)?.description ?? `proposal ${id.toString().slice(0, 10)}…`;

  return (
    <section className="trail" aria-label={`what was cast in ${role}'s name`}>
      <button type="button" className="trail-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="trail-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span>
          <span className={ROLE_CLASS[role]}>{role}</span>&rsquo;s voice has reached{" "}
          <Mono>{voices.length}</Mono> {voices.length === 1 ? "ballot" : "ballots"}
          {byOthers === 0 ? (
            voices.length === 1 ? ", cast by itself" : ", all cast by itself"
          ) : byOthers === voices.length ? (
            <>
              , {voices.length === 1 ? "" : "all "}carried by{" "}
              <strong>somebody else</strong>
            </>
          ) : (
            <>
              {" "}— <strong>{byOthers}</strong> of them carried by somebody else
            </>
          )}
        </span>
      </button>

      {open ? (
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
    </section>
  );
}
