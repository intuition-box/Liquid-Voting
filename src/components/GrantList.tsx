import type { DelegationSet } from "../lib/delegation/delegation-set";
import { ROLE_CLASS, ROLE_LABELS, type Grant } from "../lib/delegation/grant";
import type { Role } from "../lib/roles";
import { Empty, Mono } from "./primitives";

/**
 * The delegations in force on the selected domain.
 *
 * This used to be badges on the domain tree, which could not work: handing a domain on
 * signs one delegation per voice, so a single row had to carry several chains at once and
 * the names they hung off got crowded out. A chain wants a line, not a chip.
 *
 * The rail already picks the domain, so the list answers for that one — a grant on a
 * parent is shown too, since it reaches here just as surely as one signed on this domain.
 * A relayed voice is written from where it started — A → B → C — so the hop a revocation
 * would cut is visible rather than inferred.
 */
export function GrantList({
  delegations,
  viewer,
  domain,
}: {
  delegations: DelegationSet;
  /** Who the viewer is acting as; their own rows are marked. */
  viewer: Role;
  /** The domain picked in the rail. */
  domain: string;
}) {
  const live = delegations.liveOn(domain);
  if (live.length === 0) {
    return <Empty>Nothing delegated on “{domain}”. Hand it to someone below to start a chain.</Empty>;
  }

  // Grants signed on this domain first, then the ones inherited from a parent.
  const here = live.filter((grant) => grant.scope === domain);
  const inherited = live.filter((grant) => grant.scope !== domain);

  return (
    <div className="grants">
      <ul className="grant-rows">
        {here.map((grant) => (
          <GrantRow key={grant.delegation.hash} grant={grant} viewer={viewer} />
        ))}
      </ul>
      {inherited.length > 0 ? (
        <>
          <h4 className="grant-scope">inherited from above</h4>
          <ul className="grant-rows">
            {inherited.map((grant) => (
              <GrantRow key={grant.delegation.hash} grant={grant} viewer={viewer} showScope />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function GrantRow({ grant, viewer, showScope }: { grant: Grant; viewer: Role; showScope?: boolean }) {
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
        {showScope ? ` · granted on “${grant.scope}”` : ""}
      </span>
      <Mono dim>{grant.delegation.hash.slice(0, 10)}…</Mono>
    </li>
  );
}
