# ERC-7710 Liquid Democracy POC — Intuition Graph Domain Caveats

Intuition Box DAO bounty (P0, Mission 10). This POC de-risks Mission 11 (production
implementation) — the writeup matters as much as the code.

**Mission:** a 3-level ERC-7710 delegation chain (`voter → delegate → executor`) where
voting authority is scoped by *domain*, and the scope check is resolved by traversing the
Intuition knowledge graph — so that adding `branding — is a sub-domain of — design` to the
graph extends every `design`-scoped delegation, with no contract redeploy.

## The five deliverables

1. **`GraphDomainCaveatEnforcer`** — a custom ERC-7710 caveat enforcer that verifies a
   redeemer-supplied domain path against live MultiVault state (deployed + verified on
   Intuition testnet, full unit-test suite).
2. **Seeded domain graph** on Intuition testnet (`design`, `branding`, `UX`, `legal`,
   `logo`; predicate `is a sub-domain of`; attestor stake on every edge) with a JSON
   manifest of every term_id.
3. **3-level delegation chain** — three `HybridDeleGator` accounts, `voter → delegate`
   rooted at `design`, `delegate → executor` narrowed to `UX`, redeemed directly against
   the `DelegationManager` with the path witness in `_args`.
4. **Frontend** — Vite + React + viem, four panels (graph, chain, propose with client-side
   path computation, revoke), runnable with one command.
5. **`WRITEUP.md`** — design decisions, traversal + gas, known limitations, Mission 11
   notes, answers to the bounty's three Open Questions.

Anything not on this list is a scope expansion: stop and ask. No real Governor (mock is
fine), no relayer/paymaster, nothing upgradeable.

## Acceptance criteria (verbatim from the bounty)

- [ ] Enforcer deployed on Intuition testnet, all unit tests pass
- [ ] A `branding` proposal **passes** when the delegation root is `design`
- [ ] A `legal` proposal **fails** under the same `design` delegation
- [ ] Revoking the root invalidates **both** downstream accounts
- [ ] `maxDepth` is respected — a domain beyond the cap is rejected
- [ ] Frontend runs locally (or is deployed)
- [ ] Writeup is clear enough for another developer to start Mission 11

## Network pinning (Intuition testnet)

```
NETWORK   = "Intuition Testnet"
CHAIN_ID  = 13579
RPC       = https://testnet.rpc.intuition.systems/http
MULTIVAULT= 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91
GRAPHQL   = https://testnet.intuition.sh/v1/graphql
EXPLORER  = https://testnet.explorer.intuition.systems
NATIVE    = tTRUST (18 decimals), faucet + bridge: https://app.intuition.systems/bridge
```

`curveId`, `getAtomCost`, `getTripleCost` are governance-configurable — query
`getBondingCurveConfig()` / cost getters at session start, never hardcode (see
`.agents/skills/intuition/reference/reading-state.md`). Last verified 2026-08-17:
curveId 1, atomCost 1000000001000000 wei, tripleCost 1000000002000000 wei.

Delegation Framework **v1.3.0** is deployed on 13579 at the canonical CREATE2 addresses
(verified 2026-08-17 via `eth_getCode` + explorer API — see ADR 0002):

```
DelegationManager   = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
HybridDeleGatorImpl = 0x48dBe696A4D990079e039489bA2053B36E8FFEC4
SimpleFactory       = 0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c
EntryPoint v0.7     = 0x0000000071727De22E5E9d8BAf0edAc6f37da032
CREATE2 factory     = 0x4e59b44847b379578588920cA78FbF26c0B4956C
```

## Stack

Foundry (contracts) · Vite + React + viem (frontend) · bun. The toolchain is off-PATH:
prefix every shell invocation with
`PATH="/home/max/.nvm/versions/node/v22.21.1/bin:/home/max/.bun/bin:$PATH"`
(Foundry is at `~/.foundry/bin`, already on PATH).

## Routing table

| File | Load when |
|---|---|
| `.claude/rules/00-INDEX.md` | First — the rules index and update protocol |
| `.claude/rules/workflow.md` | Every task — scope discipline, git hygiene, verification protocol |
| `.claude/rules/code.md` | Any TypeScript/frontend code |
| `.claude/rules/solidity.md` | Any task touching `contracts/` |
| `.claude/rules/metamask-delegation.md` | Any ERC-7710 / Smart Accounts Kit / enforcer work |
| `.claude/rules/security.md` | Any contract change or value-handling code |
| `.claude/rules/ui.md` | Frontend work |
| `.agents/skills/intuition/` | **Source of truth for every Intuition read and write.** Never re-derive what it documents. |
| `.claude/skills/mms-smart-accounts-kit/` | Smart Accounts Kit SDK usage |
| `.claude/skills/mms-gator-cli/` | gator-cli for shell testing of delegations |
| `.claude/choices/` | ADRs — every architectural decision is recorded here |

## House rules that have caught real failures

- **Verify, don't assume.** After any deployment or verification step, re-read the result
  from an independent source (poll the explorer API) rather than trusting the tool's exit
  message.
- **Never invent an address, a term_id, or a function signature.** Verify onchain or via
  GraphQL, and record it.
- **Resolve graph terms by `term_id`, never by label** — duplicate labels exist on
  testnet (methodology: Hourglass ADR 0003, mirrored in ADR 0008 here).
- Every architectural decision gets an ADR in `.claude/choices/` (template there).
- English everywhere: code, NatSpec, ADRs, commits, writeup.

## Escalation triggers (stop and ask, never work around)

- An acceptance criterion cannot be satisfied without changing the decided architecture
  (ADRs 0002–0007).
- The Smart Accounts Kit SDK behaves differently from its docs.
- A security-property test passes for the wrong reason.
- Predicate seeding decision, canonical read interface, calldata-vs-registry (bounty Open
  Questions) — form an opinion, then confirm with the team.
- Payment / validation / timeline: Wieedze ↔ zet.box on Discord, not ours.
