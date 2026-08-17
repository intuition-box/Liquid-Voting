# MetaMask delegation rules

Load for any work touching the MetaMask Smart Accounts Kit, ERC-7710 delegation, the
`DelegationManager`, or the `GraphDomainCaveatEnforcer`. That covers `contracts/`,
`scripts/`, and the frontend's delegation code.

> Adapted from the Hourglass rule file — the Hourglass version forbade custom caveat
> enforcers; in this repo the custom enforcer **is the core deliverable**. Change
> recorded in ADR 0001.

**Out of scope: third-party relayers / gas abstraction.** Every redemption in this repo
is a direct transaction to the `DelegationManager`, paid in native tTRUST gas by the
redeeming party. If a task proposes routing a redemption through a relayer, a paymaster,
or any gas-abstraction service, that is a scope expansion: stop and ask.

**Out of scope: ERC-7715 advanced permissions and the Safe-module pattern.** Hourglass
wrapped delegation in a Safe module; here the accounts are plain `HybridDeleGator` smart
accounts redeeming directly. Do not carry either pattern over.

This rule supplements `code.md` for the TypeScript side and `solidity.md` for the
contract side.

## What this project actually does

A 3-level delegation chain (`voter → delegate → executor`) where each delegation carries
a **custom caveat**: the `GraphDomainCaveatEnforcer`, which scopes the delegation to a
governance *domain* and resolves domain membership by verifying a redeemer-supplied path
witness against the Intuition MultiVault (see ADRs 0003–0007 for the decided
architecture — do not relitigate them, but flag loudly if implementation proves one
wrong).

Writing this one enforcer is in scope. Writing any *additional* enforcer is a scope
expansion: stop and ask.

## Framework facts (verified on chain 13579, 2026-08-17 — ADR 0002)

- Delegation Framework **v1.3.0**, canonical CREATE2 addresses (pinned in `CLAUDE.md`).
  Framework contracts are `pragma solidity 0.8.23` — see ADR 0006.
- `ICaveatEnforcer` hooks all share one signature:
  `(bytes _terms, bytes _args, ModeCode _mode, bytes _executionCalldata, bytes32 _delegationHash, address _delegator, address _redeemer)`.
- **`_terms` is signed** by the delegator and bound into the delegation hash — immutable.
  **`_args` is supplied by the redeemer at redemption time — untrusted.** Anything
  security-relevant must be either in `_terms` or verified on-chain; `_args` may only
  carry witnesses whose validity the enforcer checks itself.
- Delegation arrays passed to `redeemDelegations` are ordered **leaf → root**; the last
  element carries root authority.
- Every enforcer in the whole chain must pass. Restrictions compound (this is what makes
  narrowing emergent — ADR 0007).
- Useful framework helpers: `ExecutionLib.decodeSingle(bytes)` →
  `(address target, uint256 value, bytes callData)`, and `ModeLib` for `ModeCode`.

## Revocation is native — write no code for it

The delegator calls `disableDelegation(delegation)`; the `DelegationManager` checks it
on every `redeemDelegations`, and the whole downstream chain dies with
`CannotUseADisabledDelegation`. Demonstrate it (test + frontend button), never
re-implement it.

## Authoritative sources

Vendored skill references (read these first):

- **`mms-smart-accounts-kit`** — `.claude/skills/mms-smart-accounts-kit/SKILL.md` +
  `references/`. Account creation, signer types, delegations, the Delegation Framework.
- **`mms-gator-cli`** — `.claude/skills/mms-gator-cli/SKILL.md`. Shell testing of
  delegation operations before wiring the UI.

Upstream sources of truth (the vendored skills are snapshots — defer here when SDK
behavior is unclear):

- MetaMask Smart Accounts Kit docs — https://docs.metamask.io/smart-accounts-kit/
- `MetaMask/delegation-framework` (pinned v1.3.0) for Solidity interfaces.

If a vendored skill conflicts with upstream, upstream wins. If SDK behavior conflicts
with this rule file or its docs, **escalate to the user — do not silently work around
it** (bounty stop-and-ask trigger).

## Account creation

Three `HybridDeleGator` accounts (voter, delegate, executor) deployed via the Smart
Accounts Kit factory functions from `@metamask/smart-accounts-kit`. Do not roll a custom
factory. Each smart account is deterministically derived from its controlling EOA +
salt; the EOA is the signer.

## Delegation signing

A delegation is an EIP-712-signed message granting a delegate permission to execute on
behalf of the delegator, bounded by caveats.

- `voter → delegate` carries the `GraphDomainCaveatEnforcer` with root `design`.
- `delegate → executor` carries the same enforcer with root `UX` (narrowing — ADR 0007).

**Hard rules:**

- Caveat `terms` are computed once and **never modified after signing**.
- The delegate is set at signing time and cannot be reassigned without a new signature.
- Never reuse a delegation signature across chains or across distinct terms.

## Execution under delegation

- The executor redeems **directly** against the `DelegationManager`
  (`redeemDelegations`) with the signed delegation chain (leaf → root) and the domain
  path witness in `_args`. Reuse the Hourglass TS flow
  (`src/lib/delegations.ts`, `redeemDirect.ts`, `revoke.ts` in the Hourglass repo) —
  build → EIP-712-sign → redeem → disable.
- The redeeming party must hold native tTRUST gas; funding that wallet is an explicit,
  separate step.
- Where a flow has both a happy path and a revert path, demonstrate both — with the
  specific revert reason surfaced.

## Storage

- Signed delegations and account addresses → local JSON / `localStorage`. Never in code.
- The seeded graph's term_ids → the Phase 2 JSON manifest, the single source of truth
  for tests and frontend alike.

## Testing

- Unit tests: enforcer hooks driven directly against a `MockMultiVault` — every revert
  path, fuzz on the path array.
- Fork tests against the 13579 RPC: real MultiVault semantics (counter-triples, share
  accounting) and the full chain — sign → redeem → revoke — end-to-end.
- The acceptance criteria must pass on the live testnet, not only in tests.

## Review

- Any Solidity change → `contract-reviewer` agent.
- Web / SDK usage → `ui-reviewer` agent, plus a manual check of SDK usage against the
  official docs.
