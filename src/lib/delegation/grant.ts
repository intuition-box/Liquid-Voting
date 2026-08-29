import { decodeTerms, type Delegation } from "./encoding";
import type { AppConfig } from "../config/app-config";
import type { Role } from "../roles";

export { ROLES, ROLE_CLASS, type Role } from "../roles";

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

/** The domain a delegation was scoped to — read from its signed terms, never assumed. */
export function grantScope(config: AppConfig, delegation: Delegation): string {
  const caveat = delegation.caveats[0];
  if (!caveat) return "";
  const termId = decodeTerms(caveat.terms).rootDomainId.toLowerCase();
  return config.nodes.find((node) => node.termId.toLowerCase() === termId)?.label ?? "";
}

/**
 * The delegations the setup scripts signed, expressed as grants.
 *
 * Signed is not the same as in force. The scripts sign a pair so the demo has something
 * to revoke and so the CLI runners have a chain to redeem, but nothing is delegated until
 * someone records the weight transfer at the governor. So a seeded grant counts only when
 * the register agrees — `heldOnChain` says who the governor currently has each account
 * delegating to.
 *
 * That is what lets the app open on a clean slate: three accounts, one vote each, and
 * every delegation on screen made in front of whoever is watching.
 */
export function baseGrants(
  config: AppConfig,
  rootDisabled: boolean,
  leafDisabled: boolean,
  heldOnChain?: (from: Role, scope: string) => Role | null,
): Grant[] {
  const scopeOf = (delegation: Delegation): string => grantScope(config, delegation);
  const rootScope = scopeOf(config.delegations.root);
  const leafScope = scopeOf(config.delegations.leaf);
  // Without a register to consult, fall back to the signature alone — the CLI scripts
  // redeem these chains directly and have no governor state to read.
  const inForce = (from: Role, to: Role, scope: string): boolean =>
    heldOnChain ? heldOnChain(from, scope) === to : true;

  return [
    {
      from: "A",
      to: "B",
      principal: "A",
      scope: rootScope,
      revoked: rootDisabled || !inForce("A", "B", rootScope),
      delegation: config.delegations.root,
    },
    {
      from: "B",
      to: "C",
      // The seeded leaf is chained to the root, so what it carries is A's voice relayed
      // by B — B's own voice never had a grant of its own in the seeded pair.
      principal: "A",
      scope: leafScope,
      // Only its own disabled state: DelegationSet settles the cascade from the signed
      // authority links, so a root revocation reaches this one without being spelled out.
      revoked: leafDisabled || !inForce("B", "C", leafScope),
      delegation: config.delegations.leaf,
    },
  ];
}
