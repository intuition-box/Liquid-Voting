# Security review — GraphDomainScope (+ DemoGovernor, IMultiVault, Deploy.s.sol)

**Reviewed:** 2026-08-17
**Commit:** 98adc1aa8e886d9db208ca156a9646855cdf804d
**Reviewer:** contract-reviewer agent

Scope: `src/GraphDomainScope.sol` (the deliverable), `src/DemoGovernor.sol`,
`src/interfaces/IMultiVault.sol`, `script/Deploy.s.sol`. Reviewed against
`.claude/rules/solidity.md` + `security.md`, ADRs 0003–0007 and 0009, with the
Trail of Bits skill chain (Slither run included) and the ethskills security checklist.

## Threat model

- **Reentrancy** — clean. `beforeHook` is `view`; every MultiVault read compiles to
  STATICCALL and the enforcer holds zero storage — there is no state to reenter and no
  callback surface. `DemoGovernor.propose` makes no external calls and emits after its
  single write (CEI trivially satisfied).
- **Access control** — clean. The enforcer has no state-changing function. Hooks are
  callable by anyone, but they are pure predicates (revert or return void), grant
  nothing, emit nothing, and key no state — an arbitrary caller learns only what the
  public graph already says. The only call that carries authority is the
  DelegationManager's during redemption, and it supplies the framework-verified
  `_delegator` used as the default attestor; that binding cannot be forged by the
  redeemer. `DemoGovernor.propose` is deliberately permissionless (bounty-sanctioned
  mock recorder; binds `msg.sender` as proposer — the root DeleGator under redemption).
  `Deploy.s.sol` refuses any chain but 13579 and fails loudly on a missing key.
- **Integer arithmetic** — clean. Solidity 0.8.23 checked math, no `unchecked` blocks
  anywhere; `length_ - 1` in `_validatePath` is guarded by the preceding `EmptyPath`
  check; no division exists.
- **Input validation** — clean. Constructor rejects zero `_multiVault`/`_governor`
  (dedicated test); malformed `_terms` or `_args` fail the ABI decoder and revert
  (fail-closed; generic ABI revert is acceptable — a delegator who signs undecodable
  terms has signed a dead delegation, and a redeemer supplying undecodable args gets
  nothing). Path shape (non-empty, `hops ≤ maxDepth`, both endpoints) is fully
  validated before any vault read. `abi.decode` also validates value-type padding, so
  dirty-bit `Terms` fields revert rather than truncate.
- **Front-running / MEV** — clean, with on-chain evidence. The witness is public graph
  data; observing a pending redemption reveals nothing exploitable, and redemption is
  permissioned to the leaf delegate by the manager. The graph changing between signing
  and redemption is the designed dynamic-scope property, bounded by attestor stake
  (ADR 0004). The one bypass that would break ADR 0004 — a third party *gifting* the
  attestor a position on a forged edge via `deposit(receiver=attestor, …)` — was probed
  against the live MultiVault (13579, 2026-08-17): self-deposit simulates successfully;
  third-party deposit without approval reverts (error `0xd76f6ff8`). Attestor positions
  can only be created by the attestor or an address they explicitly approved. Recorded
  as verified upstream assumption A1 below.
- **Signature replay** — clean. The enforcer introduces no signatures. `_terms` ride
  inside the EIP-712-signed delegation (chainId + DelegationManager domain + salt);
  `_args` is excluded from the caveat hash by framework design and is never trusted —
  only verified. A delegation remains redeemable repeatedly until revoked/expired;
  that is intended here (propose is repeatable), and `LimitedCallsEnforcer` (deployed
  on 13579) can compose a cap without code changes (ADR 0009 note).
- **Oracles / external data** — n/a by design. No price oracles; the MultiVault itself
  is the live authority being consulted, and the default curve id is read from
  `getBondingCurveConfig()` per invocation, never cached or hardcoded.
- **DoS via unbounded loops** — clean. The single loop in `_verifyHops` runs
  `path.length - 1 ≤ maxDepth` times, checked in `_validatePath` before the loop, and
  `maxDepth` is a `uint8` inside the delegator-signed terms. Cost is linear and paid by
  the redeemer (measured: ~9.9k gas/hop mock, ~13.9k live — see Gas).
- **Upgradeability** — clean. No proxies, no `delegatecall`, no upgradeable variants in
  this repo's contracts; `CALLTYPE_DELEGATECALL` modes are rejected by the single-mode
  check. Noted: `MULTI_VAULT` is itself an upstream proxy under Intuition governance —
  an accepted, documented trust (the graph authority can change its own semantics).
