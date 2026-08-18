# 0010 — Self-bundled user operations (no bundler exists on 13579)

**Status:** Accepted
**Date:** 2026-08-18
**Triggered by:** Phase 3 kickoff — the bounty's deliverable 3 mandates *three*
`HybridDeleGator` accounts, and two acceptance flows require the smart account itself
to be `msg.sender`.

## Context

`DeleGatorCore.execute` is `onlyEntryPoint`: a HybridDeleGator can only act through an
ERC-4337 user operation. Two Phase 3 flows hard-require the smart account as caller:

1. **Redemption** — `redeemDelegations` requires `msg.sender == leaf.delegate`
   (the executor smart account).
2. **Revocation** — `DelegationManager.disableDelegation` requires
   `msg.sender == delegation.delegator` (the voter smart account). This one is
   unavoidable regardless of how the executor is modeled.

Intuition testnet (13579) has **no public bundler** (none documented, none in the
network config). `metamask-delegation.md` forbids relayers/paymasters.

## Decision

**Self-bundle:** our own funded EOA submits
`EntryPoint.handleOps([packedUserOp], beneficiary)` as a plain transaction. The user
operation is signed by the smart account's owner; each smart account pre-pays its own
gas in tTRUST from its balance; the submitting EOA is refunded as beneficiary. No
relayer, no paymaster, no external service — the same pattern the Delegation
Framework's own test suite uses.

All three accounts (voter, delegate, executor) are `HybridDeleGator`s per the bounty
letter. Runner scripts preflight every redemption with `eth_call`
(`from = smart account`) so the specific enforcer revert reason is surfaced before  —
and independently of — the user operation (the frontend uses the same preflight).

Clarification of `metamask-delegation.md`'s "direct transaction to the
DelegationManager": the *intent* (no third-party gas abstraction) is preserved; the
letter is amended — for smart-account senders the direct transaction goes to the
canonical EntryPoint, which is part of the deployed framework, not a service.

## Alternatives considered

- **Executor (and delegate) as bare EOAs** (the Hourglass pattern; the framework
  supports EOA delegators via ecrecover) — rejected: deviates from the bounty's
  explicit "three HybridDeleGator accounts", and the user-op machinery is required for
  revocation anyway, so the simplification saves almost nothing.
- **Run a local bundler (e.g. alto/rundler) against 13579** — rejected: an external
  service dependency for the live demo with zero benefit over `handleOps` direct.
- **ERC-7702 upgraded EOAs (Stateless7702)** — rejected: out of scope per the rules,
  different trust story, and 7702 support on the chain is unverified.

## Consequences

**Positive:**
- Bounty letter satisfied: three smart accounts, canonical infra only.
- Presentation answer ready: "no bundler on your chain — the EntryPoint is enough."
- Gas stays self-funded per account (explicit funding step, per the rules).

**Negative:**
- We hand-pack PackedUserOperation v0.7 (gas limits set generously rather than
  estimated — there is no bundler to estimate); a malformed pack fails loudly at
  `handleOps`, not silently.
- Inner-call failures do not revert the `handleOps` transaction: success/revert must
  be read from `UserOperationEvent` / `UserOperationRevertReason` logs — the runner
  and frontend must decode these (also why the eth_call preflight exists).

**Neutral (worth knowing):**
- The SDK's deployments map does not know 13579; the environment is injected via
  `overrideDeployedEnvironment(13579, "1.3.0", env-of-chain-1)` — byte-identical
  addresses, all verified on 13579 in Phase 0.a (ADR 0002).

## References

- Related ADR: `0002-delegation-framework-v130-on-13579.md`
- Related rule: `.claude/rules/metamask-delegation.md` (amended intent above)
- Framework: `DeleGatorCore.sol` modifiers; EntryPoint v0.7 `handleOps`
