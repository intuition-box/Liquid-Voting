# 0004 — Attestation is *position*, not existence (bootstrap ADR-B)

**Status:** Accepted
**Date:** 2026-08-17
**Triggered by:** Bootstrap §4 (architecture decided pre-Phase-0).

## Context

Intuition triples are permissionless: anyone can mint
`legal — is a sub-domain of — design` for ~1e15 wei on testnet. If the enforcer treated
triple *existence* as authorization, the acceptance criterion "a `legal` proposal fails"
would break for a purely accidental reason — any griefer extends any delegation's scope
for pocket change. Existence is not attestation. **The signal is the stake.**

## Decision

Each hop additionally requires the attestor to hold a position on that triple:

```solidity
if (MV.getShares(attestor, tripleId, curveId) < minShares) revert NotAttested();
```

- `attestor` defaults to `_delegator` (available in the hook), overridable via terms so
  a voter can say *"use the DAO's curation, not mine."*
- `minShares` lives in terms; `minShares == 0` is existence-only mode — kept
  deliberately so the writeup can compare the two regimes.

With the default, semantic expansion only follows edges **the signer personally staked
on** — each level of the delegation chain is interpreted through its own signer's view
of the graph. That makes this a *trust*-layer integration rather than a lookup table,
and it is a deep fit with liquid democracy: delegating within `design` means "within
what *I* (or my chosen curator) recognize as design."

## Alternatives considered

- **Existence-only check** — rejected as the default; permissionless minting makes
  scope injection cost ~1e15 wei (kept as the `minShares = 0` degenerate mode for
  comparison).
- **Total-stake threshold on the triple (anyone's shares)** — rejected; an attacker
  can stake on their own forged edge. Whose stake matters, not how much in aggregate.
- **Stake ratio vs the counter-triple vault** — deferred to Mission 11; noted in the
  writeup's limitations (`minShares` is a blunt threshold; production probably wants a
  ratio against organized dissent).

## Consequences

**Positive:**
- Graph-poisoning attacks are neutralized: a minted edge nobody trusted authorizes
  nothing.
- The delegation's scope is anchored to an accountable identity (delegator or named
  curator), visible on-chain.

**Negative:**
- Phase 2 must fund and execute attestor deposits on every edge (existence alone has no
  teeth); the demo needs tTRUST for stakes, not just gas.
- If the attestor redeems their shares, previously valid paths stop verifying —
  delegations weaken silently. That is the feature *and* the risk; the honest framing
  is that this ADR bounds scope drift to the attestor's own actions.

**Neutral (worth knowing):**
- The 0.b audit (ADR 0008) found the three intended sub-domain triples already exist on
  testnet but carry **zero** real positions — under this ADR they authorize nothing
  until our attestor deposits, which is exactly the designed behavior.

## References

- Related ADR: `0003-path-witness-in-args.md`, `0008-vocabulary-reuse.md`
- Related rule: `.claude/rules/security.md` (front-running / MEV section)
