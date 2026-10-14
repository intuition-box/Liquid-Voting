/**
 * The three identities, in one place.
 *
 * They used to be described three times over in the header: a toggle saying who you were,
 * a token readout saying what they held, and a session strip listing their addresses.
 * Three components for one subject — and the subject is the whole demonstration, since
 * what the demo is about is what differs between A, B and C once a domain has changed
 * hands.
 *
 * So one card each, carrying everything true of that account at once, and the card you
 * are acting as is the one that is lit. Switching identity is clicking a card, which is
 * also the thing a visitor most wants to do.
 *
 * Whose wallets these are is said at the foot of the page, beside the transaction log,
 * because that is a fact about the machinery rather than about governance.
 */
import { useEffect } from "react";

import type { AppConfig, Role } from "../lib/config/app-config";
import type { DelegationSet } from "../lib/delegation/delegation-set";
import { ROLE_CLASS, ROLES } from "../lib/delegation/grant";
import type { DomainGraph } from "../lib/graph/domain-graph";
import { shortHex } from "../lib/chain/network";

/**
 * An arc drawn from giver to receiver, for the few seconds after a handover lands.
 *
 * The one event this demo exists to show used to be a sentence at the bottom of a panel
 * on a tab where the cards are not visible, while the cards whose numbers had just
 * changed sat silently off-screen. Animating the only thing that moves costs nothing and
 * says more than the sentence did.
 *
 * Drawn on a 100-wide viewBox stretched over the card row, so the three column centres
 * are simply a sixth, a half and five sixths — no measuring, and it survives a resize
 * without listening for one.
 */
function Handover({ from, to, domain }: { from: Role; to: Role; domain: string }) {
  const at = (role: Role): number => [1 / 6, 1 / 2, 5 / 6][ROLES.indexOf(role)]! * 100;
  const x1 = at(from);
  const x2 = at(to);
  const mid = (x1 + x2) / 2;
  // Deeper for a longer reach, so A→C arcs over B rather than grazing it.
  const lift = Math.min(26, 8 + Math.abs(x2 - x1) * 0.28);
  return (
    <svg className="handover" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <marker id="handover-head" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill="currentColor" />
        </marker>
      </defs>
      <path
        d={`M ${x1} 30 Q ${mid} ${30 - lift} ${x2} 30`}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
        markerEnd="url(#handover-head)"
      />
      <title>{`${from} handed “${domain}” to ${to}`}</title>
    </svg>
  );
}

export function IdentityBar({
  config,
  role,
  onRole,
  domain,
  graph,
  delegations,
  holdings,
  lent,
  weights,
  handover,
  onHandoverShown,
}: {
  config: AppConfig;
  role: Role;
  onRole: (role: Role) => void;
  /** The domain the page is scoped to — what "casts" is counted on. */
  domain: string;
  graph: DomainGraph;
  delegations: DelegationSet;
  holdings: Record<Role, { balance: bigint; votes: bigint }>;
  lent: Partial<Record<Role, { amount: bigint; scope: string }>>;
  weights: Record<string, Record<Role, bigint>>;
  /** Set for a moment after a handover lands, then cleared by this component. */
  handover: { from: Role; to: Role; domain: string } | null;
  onHandoverShown: () => void;
}) {
  // Long enough to notice and follow, short enough not to linger over the numbers it is
  // explaining. Cleared here rather than in the hook so the timer dies with the view.
  useEffect(() => {
    if (!handover) return;
    const timer = window.setTimeout(onHandoverShown, 2600);
    return () => window.clearTimeout(timer);
  }, [handover, onHandoverShown]);

  const domainId = graph.termId(domain)?.toLowerCase();
  const castsOn = domainId ? weights[domainId] : undefined;

  return (
    <section className="identities" aria-label="identities">
      <div className="identity-cards" role="group">
        {handover ? (
          <span className={`handover-layer ${ROLE_CLASS[handover.from]}`}>
            <Handover from={handover.from} to={handover.to} domain={handover.domain} />
            <span className="handover-label">
              {handover.from} → {handover.to} on <strong>{handover.domain}</strong>
            </span>
          </span>
        ) : null}
        {ROLES.map((entry) => {
          const held = holdings[entry];
          const lending = lent[entry];
          // Whose voices this account could exercise here, read from the grants in force
          // rather than guessed from balances: a lending moves no token.
          const carrying = (delegations.chainFor(entry, domain)?.principals ?? []).filter(
            (principal) => principal !== entry,
          );
          const casts = castsOn?.[entry];
          const active = entry === role;

          return (
            <button
              key={entry}
              type="button"
              className={active ? `identity-card identity-card-on ${ROLE_CLASS[entry]}` : "identity-card"}
              onClick={() => onRole(entry)}
              aria-pressed={active}
            >
              <span className="identity-head">
                <span className={`identity-dot ${ROLE_CLASS[entry]}`} />
                <span className={`identity-name ${ROLE_CLASS[entry]}`}>{entry}</span>
                {active ? <span className="identity-acting">acting</span> : null}
              </span>

              <dl className="identity-facts">
                <div>
                  <dt>holds</dt>
                  <dd>
                    {held.balance.toString()}
                    {/* A balance that was never self-delegated counts for nothing, which
                        is a real state on an ERC20Votes and worth naming rather than
                        leaving somebody to debug. */}
                    {held.balance > 0n && held.votes === 0n ? (
                      <span className="identity-warn"> not self-delegated</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  {/* "delegating", not "lending": the contract calls it a lending because
                      the weight comes back, but what a reader is watching is a delegation,
                      and the card has no room to explain the difference. */}
                  <dt>delegating</dt>
                  <dd>
                    {lending ? (
                      <>
                        {lending.amount.toString()} on <strong>{lending.scope}</strong>
                      </>
                    ) : (
                      <span className="identity-none">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>carrying</dt>
                  <dd>
                    {carrying.length > 0 ? (
                      <>
                        {carrying.join(", ")} on <strong>{domain}</strong>
                      </>
                    ) : (
                      <span className="identity-none">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>casts</dt>
                  <dd>
                    {casts === undefined ? (
                      <span className="identity-none">…</span>
                    ) : (
                      <>
                        {casts.toString()} <span className="identity-on">on {domain}</span>
                      </>
                    )}
                  </dd>
                </div>
              </dl>

              {/* Not a link inside a button — the card is the control. The address is here
                  to be read and copied, and the explorer is one click away from the footer. */}
              <span className="identity-address">{shortHex(config.accounts[entry].smartAccount, 8, 6)}</span>
            </button>
          );
        })}
      </div>

    </section>
  );
}
