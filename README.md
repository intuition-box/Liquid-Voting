# ERC-7710 Liquid Democracy POC — Intuition Graph Domain Caveats

Intuition Box DAO bounty (Mission 10). A 3-level ERC-7710 delegation chain
(`voter → delegate → executor`) where voting authority is scoped by *domain*, and the
scope check is resolved by traversing the Intuition knowledge graph — so that adding
`branding — is a sub-domain of — design` to the graph extends every `design`-scoped
delegation, **with no contract redeploy and no re-signature**.

The mechanism: each delegation carries a custom caveat, `GraphDomainCaveatEnforcer`.
The redeemer supplies the domain path as a witness (`_args`); the enforcer verifies
every hop against live MultiVault state — existence as a positive triple
(`getVaultType == 1`) *and* attestation by stake position (`getShares(attestor) > 0`).
The graph is the authority; stake is the trust signal.

## Status

| Phase | State |
|---|---|
| 0 — Bootstrap (verify framework, audit vocabulary, ADRs, red tests) | ✅ done — [gate report](docs/phase0/gate-report.md) |
| 1 — Enforcer (implement, gas table, review, deploy + verify) | next |
| 2 — Graph seed (attestor deposits + term_id manifest) | pending |
| 3 — Delegation chain (3 HybridDeleGator accounts, live redemption) | pending |
| 4 — Frontend (5 panels, incl. live graph extension) | pending |
| 5 — Writeup | pending |
| 6 — Presentation (demo script, slides, rehearsal) | pending |

## Layout

```
CLAUDE.md              mission, acceptance criteria, network pinning, routing table
.claude/rules/         house rules (workflow, solidity, security, delegation, ui, code)
.claude/choices/       ADRs 0001–0009 — every architectural decision
.agents/skills/        Intuition skill — source of truth for graph reads/writes
docs/phase0/           gate report + vocabulary audit (re-runnable queries)
contracts/             Foundry project: enforcer, mock governor, unit + fork suites
```

## Contracts quickstart

```bash
cd contracts
forge build
forge test --no-match-path "test/fork/**"   # unit suite (offline, MockMultiVault)
forge test --match-path "test/fork/*"       # fork suite (live Intuition testnet RPC)
```

Network: Intuition testnet, chain id **13579** — addresses and endpoints are pinned in
[CLAUDE.md](CLAUDE.md). MetaMask Delegation Framework **v1.3.0** is deployed there at
its canonical CREATE2 addresses (verified — see ADR 0002).

The test suite is currently **red by design**: Phase 0 wrote all fourteen bounty test
cases against a skeleton enforcer that reverts `NotImplemented`; Phase 1 implements
`beforeHook` until the suite is green.
