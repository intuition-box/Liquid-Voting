/**
 * Who may delegate what to whom, and which signed chain carries a vote.
 *
 * The cascade is the part worth pinning down. A chained delegation carries its parent's
 * hash as `authority`, so disabling the parent kills everything hanging off it — that is
 * the DelegationManager's rule, not ours, and this mirrors it client-side so a dead
 * chain is never offered and left to revert on chain.
 */
import { describe, expect, test } from "bun:test";

import { DelegationSet } from "./delegation-set";
import type { Grant } from "./grant";
import type { Delegation } from "./encoding";
import { DomainGraph } from "../graph/domain-graph";
import type { DomainNode, EdgeState } from "../graph/edges";
import type { Role } from "../roles";

const ROOT_AUTHORITY = `0x${"f".repeat(64)}` as `0x${string}`;
const hash = (name: string): `0x${string}` => `0x${name.padEnd(64, "0")}` as `0x${string}`;
const id = (label: string): `0x${string}` => `0x${label.padEnd(64, "1")}` as `0x${string}`;

const nodes: DomainNode[] = ["governance", "treasury", "grants"].map((l) => ({ label: l, termId: id(l) }));
const edges: EdgeState[] = [
  { child: "treasury", parent: "governance", tripleId: id("t-g"), vaultType: 1, attestorShares: 1n, isAuthorizing: true, readError: null },
  { child: "grants", parent: "treasury", tripleId: id("g-t"), vaultType: 1, attestorShares: 1n, isAuthorizing: true, readError: null },
];
const graph = DomainGraph.from(nodes, edges);

function grant(
  name: string,
  from: Role,
  to: Role,
  scope: string,
  { principal = from, authority = ROOT_AUTHORITY, revoked = false }: Partial<{ principal: Role; authority: `0x${string}`; revoked: boolean }> = {},
): Grant {
  const delegation = { delegate: to, delegator: from, authority, caveats: [], salt: "0x0", signature: "0x" } as unknown as Delegation & {
    hash: `0x${string}`;
  };
  return { from, to, principal, scope, revoked, delegation: { ...delegation, hash: hash(name) } };
}

describe("the revocation cascade", () => {
  test("killing a grant kills what was signed on its authority", () => {
    // A → B on treasury, then B relays A's voice to C against that grant's hash.
    const root = grant("a", "A", "B", "treasury", { revoked: true });
    const relay = grant("b", "B", "C", "treasury", { principal: "A", authority: hash("a") });
    const set = new DelegationSet([root, relay], graph);
    expect(set.all().every((g) => g.revoked)).toBe(true);
  });

  test("and leaves alone what stands on its own authority", () => {
    const root = grant("a", "A", "B", "treasury", { revoked: true });
    // B's own voice was signed against ROOT_AUTHORITY, so A taking its grant back
    // silences the relay but not this.
    const own = grant("c", "B", "C", "treasury");
    const set = new DelegationSet([root, own], graph);
    expect(set.all().find((g) => g.delegation.hash === hash("c"))?.revoked).toBe(false);
  });
});

describe("what a holder can redeem", () => {
  test("nothing, when nobody handed it anything", () => {
    const set = new DelegationSet([grant("a", "A", "B", "treasury")], graph);
    expect(set.chainFor("C", "treasury")).toBeNull();
  });

  test("one voice per grant received, with the chain the manager will walk", () => {
    const root = grant("a", "A", "B", "treasury");
    const relay = grant("b", "B", "C", "treasury", { principal: "A", authority: hash("a") });
    const own = grant("c", "B", "C", "treasury");
    const carried = new DelegationSet([root, relay, own], graph).chainFor("C", "treasury");

    expect(carried?.principals.sort()).toEqual(["A", "B"]);
    // The relayed voice is two links — leaf first, then the grant it derives from.
    const relayed = carried?.voices.find((v) => v.principal === "A");
    expect(relayed?.chain.map((d) => d.hash)).toEqual([hash("b"), hash("a")]);
    // B's own voice stands alone.
    expect(carried?.voices.find((v) => v.principal === "B")?.chain).toHaveLength(1);
  });

  test("a grant on a parent carries the domains beneath it", () => {
    const set = new DelegationSet([grant("a", "A", "B", "treasury")], graph);
    expect(set.chainFor("B", "grants")?.principals).toEqual(["A"]);
  });
});

describe("the cycle guard", () => {
  test("weight that already flows to you cannot be sent back", () => {
    const set = new DelegationSet([grant("a", "A", "B", "treasury")], graph);
    // B holds A's voice on treasury, so handing treasury back to A would loop it.
    expect(set.candidatesFor("B", "treasury")).toEqual(["C"]);
    expect([...set.upstreamOf("B", "treasury")]).toEqual(["A"]);
  });

  test("and it is per domain, so the same pair is free elsewhere", () => {
    const set = new DelegationSet([grant("a", "A", "B", "treasury")], graph);
    // Nothing was delegated on governance, so B may hand it to A.
    expect(set.candidatesFor("B", "governance").sort()).toEqual(["A", "C"]);
  });
});
