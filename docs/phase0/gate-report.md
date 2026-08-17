# Phase 0 — Gate Report

**Date:** 2026-08-17 · **Verdict: GREEN** — all four gate conditions met.
Commits: `1235267` (bootstrap), `c399847` (bootstrap-v2 reconciliation), `4014a96` (scaffold + red suite).

| Gate condition | Status |
|---|---|
| Framework status on 13579 known | ✅ v1.3.0 fully deployed — Phase 0.5 does not exist |
| Vocabulary table written | ✅ [vocabulary-audit.md](vocabulary-audit.md) + ADR 0008 |
| Five architecture ADRs committed | ✅ ADRs 0003–0007 (plus 0001, 0002, 0008, 0009) |
| Test suite red and comprehensive | ✅ 34 tests; 28 red, all blocked solely on `NotImplemented` |

## 0.a — Delegation Framework on 13579

Delegation Framework **v1.3.0** is live at the canonical CREATE2 addresses, verified
three independent ways (`eth_getCode`, `NAME()`/`DOMAIN_VERSION()` calls, Blockscout
API returning verified source at `pragma solidity 0.8.23`). The v1.0.0 / v1.1.0
managers have no code — v1.3.0 is the only version present, so everything pins v1.3.0.

**All 31/31 standard v1.3.0 enforcers are present**, including `TimestampEnforcer`.
Expiry nevertheless stays in our caveat terms — decision recorded either way in
ADR 0009 (demo-legible parameterized revert; composition is the Mission 11 route).

Address table: see `CLAUDE.md` § Network pinning (single source). Naming note: the
factory's real name in the deployments map is **`SimpleFactory`** — no contract named
"DeleGatorModuleFactory" exists.

## 0.b — Graph vocabulary audit

Full report with re-runnable GraphQL queries: [vocabulary-audit.md](vocabulary-audit.md).

**Headline:** the exact predicate `is a sub-domain of` (`0x9c2e2f…`) and all three
intended triples (`branding→design`, `UX→design`, `logo→branding`) **already exist on
testnet**, seeded 2026-06-23 by `0x6d37…fD03` — evidently a prior run of this same
project. All five domain words exist as raw-string atoms; `legal` is unlinked as
intended. The three triples carry **zero real stake** — under ADR 0004 they authorize
nothing until the attestor deposits, which is precisely the designed behavior.

The bootstrap-v2 instruction "we create these ourselves" and the audit finding "it
already exists" are the same act for raw-string atoms: `calculateAtomId` is pure, so
the idempotent create-if-absent seeder converges onto the existing term_ids (ADR 0008).
Phase 2 therefore reduces on this testnet to **attestor deposits + the JSON manifest**;
the same script seeds a clean chain (mainnet) from scratch.

## 0.c — Decisions recorded

| ADR | Decision |
|---|---|
| [0001](../../.claude/choices/0001-rules-adapted-from-hourglass.md) | Rules copied from Hourglass, adapted for a custom-enforcer repo |
| [0002](../../.claude/choices/0002-delegation-framework-v130-on-13579.md) | Framework v1.3.0 pinned at canonical addresses (0.a evidence) |
| [0003](../../.claude/choices/0003-path-witness-in-args.md) | ADR-A — path witness in `_args`, verified hop-by-hop on-chain |
| [0004](../../.claude/choices/0004-attestation-is-position.md) | ADR-B — attestation is stake position (`> 0`), attestor as governance dial |
| [0005](../../.claude/choices/0005-getvaulttype-not-istriple.md) | ADR-C — `getVaultType == 1`, never `isTriple` |
| [0006](../../.claude/choices/0006-pragma-0.8.23.md) | ADR-D — enforcer pinned at pragma 0.8.23 |
| [0007](../../.claude/choices/0007-narrowing-is-emergent.md) | ADR-E — narrowing is emergent, proven by test, not implemented |
| [0008](../../.claude/choices/0008-vocabulary-reuse.md) | Vocabulary: create-if-absent, raw-string atoms (Proposed — one item is the team's call) |
| [0009](../../.claude/choices/0009-expiry-in-terms-not-timestamp-enforcer.md) | Expiry in our terms; TimestampEnforcer composition noted for Mission 11 |

## 0.d — Test suite state (red by design)

`contracts/` — Foundry, `delegation-framework@v1.3.0` as a git submodule. The
[enforcer skeleton](../../contracts/src/GraphDomainCaveatEnforcer.sol) declares the
full external shape (v2 terms without `minShares`, parameterized custom errors) and
reverts `NotImplemented` until Phase 1.

**Unit suite** (25 tests, `MockMultiVault`, offline): all fourteen §6 cases including
the attestor dial (test 10), plus fuzz (terms roundtrip, valid suffix paths, forged
witnesses). **Fork suite** (9 tests, live 13579): real MultiVault, real
DelegationManager, a signed two-level chain through a real `HybridDeleGator`
(ERC1967 proxy over the deployed implementation).

28 tests are red, every one failing on `NotImplemented` with its precise expected
custom error — implementing `beforeHook` to §4.1 is the single remaining variable.
6 tests are green for verified-right reasons:

- constructor zero-address guards; terms roundtrip; forged-witness fuzz (any revert);
- fork setup sanity — the audit's term_ids match live vault id math;
- the counter-triple trap is real on the live vault (`isTriple(counterId) == true`,
  `getVaultType == 2`) — ADR 0005's premise, not a hypothesis;
- **native revocation** — the manager rejects a disabled root before any hook runs, so
  the test is green with a stub enforcer. That is the right reason: the bounty says
  "write no code for this", and the test proves none is involved.

Two live behaviors were probed on-chain and are mirrored by the mock so unit and fork
tests exercise identical paths: `getVaultType` **reverts** on never-created terms
(the enforcer will try/catch into `NotATriple`), and `isTriple` accepts counter-triples.
The MultiVault's id math is not plain keccak — the enforcer treats `calculateTripleId`
as an oracle-pure function of the vault and never re-implements it.

## Open questions (escalate via Wieedze — non-blocking for Phase 1)

1. Should the domain atoms attach to an existing Intuition Box ontology/namespace?
   The audit found none, but the decision is the team's. Wanted before Phase 2 writes.
2. Is direct `MultiVault` reading the expected interface for the enforcer, or does the
   team have a canonical read layer in mind?

## Next: Phase 1 — Enforcer

Implement `beforeHook` per §4.1 (order of operations already encoded in the tests)
until all 34 tests are green → `forge test --gas-report` with a depth 1→5 table →
`contract-reviewer` agent → deploy to 13579 (needs the funded deployer key in `.env`)
→ verify on Blockscout → confirm verification by polling the explorer API.
