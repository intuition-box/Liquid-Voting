# Solidity rules

Load with every task that touches `contracts/`. Compose with the global `ethskills` skill for general patterns and Trail of Bits skills for security.

## Version + toolchain

- Pragma: `^0.8.24` exactly. Newer compiler versions need an ADR before bumping.
  **Exception (ADR 0006):** the `GraphDomainCaveatEnforcer` and anything importing the
  Delegation Framework's `ICaveatEnforcer` / `Types.sol` are pinned `0.8.23` — the
  framework pins that version and `^0.8.24` cannot satisfy it.
- Foundry only. No Hardhat, no Truffle.
- `foundry.toml` must enable: `optimizer = true`, `optimizer_runs = 200` (default), `via_ir = false` (unless gas requires it — record the decision as an ADR).

## Contract shape

- One contract per file when the contract is substantive. Libraries can share a file with their consumer if tightly coupled.
- File name matches the primary contract name.
- Layout inside a contract, top to bottom:
  1. License + pragma
  2. Imports
  3. Custom errors
  4. Events
  5. State (constants → immutables → storage)
  6. Modifiers
  7. Constructor / initializer
  8. External functions
  9. Public functions
  10. Internal functions
  11. Private functions

Follow this order. Deviating without reason is noise.

## NatSpec is mandatory on public surface

Every external/public function and every event has NatSpec. Minimum tags:

- `@notice` — what it does, from the caller's perspective.
- `@param` — for each parameter, what it means (not just its type).
- `@return` — for each return value.
- `@dev` — only when there is an implementation detail a reader needs to know.

A function with a self-evident name and no surprises still gets `@notice`. NatSpec is the ABI doc.

## Custom errors, not require strings

```solidity
// Good
error EmptyName();
if (bytes(name).length == 0) revert EmptyName();

// Bad
require(bytes(name).length != 0, "EmptyName");
```

Custom errors are cheaper, parameterizable, and self-documenting. Use them exclusively.

## Events on every state change

Every mutation of storage emits an event. No silent writes. Index the fields off-chain consumers will filter on (creator, id, domain hash for strings). Strings are auto-hashed when indexed — document this in NatSpec.

## Storage

- Use `private` storage by default. Expose via explicit getters with NatSpec.
- Pack tightly. Comment the slot when packing matters.
- Constants are `constant`. Things set in the constructor are `immutable`. Things mutable post-deploy are storage variables — and require a strong reason to be mutable.

## External calls

- The contracts in this repo are `GraphDomainCaveatEnforcer` (view-only calls into the
  Intuition `MultiVault`: `calculateTripleId`, `getVaultType`, `getShares`), a
  `MockGovernor` (records proposals, no value), and a `MockMultiVault` for unit tests.
  The enforcer holds no state and transfers no value; its MultiVault reads are its only
  external surface. Follow checks-effects-interactions strictly in anything new.
- Any external call to a non-trusted address must be reviewed via the Trail of Bits skill chain (`secure-workflow-guide` → `guidelines-advisor`).
- Reentrancy guards (`nonReentrant`) only when there is an actual external call. Adding them defensively to functions with no external call is noise.

## Gas

- Loops over user-provided arrays are forbidden unless bounded by a constant.
- View functions returning dynamic arrays must document the unbounded-growth risk in NatSpec.
- Measure with `forge test --gas-report` when a contract is non-trivial, and record key numbers in `contracts/SECURITY_REVIEW.md`.

## Testing

- `forge test` must pass with zero warnings.
- `forge coverage --report lcov` must show 100% on the contract's public surface.
- Every revert path has a dedicated test using `vm.expectRevert(CustomError.selector)`.
- Fuzz any function accepting strings, addresses, or numbers unbounded by the type system.
- Invariant tests for any property that must hold across all sequences of calls.

## Upgradeability

Contracts in this repo are **not** upgradeable. Do not use OpenZeppelin's `Upgradeable` variants. Do not deploy behind a proxy.

## Security review

Every contract change must pass the `contract-reviewer` agent before the task is considered complete. See `.claude/agents/contract-reviewer.md`.
