# 0014 — On-chain bounds are read, never copied

**Status:** Accepted
**Date:** 2026-08-29
**Triggered by:** user challenge — "sortir des bornes de solidity me paraît bizarre car les SC doivent être on-chain"

## Context

`MockGovernor.MAX_DOMAIN_PATH` caps how long a domain path may be. It is a security
bound: it limits the verification loops against a hand-crafted path, so it must be
enforced on chain and nowhere else.

But the client did not know it existed. `computePath` would happily produce a seven-domain
path, the user signed, paid, and discovered `DomainPathTooLong` in a revert.

## Decision

The constant stays in Solidity as the only authority. The client reads it through its
public getter at load time and refuses an over-long path before offering it — the same
rule the seeder already follows for `getAtomCost`, `getTripleCost` and
`getBondingCurveConfig`: query, never hardcode.

Redundancy for the user's benefit, never for correctness.

## Alternatives considered

- **Copy the value into TypeScript** — rejected: two sources for one bound, and a redeploy
  with a different cap would silently desynchronise them.
- **Do nothing** — the contract is still safe, but the UI proposes trips that cannot
  complete, and the user pays to find out.

## Consequences

**Positive:**
- Redeploy the governor with another cap and the UI follows on its own.
- A path too long is refused before a signature is asked for.

**Negative:**
- One extra read at load time.

**Neutral (worth knowing):**
- The on-chain check must never be removed on the grounds that the client filters already.
  The comment above `readGraphLimits` says so, deliberately.

## References

- Related code: `src/lib/actions/voting.ts` (`readGraphLimits`), `contracts/src/MockGovernor.sol`
- Related practice: `scripts/seed-graph.ts` — "governance-configurable — query, never hardcode"
