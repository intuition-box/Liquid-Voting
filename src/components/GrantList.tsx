import type { DelegationSet } from "../lib/delegation/delegation-set";
import { ROLE_CLASS, ROLE_LABELS, type Grant } from "../lib/delegation/grant";
import { ROLES, type Role } from "../lib/roles";
import { Empty, Mono } from "./primitives";

/**
 * Every delegation in force, as a list.
 *
 * This used to be badges on the domain tree, which could not work: handing a domain on
 * signs one delegation per voice, so a single row had to carry several chains at once and
 * the names they hung off got crowded out. A chain wants a line, not a chip.
 *
 * Rows are grouped by domain, and a relayed voice is written from where it started —
 * A → B → C — so the hop that a revocation would cut is visible rather than inferred.
 */
export function GrantList({
  delegations,
  viewer,
  domain,
}: {
  delegations: DelegationSet;
  /** Who the viewer is acting as; their own rows are marked. */
  viewer: Role;
  /** The domain selected in the rail — its grants come first. */
  domain: string;
}) {
  const live = delegations.all().filter((grant) => !grant.revoked);
  if (live.length === 0) return <Empty>No delegation in force. Hand a domain to someone to start one.</Empty>;

  // The selected domain first, then the rest — the rail's choice stays the subject.
  const byDomain = new Map<string, Grant[]>();
  for (const grant of live) {
    byDomain.set(grant.scope, [...(byDomain.get(grant.scope) ?? []), grant]);
  }
  const scopes = [...byDomain.keys()].sort((a, b) =>
    a === domain ? -1 : b === domain ? 1 : a.localeCompare(b),
  );

  return (
    <div className="grants">
      {scopes.map((scope) => (
        <section key={scope} className="grant-group">
          <h4 className={scope === domain ? "grant-scope grant-scope-on" : "grant-scope"}>{scope}</h4>
          <ul className="grant-rows">
            {(byDomain.get(scope) ?? []).map((grant) => (
              <GrantRow key={grant.delegation.hash} grant={grant} viewer={viewer} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GrantRow({ grant, viewer }: { grant: Grant; viewer: Role }) {
  // A relayed grant is signed by the middle account and carries the voice of the one
  // behind it, so the row reads from the origin rather than from the signature.
  const relayed = grant.principal !== grant.from;
  const hops: Role[] = relayed ? [grant.principal, grant.from, grant.to] : [grant.from, grant.to];
  const involves = hops.includes(viewer);

  return (
    <li className={involves ? "grant-row grant-row-yours" : "grant-row"}>
      <span className="grant-chain">
        {hops.map((role, index) => (
          <span key={`${role}-${index}`}>
            {index > 0 ? <span className="grant-arrow">→</span> : null}
            <span className={`grant-role ${ROLE_CLASS[role]}`}>{ROLE_LABELS[role]}</span>
          </span>
        ))}
      </span>
      <span className="grant-note muted">
        {relayed
          ? `${ROLE_LABELS[grant.from]} passes on ${ROLE_LABELS[grant.principal]}’s vote`
          : `${ROLE_LABELS[grant.from]}’s own vote`}
      </span>
      <Mono dim>{grant.delegation.hash.slice(0, 10)}…</Mono>
    </li>
  );
}

/** What each account can still cast on the selected domain, and what it handed away. */
export function VoiceSummary({ delegations, domain }: { delegations: DelegationSet; domain: string }) {
  return (
    <ul className="voices">
      {ROLES.map((role) => {
        const carried = delegations.chainFor(role, domain);
        const gaveAway = delegations.grantedAway(role, domain) ?? delegations.coveredBy(role, domain);
        return (
          <li key={role} className="voice-row">
            <span className={`grant-role ${ROLE_CLASS[role]}`}>{ROLE_LABELS[role]}</span>
            <span className="voice-note muted">
              {gaveAway
                ? `handed “${gaveAway.scope}” to ${ROLE_LABELS[gaveAway.to]}`
                : carried
                  ? `carries ${carried.principals.map((p) => ROLE_LABELS[p]).join(" + ")} besides its own`
                  : "votes with its own voice"}
            </span>
            <Mono>{gaveAway ? "0" : String(1 + (carried?.voices.length ?? 0))}</Mono>
          </li>
        );
      })}
    </ul>
  );
}
