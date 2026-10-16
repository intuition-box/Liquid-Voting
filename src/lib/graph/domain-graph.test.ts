/**
 * Scope resolution, which is the claim the whole project rests on: a grant reaches a
 * domain when the graph carries an attested path from that domain up to the granted one.
 *
 * The case that matters most is the negative one. An edge that exists but carries no
 * attestor stake must not authorise anything — triples are permissionless, so anyone can
 * mint `events is a sub-domain of treasury` for a fraction of a cent, and existence is
 * not attestation (ADR 0004).
 */
import { describe, expect, test } from "bun:test";

import { checkDomainLabel, DomainGraph, MAX_DOMAIN_LABEL } from "./domain-graph";
import type { DomainNode, EdgeState } from "./edges";

const id = (label: string): `0x${string}` =>
  `0x${label.padEnd(32, "0").slice(0, 32).split("").map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}` as `0x${string}`;

const nodes: DomainNode[] = ["governance", "treasury", "grants", "micro", "events"].map((label) => ({
  label,
  termId: id(label),
}));

function edge(child: string, parent: string, authorising = true): EdgeState {
  return {
    child,
    parent,
    tripleId: id(`${child}|${parent}`),
    vaultType: authorising ? 1 : 2,
    attestorShares: authorising ? 1n : 0n,
    isAuthorizing: authorising,
    readError: null,
  };
}

//  governance ── treasury ── grants ── micro
//             └─ events, linked but unattested
const graph = DomainGraph.from(nodes, [
  edge("treasury", "governance"),
  edge("grants", "treasury"),
  edge("micro", "grants"),
  edge("events", "governance", false),
]);

describe("reaching a domain from a grant", () => {
  test("a domain is beneath itself, so a grant on it covers it", () => {
    expect(graph.isDescendantOf("treasury", "treasury")).toBe(true);
  });

  test("a grant reaches straight down and several hops down", () => {
    expect(graph.isDescendantOf("grants", "treasury")).toBe(true);
    expect(graph.isDescendantOf("micro", "treasury")).toBe(true);
    expect(graph.isDescendantOf("micro", "governance")).toBe(true);
  });

  test("and never upwards or sideways", () => {
    expect(graph.isDescendantOf("treasury", "grants")).toBe(false);
    expect(graph.isDescendantOf("events", "treasury")).toBe(false);
  });

  test("an edge nobody staked on authorises nothing, though it exists", () => {
    // The counter-triple trap in miniature: the edge is in the graph and is drawn in the
    // rail, but no attestor holds a position on it, so it carries no authority.
    expect(graph.isDescendantOf("events", "governance")).toBe(false);
    expect(graph.pathTo("events", "governance").found).toBe(false);
  });
});

describe("the witness a vote announces", () => {
  test("is the path itself, child first, and the enforcer rechecks every hop of it", () => {
    const path = graph.pathTo("micro", "treasury");
    expect(path.found).toBe(true);
    if (!path.found) return;
    expect(path.path).toEqual([id("micro"), id("grants"), id("treasury")]);
  });

  test("a domain reaching itself needs one term and no hops", () => {
    const path = graph.pathTo("treasury", "treasury");
    expect(path.found).toBe(true);
    if (path.found) expect(path.path).toEqual([id("treasury")]);
  });

  test("there is no witness where there is no attested route", () => {
    expect(graph.pathTo("treasury", "micro").found).toBe(false);
  });
});

describe("the shape of the tree", () => {
  test("a root is a domain nothing authorising climbs out of", () => {
    expect(graph.roots()).toEqual(["governance"]);
  });

  test("children are listed whether or not their edge authorises anything", () => {
    // The rail draws the graph as it is; authority is a separate question it marks.
    expect(graph.childrenOf("governance").sort()).toEqual(["events", "treasury"]);
    expect(graph.childrenOf("micro")).toEqual([]);
  });
});

describe("checkDomainLabel", () => {
  test("refuses an empty label, which is what reached the MultiVault as 0x", () => {
    expect(checkDomainLabel("", graph)).toEqual({ ok: false, reason: "a domain needs a name" });
  });

  test("refuses a label that is only whitespace — it used to mint and cost", () => {
    expect(checkDomainLabel("   ", graph).ok).toBe(false);
  });

  test("trims, so the label checked is the label minted", () => {
    expect(checkDomainLabel("  motion design  ", graph)).toEqual({ ok: true, label: "motion design" });
  });

  test("refuses a label already in the graph: atoms are content-addressed, so it would hang in two places", () => {
    const check = checkDomainLabel("treasury", graph);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("already a domain");
  });

  test("refuses the edge separator, which the manifest splits keys on", () => {
    expect(checkDomainLabel("a — b", graph).ok).toBe(false);
  });

  test("refuses a label past the cap", () => {
    expect(checkDomainLabel("x".repeat(MAX_DOMAIN_LABEL + 1), graph).ok).toBe(false);
    expect(checkDomainLabel("x".repeat(MAX_DOMAIN_LABEL), graph).ok).toBe(true);
  });
});
