# 0007 — Narrowing is emergent, not implemented (bootstrap ADR-E)

**Status:** Accepted
**Date:** 2026-08-17
**Triggered by:** Bootstrap §4 (architecture decided pre-Phase-0).

## Context

The demo chain narrows scope down the levels: `voter → delegate` carries root `design`;
`delegate → executor` carries root `UX`. A naive design would add "child scope must be
under parent scope" logic — checked at signing time, or by the enforcer inspecting the
rest of the chain.

The Delegation Framework already composes caveats across the chain: on redemption,
**every** enforcer instance on **every** delegation in the array runs, and all must
pass. Restrictions compound by construction.

## Decision

Write **no narrowing code**. Both `GraphDomainCaveatEnforcer` instances run on the
executor's redemption: the proposal's domain must verify a path to `UX` (level 2's
terms) *and* a path to `design` (level 1's terms). The intersection **is** the
narrowing. A `branding` proposal under the `UX`-narrowed chain fails level 2's check
even though it would pass level 1's — which is §6 test 14, a headline property of the
demo, proven by test rather than implemented by code.

Note the emergent semantics are an *intersection*, not a subset relation: nothing forces
level 2's root to actually be under level 1's root. A delegate who "narrows" to a
disjoint domain produces a chain where nothing can pass both checks — a dead delegation,
not an escalation. Escalation is impossible precisely because level 1's enforcer still
runs.

## Alternatives considered

- **Signing-time subset validation (TS side)** — worth having as UX guidance in the
  frontend (warn before signing a dead delegation), but it is advisory, not
  enforcement; not part of the trust model.
- **Enforcer-side chain inspection** — rejected; enforcers see only their own terms by
  design, and re-deriving chain context inside a caveat fights the framework's
  composition model.

## Consequences

**Positive:**
- Zero code, zero new attack surface; the property is inherited from the framework's
  already-audited composition semantics.

**Negative:**
- The property must be *demonstrated* (test 14 + frontend) or reviewers will assume
  narrowing logic is missing rather than emergent — the writeup must make the argument
  explicitly.

**Neutral (worth knowing):**
- Each level's check runs under its own signer's attestor view (ADR 0004): level 1
  verifies through the voter's staked edges, level 2 through the delegate's.

## References

- Related ADR: `0003-path-witness-in-args.md`, `0004-attestation-is-position.md`
- Framework fact: `.claude/rules/metamask-delegation.md` ("every enforcer in the whole
  chain must pass")
