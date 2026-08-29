import { decodeTerms, type Delegation } from "./delegation";
import type { DemoConfig, Role } from "./demo-config";

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
      // Only its own disabled state: DelegationSet settles the cascade from the signed
      // authority links, so a root revocation reaches this one without being spelled out.
      revoked: leafDisabled,
      delegation: config.delegations.leaf,
    },
  ];
}
