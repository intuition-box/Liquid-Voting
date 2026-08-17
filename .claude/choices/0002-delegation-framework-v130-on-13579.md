# 0002 — Pin Delegation Framework v1.3.0 at canonical CREATE2 addresses on chain 13579

**Status:** Accepted
**Date:** 2026-08-17
**Triggered by:** Phase 0.a — the bounty asserts "the Smart Account Kit is now deployed
on the Intuition chain"; house rules require verifying, not assuming.

## Context

The whole mission depends on the MetaMask Delegation Framework existing on Intuition
testnet (13579). If it were absent, deploying it ourselves would roughly double the
mission — a conversation with the Intuition team, not a decision ours to make.
`@metamask/delegation-deployments@0.15.0` (the canonical deployments map) does **not**
list chain 13579, so presence had to be established directly. The framework deploys via
the deterministic CREATE2 factory, so its addresses are chain-invariant per version.

## Decision

Pin **Delegation Framework v1.3.0** at the canonical addresses. Verified on 13579 on
2026-08-17 by three independent means:

1. `eth_getCode` (all non-empty):
   - `DelegationManager` `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` — 11503 bytes
   - `HybridDeleGatorImpl` `0x48dBe696A4D990079e039489bA2053B36E8FFEC4` — 20203 bytes
   - `SimpleFactory` `0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c` — 751 bytes
   - `EntryPoint` v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032` — 16035 bytes
   - CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C` — 69 bytes
2. `eth_call` identity checks: `NAME()` returns `"DelegationManager"` /
   `"HybridDeleGator"`, `DOMAIN_VERSION()` returns `"1"`.
3. Blockscout explorer API returns **verified source** for the DelegationManager
   (`src/DelegationManager.sol`, `pragma solidity 0.8.23`).

The v1.0.0 and v1.1.0 DelegationManager addresses have **no code** on 13579 — v1.3.0 is
the only deployed version, so all SDK calls and Solidity imports pin v1.3.0.

Addresses were read from `@metamask/delegation-deployments` (v1.3.0 map), not from
memory. Note: the deployments map has no contract named `DeleGatorModuleFactory` (the
bootstrap's provisional name); the factory is **`SimpleFactory`**.

## Alternatives considered

- none — the decision was forced by what is actually deployed. Had the framework been
  absent, the stop-and-ask trigger would have fired.

## Consequences

**Positive:**
- Phase 0's blocking risk is retired; Phases 1–4 build on verified ground.
- v1.3.0's enforcer interface (`ICaveatEnforcer`) and helpers (`ExecutionLib`,
  `ModeLib`) can be imported at the exact deployed version.

**Negative:**
- `@metamask/delegation-deployments` doesn't know 13579, so the TS side must carry the
  addresses explicitly (single source: `CLAUDE.md` pinning + the Phase 2/3 manifest).

**Neutral (worth knowing):**
- The MultiVault at `0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91` has code (1487 bytes —
  a proxy) and answers the read surface; session constants on 2026-08-17: curveId 1,
  atomCost 1000000001000000 wei, tripleCost 1000000002000000 wei.

## References

- Related rule: `.claude/rules/metamask-delegation.md`
- Pinning: `CLAUDE.md` § Network pinning
