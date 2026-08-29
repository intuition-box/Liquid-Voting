# 0013 — The hierarchy and the grants are objects, not loose functions

**Status:** Accepted
**Date:** 2026-08-29
**Triggered by:** user request — audit of dead code, duplicated logic and over-engineering

## Context

"`micro-grants` sits under `treasury`" was answered in five places: a BFS in `graph.ts`,
a second index rebuilt by the tree on every render, a `covers` wrapper in `grants.ts`, an
ancestor slice written inline in a panel, and the on-chain checks. `computePath` was
called ten times from five files, each caller rebuilding the edge index first.

The same held for authority: `upstreamOf`, `candidatesFor` and `weightOn` each took
`(config, edges, grants, holder, domain)` — five parameters that were really the state of
one object.

The two Solidity implementations are a separate matter and stay: the MultiVault has no
reverse index, so the chain cannot walk the graph and the redeemer supplies a witness
(ADR 0003).

## Decision

Two classes own what was scattered. `DomainGraph` indexes nodes and edges once and answers
every parent/child/ancestor question, including producing the witnesses and `domainPath`
the contracts expect. `DelegationSet` holds the grants in force and answers every
authority question, including which signed chain lets an account vote.

`src/lib` is grouped by subject — `chain/`, `graph/`, `delegation/`, `config/`,
`actions/` — rather than kept as a flat list.

## Alternatives considered

- **Keep the free functions, pass the graph** — half the win: it removes the rebuilds but
  leaves the five-parameter signatures and the invariants unenforced.
- **Objectify the action layer too** — rejected. Those functions are stateless by nature
  (a client goes in, a result comes out); wrapping them adds ceremony with no invariant to
  protect. POO pays where there is state to keep coherent.

## Consequences

**Positive:**
- One traversal, indexed once. `ProposalsPanel` stopped walking the graph per row per
  render; `DomainTree` stopped rebuilding its index.
- `domainPathOf()` is the single place that produces the governor's `domainPath` argument,
  which is what prevents a third caller drifting from the contract.
- Cycle detection lives in construction rather than in each consumer — a cycle used to
  overflow the stack and blank the page.

**Negative:**
- Panels take a `graph` and a `delegations` prop where they used to take raw arrays.

**Neutral (worth knowing):**
- Verified at the time by comparing `DomainGraph.pathTo` against the old `computePath` on
  all 49 label pairs of the demo graph: identical results.

## References

- Related ADR: `docs/adr/0003-path-witness-in-args.md` — discovery here, verification on chain.
- Related code: `src/lib/graph/domain-graph.ts`, `src/lib/delegation/delegation-set.ts`
