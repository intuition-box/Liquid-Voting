import { decodeTerms, type Delegation } from "./delegation";
import type { DemoConfig, Role } from "./demo-config";
import type { DomainGraph } from "./domain-graph";

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

/**
 * Everyone whose vote already flows to `holder` **on this domain**, directly or through
 * someone else. Delegating back to one of them would send that weight in a circle.
 *
 * Scoping the question to a domain is what lets the three accounts delegate to each other
 * freely: A granting `design` to B says nothing about `legal`, so C may still grant
 * `legal` to A without any conflict.
 */
export function upstreamOf(graph: DomainGraph, grants: Grant[], holder: Role, domain: string): Set<Role> {
  const live = grants.filter((grant) => !grant.revoked && graph.isDescendantOf(domain, grant.scope));
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
export function candidatesFor(graph: DomainGraph, grants: Grant[], holder: Role, domain: string): Role[] {
  const blocked = upstreamOf(graph, grants, holder, domain);
  return ROLES.filter((candidate) => candidate !== holder && !blocked.has(candidate));
}
