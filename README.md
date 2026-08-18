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
| 0 — Bootstrap (verify framework, audit vocabulary, ADRs, red tests) | done — [gate report](docs/phase0/gate-report.md) |
| 1 — Enforcer (implement, gas table, review, deploy + verify) | done — 46/46 green, [gas table](docs/phase1/gas-report.md), [security review](contracts/SECURITY_REVIEW.md) clean, deployed + verified on 13579 ([manifest](manifest/13579.json)) |
| 2 — Graph seed (attestor deposits + term_id manifest) | done — idempotent [seeder](scripts/seed.ts), org-attestor staked on all 3 edges, [manifest](manifest/13579.json) filled; live enforcer smoke-tested (branding passes, legal reverts) |
| 3 — Delegation chain (3 HybridDeleGator accounts, live redemption) | done — all six acceptance flows verified live on 13579 (`bun run phase3:run`): chain redemption, narrowing, maxDepth, legal rejection, revocation |
| 4 — Frontend (5 panels, incl. live graph extension) | done — `bun run dev`, five panels on the shared service layer; `bun run verify` green against live state |
| 5 — Writeup | done — [WRITEUP.md](WRITEUP.md) |
| 6 — Presentation (demo script, slides, rehearsal) | done — [DEMO.md](DEMO.md), [slide outline](docs/slides.md), rehearsed live (`bun run rehearse`: 4.1 s, 0.0071 tTRUST) |

## Layout

```
WRITEUP.md             design decisions, gas, limitations, Mission 11 notes
DEMO.md                ordered demo script with expected output and recovery moves
docs/adr/              ADRs 0001–0011 — every architectural decision, with rejected alternatives
docs/phase0/           gate report + vocabulary audit (re-runnable queries)
docs/delegation-flow.excalidraw   sequence diagram of the signature + execution flow
contracts/             Foundry project: enforcer, mock governor, unit + fork suites
scripts/               CLI: seed, account setup, delegation signing, acceptance runner, verify
src/                   frontend — lib/ services, hooks/, components/ (five panels)
```

## Demo quickstart

```bash
bun install
bun run verify   # read-only: asserts every panel's behaviour against live chain state
bun run dev      # http://localhost:5173
```

The frontend reads the same artefacts the scripts write (`manifest/13579.json`,
`data/accounts.json`, `data/delegations.json`). On a fresh clone, create them first:

```bash
bun run seed            # attestor stakes on every graph edge (Phase 2)
bun run phase3:setup    # deploy + fund the three HybridDeleGator accounts
bun run phase3:delegate # sign the two delegations (design → narrowed to UX)
bun run phase3:run      # optional: the six acceptance flows, end to end
```

Both the app and the CLI runner go through `src/lib`, so what the demo shows on screen
is the code the acceptance runner proved on chain.

## Contracts quickstart

```bash
cd contracts
forge build
forge test --no-match-path "test/fork/**"   # unit suite (offline, MockMultiVault)
forge test --match-path "test/fork/*"       # fork suite (live Intuition testnet RPC)
```

46 tests, all green: 25 unit (offline, against a `MockMultiVault` that reproduces two
probed live behaviours), 9 fork tests driving the real MultiVault and DelegationManager,
9 gas benchmarks, 3 governor. **100 %** line, statement, branch and function coverage on
the enforcer.

Network: Intuition testnet, chain id **13579** — every address is in
[`manifest/13579.json`](manifest/13579.json), the single source of truth for scripts,
tests and frontend alike. MetaMask Delegation Framework **v1.3.0** is deployed there at
its canonical CREATE2 addresses (verified — see [ADR 0002](docs/adr/0002-delegation-framework-v130-on-13579.md)).
