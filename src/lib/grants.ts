import { decodeTerms, type Delegation } from "./delegation";
import type { DemoConfig } from "./demo-config";
import type { Role } from "./roles";

export { ROLES, ROLE_LABELS, ROLE_CLASS, type Role } from "./roles";

/**
 * One signed delegation: who handed what to whom, and whose voice it carries.
 *
 * `from` is who signed it; `principal` is whose voice travels through it. They differ
 * when the signer was relaying a voice lent to it — B handing C the vote A gave B signs
 * `from: delegate, principal: voter`. Keeping them apart is what lets a voice stay
 * attached to whoever cast it: revoking upstream kills the relay without touching the
 * signer's own grant.
 */
export interface Grant {
  from: Role;
  to: Role;
  /** Whose voice this carries — `from` itself unless the grant relays someone else's. */
  principal: Role;
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
      principal: "voter",
      scope: scopeOf(config.delegations.root),
      revoked: rootDisabled,
      delegation: config.delegations.root,
    },
    {
      from: "delegate",
      to: "executor",
      // The seeded leaf is chained to the root, so what it carries is A's voice relayed
      // by B — B's own voice never had a grant of its own in the seeded pair.
      principal: "voter",
      scope: scopeOf(config.delegations.leaf),
      // Only its own disabled state: DelegationSet settles the cascade from the signed
      // authority links, so a root revocation reaches this one without being spelled out.
      revoked: leafDisabled,
      delegation: config.delegations.leaf,
    },
  ];
}
