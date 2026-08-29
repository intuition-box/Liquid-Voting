/**
 * The delegations in force, and what they let each account do.
 *
 * Its counterpart is DomainGraph: the graph knows that `branding` sits under `design`,
 * this knows who handed `design` to whom. Every question about authority — who may still
 * receive a domain, which signed chain lets an account vote — is answered here, from the
 * grants that were actually signed rather than from a fixed pair.
 */
import type { Delegation } from "./delegation";
import type { Role } from "./demo-config";
import type { DomainGraph } from "./domain-graph";
import { ROLES, type Grant } from "./grants";

/** A chain ready to redeem: the delegations, leaf to root, and whose weight it carries. */
export interface RedeemableChain {
  /** Delegations in the order the DelegationManager walks them — leaf first. */
  chain: (Delegation & { hash: `0x${string}` })[];
  /** The account that redeems, and that the vote is recorded for. */
  redeemer: Role;
  /** The delegators up the chain, whose weight rides along. */
  principals: Role[];
  /** The scope of each link, leaf to root — one path witness is computed per link. */
  scopes: string[];
}

export class DelegationSet {
  private readonly grants: readonly Grant[];

  /**
   * Takes the grants and settles the cascade once.
   *
   * A chained delegation carries its parent's hash as `authority`, so disabling the parent
   * kills it too — the DelegationManager refuses the whole chain, and no redemption below
   * a dead link can succeed. That is the framework's rule, not ours, so a grant whose
   * upstream is revoked is marked revoked here rather than offered and left to revert.
   */
  constructor(grants: readonly Grant[], private readonly graph: DomainGraph) {
    const deadHashes = new Set(
      grants.filter((grant) => grant.revoked).map((grant) => grant.delegation.hash.toLowerCase()),
    );
    // Repeat until nothing new dies: killing a link may orphan the one hanging off it.
    let settled = false;
    while (!settled) {
      settled = true;
      for (const grant of grants) {
        const authority = grant.delegation.authority.toLowerCase();
        if (deadHashes.has(authority) && !deadHashes.has(grant.delegation.hash.toLowerCase())) {
          deadHashes.add(grant.delegation.hash.toLowerCase());
          settled = false;
        }
      }
    }
    this.grants = grants.map((grant) =>
      grant.revoked || !deadHashes.has(grant.delegation.hash.toLowerCase())
        ? grant
        : { ...grant, revoked: true },
    );
  }

  /** Every grant, with the cascade already applied. */
  all(): readonly Grant[] {
    return this.grants;
  }

  /** Grants still standing whose scope covers this domain. */
  liveOn(domain: string): Grant[] {
    return this.grants.filter(
      (grant) => !grant.revoked && this.graph.isDescendantOf(domain, grant.scope),
    );
  }

  /**
   * Everyone whose vote already flows to `holder` on this domain, directly or through
   * someone else. Delegating back to one of them would send that weight in a circle.
   *
   * Scoping the question to a domain is what lets the three accounts delegate to each
   * other freely: A granting `design` to B says nothing about `legal`, so C may still
   * grant `legal` to A without any conflict.
   */
  upstreamOf(holder: Role, domain: string): Set<Role> {
    const live = this.liveOn(domain);
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
  candidatesFor(holder: Role, domain: string): Role[] {
    const blocked = this.upstreamOf(holder, domain);
    return ROLES.filter((candidate) => candidate !== holder && !blocked.has(candidate));
  }

  /** The grant that hands this exact domain from `holder` to someone else. */
  grantedAway(holder: Role, domain: string): Grant | null {
    return this.grants.find((grant) => !grant.revoked && grant.from === holder && grant.scope === domain) ?? null;
  }

  /**
   * The grant on an ancestor that already carries this domain away — the client-side
   * mirror of the governor's `CoveredByParent`. Granting a domain hands its sub-domains
   * over with it, so the parent has to come back before this one can move.
   */
  coveredBy(holder: Role, domain: string): Grant | null {
    const ancestors = this.graph.ancestorsOf(domain);
    return (
      this.grants.find(
        (grant) => !grant.revoked && grant.from === holder && ancestors.includes(grant.scope),
      ) ?? null
    );
  }

  /**
   * The signed chain that lets `holder` vote on `domain`, leaf to root.
   *
   * Walks the grants backwards from the holder: whoever handed it this domain, whoever
   * handed it to them, and so on. The result is the delegations that were really signed,
   * which is what replaced picking a fixed pair — sign a new grant and it is the one that
   * gets redeemed.
   *
   * Null when nobody delegated this domain to the holder: there is no chain to redeem,
   * and the holder votes for itself with its own weight.
   */
  chainFor(holder: Role, domain: string): RedeemableChain | null {
    const live = this.liveOn(domain);
    const chain: RedeemableChain["chain"] = [];
    const principals: Role[] = [];
    const scopes: string[] = [];

    // Bounded by the role count: a chain cannot visit the same account twice without
    // circling, and the governor refuses circular delegation in the first place.
    const seen = new Set<Role>([holder]);
    let current = holder;
    for (let hop = 0; hop < ROLES.length; hop++) {
      const incoming = live.find((grant) => grant.to === current && !seen.has(grant.from));
      if (!incoming) break;
      chain.push(incoming.delegation);
      scopes.push(incoming.scope);
      principals.push(incoming.from);
      seen.add(incoming.from);
      current = incoming.from;
    }

    if (chain.length === 0) return null;
    return { chain, redeemer: holder, principals, scopes };
  }
}
