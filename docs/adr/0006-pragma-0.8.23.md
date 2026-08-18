# 0006 — Enforcer pinned at pragma 0.8.23 (bootstrap ADR-D)

**Status:** Accepted
**Date:** 2026-08-17
**Triggered by:** Bootstrap §4; deviation from `.claude/rules/solidity.md`.

## Context

`.claude/rules/solidity.md` mandates pragma `^0.8.24`. But the deployed Delegation
Framework v1.3.0 (ADR 0002) pins `pragma solidity 0.8.23` — an exact version, not a
caret range — in `ICaveatEnforcer.sol` and `Types.sol`, which the enforcer must import.
`0.8.23` cannot satisfy `^0.8.24`; a `^0.8.24` contract cannot compile against them.

## Decision

`GraphDomainCaveatEnforcer` (and any contract importing framework types) is
`pragma solidity 0.8.23`. The rule file carries the exception with a pointer to this
ADR.

**Implementation note (2026-08-17, from the Phase 1 security review, finding I-2):**
contracts that do not import framework code (`MockGovernor`, `IMultiVault`,
`MockMultiVault`, the test files, `Deploy.s.sol`) use `pragma solidity >=0.8.23 <0.9.0`
rather than `^0.8.24`. They share compilation units with the exact-pinned enforcer
(tests and scripts import both), and solc must find one version satisfying every
pragma in a unit — `^0.8.24` would make that impossible. The range keeps them
compilable standalone on newer compilers while co-compiling at 0.8.23 here.

## Alternatives considered

- **Vendor the framework interfaces and re-pragma them** — rejected; editing vendored
  interfaces invites drift from the deployed bytecode's ABI and violates
  "never invent a function signature."
- **Bump the rule to `^0.8.23`** — rejected; the rule's intent (modern compiler floor)
  is right for the rest of the repo. A scoped exception is honest; a loosened rule is
  drift.

## Consequences

**Positive:**
- Interfaces match the deployed v1.3.0 framework exactly.

**Negative:**
- Two compiler versions in one Foundry project (0.8.23 and ^0.8.24) — Foundry resolves
  per-file automatically, but `foundry.toml` must not force a single `solc`.

**Neutral (worth knowing):**
- The rule deviation is recorded in `solidity.md` itself (see ADR 0001).

## References

- Related rule: `.claude/rules/solidity.md`
- Related ADR: `0001-rules-adapted-from-hourglass.md`, `0002-delegation-framework-v130-on-13579.md`
