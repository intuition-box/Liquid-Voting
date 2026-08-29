# 0009 — Expiry lives in our terms; TimestampEnforcer composition noted for Mission 11

**Status:** Accepted
**Date:** 2026-08-17
**Triggered by:** Phase 0.a (bootstrap v2) — "check which standard enforcers are
present — if `TimestampEnforcer` is there, expiry can compose with it instead of living
in our terms; record that decision either way."

## Context

Verified 2026-08-17 via batched `eth_getCode` on 13579: **all 31 standard v1.3.0
enforcers are present** at their canonical addresses, including `TimestampEnforcer`
(`0x1046bb45C8d673d4ea75321280DB34899413c069`). Expiry could therefore be expressed as
a second caveat (`TimestampEnforcer` with a validity window) instead of the `uint64
expiry` field in the `GraphDomainCaveatEnforcer` terms.

## Decision

Keep `expiry` in our terms, as §4.1 of the bootstrap specifies.

- §4.1 is decided architecture; the terms shape
  (`rootDomainId, predicateId, maxDepth, expiry, attestor`) stays as designed.
- Demo legibility: our enforcer reverts with a parameterized custom error
  (`DelegationExpired(expiry, blockTimestamp)`) that the frontend surfaces verbatim —
  the demo's revert reasons are a first-class feature. A composed `TimestampEnforcer`
  failure is a generic framework revert, less legible on stage.
- One caveat per delegation keeps the signed payloads and the chain display simple for
  the presentation.

The composition route is real and framework-native: a production deployment (Mission 11)
should prefer composing the audited `TimestampEnforcer` and *dropping* `expiry` from the
custom terms — smaller custom surface, reuses audited code. Recorded in the writeup as a
Mission 11 recommendation.

## Alternatives considered

- **Compose `TimestampEnforcer`, drop `expiry` from terms** — deferred to Mission 11
  (see above); rejected here for demo legibility and to keep the decided §4.1 shape.
- **Both (expiry in terms *and* composed)** — rejected; redundant checks with divergent
  revert behavior is confusion, not defense.

## Consequences

**Positive:**
- Expiry failures are demoable with a specific, parameterized revert reason.
- Test 5 (§6) exercises our own code path; coverage of the enforcer surface stays
  meaningful.

**Negative:**
- We re-implement (trivially) something an audited enforcer already does — accepted for
  a POC, flagged for Mission 11.

**Neutral (worth knowing):**
- The full 31-enforcer inventory means future compositions (e.g. `LimitedCallsEnforcer`
  to cap redemptions per delegation) are available on 13579 without any deployment work.

## References

- Related ADR: `0002-delegation-framework-v130-on-13579.md`
- Bootstrap: §4.1 (terms shape), §5 Phase 0.a (v2)
