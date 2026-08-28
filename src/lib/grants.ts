import { decodeTerms, type Delegation } from "./delegation";
import type { DemoConfig, Role } from "./demo-config";
import { computePath, type EdgeState } from "./graph";

export const ROLES: Role[] = ["voter", "delegate", "executor"];
export const ROLE_LABELS: Record<Role, string> = { voter: "A", delegate: "B", executor: "C" };
export const ROLE_CLASS: Record<Role, string> = { voter: "role-a", delegate: "role-b", executor: "role-c" };

/** One signed delegation, with the role pair and domain it was granted on. */
export interface Grant {
  from: Role;
  to: Role;
  scope: string;
  revoked: boolean;
  delegation: Delegation & { hash: `0x${string}` };
}

/** The delegations the setup scripts signed, expressed as grants. */
export function baseGrants(config: DemoConfig, rootDisabled: boolean, leafDisabled: boolean): Grant[] {
  const scopeOf = (delegation: Delegation): string => {
    const caveat = delegation.caveats[0];
    if (!caveat) return "";
    const termId = decodeTerms(caveat.terms).rootDomainId.toLowerCase();
    return config.nodes.find((node) => node.termId.toLowerCase() === termId)?.label ?? "";
  };
  return [
    {
      from: "voter",
      to: "delegate",
      scope: scopeOf(config.delegations.root),
      revoked: rootDisabled,
      delegation: config.delegations.root,
    },
    {
      from: "delegate",
      to: "executor",
      scope: scopeOf(config.delegations.leaf),
      revoked: leafDisabled || rootDisabled,
      delegation: config.delegations.leaf,
    },
  ];
}

/** Whether a grant's scope covers `domain` — the same graph question the enforcer asks. */
function covers(edges: EdgeState[], config: DemoConfig, scope: string, domain: string): boolean {
  return computePath(edges, config.nodes, domain, scope).found;
}

/**
 * Everyone whose vote already flows to `holder` **on this domain**, directly or through
 * someone else. Delegating back to one of them would send that weight in a circle.
 *
 * Scoping the question to a domain is what lets the three accounts delegate to each other
 * freely: A granting `design` to B says nothing about `legal`, so C may still grant
 * `legal` to A without any conflict.
 */
export function upstreamOf(
  config: DemoConfig,
  edges: EdgeState[],
  grants: Grant[],
  holder: Role,
  domain: string,
): Set<Role> {
  const live = grants.filter((grant) => !grant.revoked && covers(edges, config, grant.scope, domain));
  const upstream = new Set<Role>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const grant of live) {
      const reachesHolder = grant.to === holder || upstream.has(grant.to);
      if (reachesHolder && !upstream.has(grant.from)) {
        upstream.add(grant.from);
        grew = true;
      }
    }
  }
  return upstream;
}

/** Who a holder may still delegate this domain to: anyone but itself and its upstream. */
export function candidatesFor(
  config: DemoConfig,
  edges: EdgeState[],
  grants: Grant[],
  holder: Role,
  domain: string,
): Role[] {
  const blocked = upstreamOf(config, edges, grants, holder, domain);
  return ROLES.filter((candidate) => candidate !== holder && !blocked.has(candidate));
}

export interface WeightBreakdown {
  /** Total weight the holder casts on this domain. */
  total: bigint;
  /** The holder's own weight, zero once it has delegated this domain away. */
  own: bigint;
  /** Who else's weight the holder carries here. */
  carried: Role[];
  /** Set when the holder delegated this domain to someone else. */
  passedTo: Role | null;
}

/**
 * The weight a holder casts on one domain.
 *
 * Delegating transfers weight rather than copying it: a holder that granted this domain
 * away casts nothing on it, and whoever received the grant casts theirs plus everything
 * flowing in behind it. The totals therefore stay conserved across the three accounts.
 */
export function weightOn(
  config: DemoConfig,
  edges: EdgeState[],
  grants: Grant[],
  votingPower: Record<Role, bigint>,
  holder: Role,
  domain: string,
): WeightBreakdown {
  const live = grants.filter((grant) => !grant.revoked && covers(edges, config, grant.scope, domain));

  const passedTo = live.find((grant) => grant.from === holder)?.to ?? null;
  if (passedTo) return { total: 0n, own: 0n, carried: [], passedTo };

  // Walk the incoming edges: everyone delegating into the holder, and everyone behind them.
  const carried: Role[] = [];
  const queue: Role[] = [holder];
  const seen = new Set<Role>([holder]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const grant of live) {
      if (grant.to !== current || seen.has(grant.from)) continue;
      seen.add(grant.from);
      carried.push(grant.from);
      queue.push(grant.from);
    }
  }

  const own = votingPower[holder] ?? 0n;
  const total = carried.reduce((sum, role) => sum + (votingPower[role] ?? 0n), own);
  return { total, own, carried, passedTo: null };
}