- **Events** — clean. The enforcer performs no state mutation (grep-verified: no
  storage, no writes), so it has nothing to emit; redemption-level events come from the
  DelegationManager. `DemoGovernor`'s only write path emits `ProposalCreated` with
  indexed id/domain/proposer (event-emission test present).

## Adversarial walk of the review's focus items

- **`_args` is untrusted** — confirmed nothing from it is believed. Each element is
  either (a) compared against a binding (`path[0]` vs the execution's domain word,
  `path[end]` vs signed `rootDomainId`), or (b) fed into `calculateTripleId` whose
  *computed* id must classify as a positive triple and carry the attestor's stake. The
  redeemer cannot supply a triple id directly, so the counter-triple id cannot be
  smuggled in; a forged intermediate node dies at `NotATriple` or `NotAttested`. Path
  direction is fixed by argument order (`subject=child, object=parent`) and the
  predicate comes from signed terms, so the relation cannot be reversed or substituted.
  Cycles in the witness only add hops that must each be staked edges — they cannot
  fabricate membership.
- **Execution smuggling** — no route found. `_validateMode` requires
  `CALLTYPE_SINGLE + EXECTYPE_DEFAULT` (batch, try, static, and delegatecall call types
  all revert; both rejection tests present). The enforcer and the executing DeleGator
  decode `_executionCalldata` with the same `ExecutionLib` layout, so the
  target/calldata checked is byte-identical to the target/calldata executed — no
  decode-divergence TOCTOU. Truncated calldata fails closed at every layer:
  `< 52` bytes reverts inside `decodeSingle`'s slicing; `< 4` bytes of callData
  zero-pads the selector and misses `ALLOWED_SELECTOR`; a partial first-argument word
  (length 5–35) zero-pads identically to what the EVM's CALLDATALOAD would give the
  governor, and the governor's own ABI decoder then rejects the short calldata anyway.
  The domain word the enforcer checks (bytes 4..36) is exactly the word the governor
  decodes as `domainId` — same bytes, same alignment.
- **`try/catch` around `getVaultType`** — cannot admit a bad hop. The only success
  path requires the staticcall to return and ABI-decode `uint8 == 1`; the catch arm
  unconditionally reverts `NotATriple`, so it converts failure into failure, never into
  acceptance. Two edge behaviors both fail closed: a codeless `MULTI_VAULT` would make
  the high-level call "succeed" with empty returndata, whose decode failure is *not*
  caught by the catch clause (Solidity semantics) and hard-reverts; a dirty-bit return
  value fails decoder validation the same way. The live vault's revert-for-never-created
  behavior is pinned by the mock and re-verified by the fork suite.
- **Counter-triple trap** — closed. `getVaultType == 1` is the only classifier used;
  `isTriple` appears nowhere in the enforcer (grep-verified). The trap itself is proven
  real on the live vault (`test_Fork_CounterTripleTrapIsReal`: `isTriple` accepts the
  counter-triple of a valid relation, `getVaultType` returns 2) and the enforcer's
  rejection is regression-tested against a mock reproducing it
  (`test_RevertWhen_HopIsCounterTriple_IsTripleTrap`).
- **Statelessness under arbitrary callers** — safe. Hooks being publicly callable is
  harmless precisely because the enforcer keys no state by caller (unlike stateful
  standard enforcers that must namespace by `msg.sender`): there is nothing to poison,
  pre-warm, or race. Out-of-redemption calls produce an answer with no authority
  attached. The inherited `beforeAllHook`/`afterHook`/`afterAllHook` no-ops from the
  framework's `CaveatEnforcer` base are equally inert.
- **Loop bound** — `hops ≤ maxDepth` with `maxDepth: uint8` in signed terms;
  boundary behavior tested (`maxDepth 0` still admits the zero-hop exact match, which
  bypasses all vault reads only when proposal domain == signed root — both endpoint
  checks force the equality).

## Static analysis (Slither 0.11.x via pipx, 102 detectors, `--filter-paths lib/|test/|script/`)

17 results, all triaged, none actionable:
- `unused-return` (3) — partial tuple destructuring of `decode()`/`decodeSingle()`/
  `getBondingCurveConfig()`; intentional (the discarded `value` word is finding I-1).
- `calls-loop` (3) — the hop-verification loop; view-only staticcalls, bounded by
  signed `maxDepth`, no state, no value: the pattern the design is built on.
