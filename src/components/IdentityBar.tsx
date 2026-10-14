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
 */
import type { AppConfig, Role } from "../lib/config/app-config";
import type { DelegationSet } from "../lib/delegation/delegation-set";
import { ROLE_CLASS, ROLES } from "../lib/delegation/grant";
import type { DomainGraph } from "../lib/graph/domain-graph";
import type { Session } from "../lib/chain/session";
import { addressUrl, shortHex } from "../lib/chain/network";

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
  session,
  onForget,
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
  /** Present when this browser made its own wallets. */
  session: Session | null;
  onForget: () => void;
}) {
  const domainId = graph.termId(domain)?.toLowerCase();
  const castsOn = domainId ? weights[domainId] : undefined;

  return (
    <section className="identities" aria-label="identities">
      <div className="identity-cards" role="group">
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
                  <dt>lending</dt>
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

      {session ? (
        <p className="identities-foot">
          <span className="identity-badge">your session</span>
          <span className="identity-note">
            Three wallets made in this browser.{" "}
            <a href={addressUrl(session.submitterAddress)} target="_blank" rel="noreferrer">
              its submitter
            </a>{" "}
            pays for what they do.
          </span>
          <button type="button" className="identity-forget" onClick={onForget}>
            Forget these wallets
          </button>
        </p>
      ) : null}
    </section>
  );
}
