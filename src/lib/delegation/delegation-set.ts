/**
 * The delegations in force, and what they let each account do.
 *
 * Its counterpart is DomainGraph: the graph knows that `branding` sits under `design`,
 * this knows who handed `design` to whom. Every question about authority — who may still
 * receive a domain, which signed chain lets an account vote — is answered here, from the
 * grants that were actually signed rather than from a fixed pair.
 */
import type { Delegation } from "./encoding";
import type { Role } from "../config/app-config";
import type { DomainGraph } from "../graph/domain-graph";
import { ROLES, type Grant } from "./grant";

/**
 * One voice a holder can exercise, and the signed chain that carries it.
 *
 * A holder carrying two voices redeems two chains, not one object holding both: each
 * voice keeps its own authority, so revoking one leaves the other standing.
 */
export interface VoiceChain {
  /** Whose voice this is — the account whose weight the vote will count. */
  principal: Role;
  /** Delegations in the order the DelegationManager walks them — leaf first. */
  chain: (Delegation & { hash: `0x${string}` })[];
  /** The scope of each link, leaf to root — one path witness is computed per link. */
  scopes: string[];
}

/** Everything a holder may redeem on one domain: the voices, and who redeems them. */
export interface RedeemableChain {
  /** The account that redeems, and that the vote is recorded for. */
  redeemer: Role;
  /** One entry per voice carried, each with its own chain. */
  voices: VoiceChain[];
  /** Whose weight rides along, in `voices` order. */
  principals: Role[];
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
   * Every voice `holder` can exercise on `domain`, each with the chain that carries it.
   *
   * One grant handed to the holder is one voice. Following its authority link back gives
   * the chain the DelegationManager will walk — leaf to root — and the grant's principal
   * says whose weight it actually is, which is not always the signer's: a relayed grant
   * is signed by the middle account and carries the voice of the one behind it.
   *
   * Null when nobody delegated this domain to the holder: there is nothing to redeem, and
   * the holder votes for itself with its own weight.
   */
  chainFor(holder: Role, domain: string): RedeemableChain | null {
    const live = this.liveOn(domain);
    const byHash = new Map(this.grants.map((grant) => [grant.delegation.hash.toLowerCase(), grant]));

    const voices: VoiceChain[] = [];
    for (const incoming of live.filter((grant) => grant.to === holder)) {
      const chain = [incoming.delegation];
      const scopes = [incoming.scope];

      // Climb the authority links: each one names the delegation that authorised it.
      // Bounded by the grant count, which no chain can exceed without repeating a link.
      let current = incoming;
      for (let hop = 0; hop < this.grants.length; hop++) {
        const parent = byHash.get(current.delegation.authority.toLowerCase());
        if (!parent) break;
        chain.push(parent.delegation);
        scopes.push(parent.scope);
        current = parent;
      }
      voices.push({ principal: incoming.principal, chain, scopes });
    }

    if (voices.length === 0) return null;
    return { redeemer: holder, voices, principals: voices.map((voice) => voice.principal) };
  }
}