- `timestamp` (1) — the expiry comparison; inherent to expiry (same exposure as the
  framework's own TimestampEnforcer), rationale recorded in `foundry.toml` lint config.
- `solc-version` (2) — the `>=0.8.23 <0.9.0` range on DemoGovernor/IMultiVault; see I-2.
- `naming-convention` (9) — underscore-prefixed params and capitalized immutables;
  deliberate house/framework style.

`forge build --force`: zero warnings.

## Test coverage

46/46 green: 34 local (25 enforcer unit incl. 3 fuzz, 3 DemoGovernor, 6 gas bench) +
12 fork against live 13579 (9 end-to-end chain redemptions through the real
DelegationManager with signed HybridDeleGator delegations, 3 gas). Every custom error
has a dedicated `vm.expectRevert(Error.selector)` test; fuzz covers terms round-trip,
valid path suffixes, and an error-agnostic forged-witness property. Invariant tests:
n/a with reasoning — the enforcer is stateless, so no property spans call sequences.

`forge coverage --no-match-path "test/fork/**" --report summary`:

| File | Lines | Statements | Branches | Funcs |
|---|---|---|---|---|
| src/GraphDomainScope.sol | **100%** (44/44) | **100%** (63/63) | **100%** (14/14) | **100%** (7/7) |
| src/DemoGovernor.sol | 100% (9/9) | 100% (7/7) | 100% (1/1) | 100% (3/3) |
| script/Deploy.s.sol | 0% | 0% | 0% | 0% |

Deploy.s.sol is exercised by the actual deployment run (Phase 2), not unit tests;
scripts are outside the contract-surface 100% requirement.

## Gas

Full depth curve in `docs/phase1/gas-report.md` (measured 2026-08-17, cold-storage
worst case): `beforeHook` depth 0 = 17,535 (no vault call); depth 1 = 35,211 mock /
44,209 live; depth 2 = 45,150 / 58,115; marginal hop ≈ 9.9k mock / ≈ 13.9k live (the
delta is the live vault's proxy hop). `forge test --gas-report`: `beforeHook` median
31,455 over 544 calls; enforcer deployment 599,417 gas / 2,589 bytes runtime.
No hard target set for this task; numbers recorded.

## Findings

No Critical, High, or Medium findings. Nothing below requires a contract code change.

- **I-1 · Informational · `src/GraphDomainScope.sol:175`** — the execution's
  native-value word is decoded and discarded, so the caveat itself does not forbid
  attaching value. Currently unexploitable: the only admissible target+selector is
  `DemoGovernor.propose`, which is non-payable, so any value-bearing execution reverts
  at the call (and try-mode, which could swallow that revert, is rejected by the mode
  check). Recommendation for Mission 11: bind `value == 0` explicitly or compose the
  audited `ValueLteEnforcer`, so the no-value guarantee stops depending on the bound
  target's payability.
- **I-2 · Low (docs only) · `src/DemoGovernor.sol:2`, `src/interfaces/IMultiVault.sol:2`,
  `script/Deploy.s.sol:2`** — pragma `>=0.8.23 <0.9.0` deviates from the rule's
  `^0.8.24` and from ADR 0006's letter ("contracts that do not import framework code
  follow the standard `^0.8.24` rule"). The deviation is forced: `Deploy.s.sol` and the
  test suites import these files together with the 0.8.23-pinned enforcer into single
  compilation units, so their pragmas must admit 0.8.23 — `^0.8.24` would be
  uncompilable. Fix is a one-paragraph amendment to ADR 0006 / `solidity.md` recording
  this consequence; no code change.
- **I-3 · Informational · `src/GraphDomainScope.sol:85`** — the constructor
  accepts `_allowedSelector == bytes4(0)`, which would match empty calldata to the
  governor. Unreachable via the repo's deploy path (binds `DemoGovernor.propose.selector`)
  and the immutable is readable before anyone signs; optional hardening only.
- **I-4 · Informational (upstream assumptions, for the writeup)** — two verified
  dependencies on live-vault behavior worth stating in docs/WRITEUP.md: (A1) attestor
  positions cannot be gifted — `deposit` with `receiver != msg.sender` requires the
  receiver's prior approval (probed on 13579, revert `0xd76f6ff8`); if Intuition ever
  relaxed deposit-approval semantics, ADR 0004's "whose stake matters" argument would
  need re-review. (A2) attestation is read on the *current* default curve id — if
  governance changes it, positions on the old curve stop counting and affected
  delegations fail closed until the attestor re-stakes; deliberate (query-never-
  hardcode) but operationally surprising.

## Verdict

**PASS**
