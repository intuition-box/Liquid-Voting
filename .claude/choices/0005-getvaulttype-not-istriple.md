# 0005 — Triple existence check is `getVaultType == 1`, never `isTriple` (bootstrap ADR-C)

**Status:** Accepted
**Date:** 2026-08-17
**Triggered by:** Bootstrap §4 (architecture decided pre-Phase-0).

## Context

Every Intuition triple has a counter-triple — the vault for staking *against* the
relation. `getCounterIdFromTripleId(tripleId)` derives its id, and critically,
**`isTriple(counterTripleId)` returns `true`**: the function answers "is this id in the
triple family?", not "is this a positive assertion?".

The attack this enables: an attacker mints (or merely derives the id of) the
counter-triple of a valid relation — the vault that means *"branding is NOT a sub-domain
of design"* — and presents it in a path. An enforcer using `isTriple` as its existence
check would accept a hop whose on-chain meaning is the *negation* of the claimed edge.

## Decision

The enforcer classifies every hop with the precise classifier:

```solidity
if (MV.getVaultType(tripleId) != 1) revert NotATriple(tripleId); // 0=ATOM 1=TRIPLE 2=COUNTER_TRIPLE
```

`isTriple` is never called. This one check rejects atoms (0), counter-triples (2), and
non-existent terms in a single read.

Note the hop id is *computed* by the enforcer
(`calculateTripleId(path[i], predicateId, path[i+1])`), not supplied — so the attacker
cannot pass a counter-triple id directly. The check matters because the computed id
itself must be confirmed to exist *as a positive triple*, and because any future
variant that accepts term ids from the witness would otherwise inherit the trap.

## Alternatives considered

- **`isTriple(id)`** — rejected: true for counter-triples (the vulnerability).
- **`isTriple(id) && !isCounterTriple(id)`** — functionally equivalent but two calls
  where one suffices, and it leaves `isTriple` in the codebase as an attractive
  nuisance for future edits.
- **`isTermCreated(id)`** — worse still: true for atoms too.

## Consequences

**Positive:**
- The counter-triple attack (dedicated test, §6 test 8) is structurally closed.

**Negative:**
- none.

**Neutral (worth knowing):**
- `getVaultType` reverts or returns distinctly for non-created terms depending on
  MultiVault version — the unit suite pins our assumption and the fork test verifies it
  against the real deployment.

## References

- Related ADR: `0003-path-witness-in-args.md`
- Skill warning: `.agents/skills/intuition/reference/reading-state.md` (coarse
  `isTriple` note)
