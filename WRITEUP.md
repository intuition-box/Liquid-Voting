# ERC-7710 Liquid Democracy with Intuition Graph Domain Caveats

**Mission 10 POC — Intuition Box DAO.** A three-level ERC-7710 delegation chain
(`voter → delegate → executor`) where voting authority is scoped by *domain*, and the
scope check is resolved by traversing the Intuition knowledge graph. Adding
`branding — is a sub-domain of — design` to the graph extends every `design`-scoped
delegation already signed, with no contract redeploy and no new signature.

Everything below is deployed and verified on **Intuition testnet (chain 13579)**.

| | |
|---|---|
| `GraphDomainCaveatEnforcer` | [`0x97874e29cE2b98afF21d1dCad03348ac8A16739b`](https://testnet.explorer.intuition.systems/address/0x97874e29cE2b98afF21d1dCad03348ac8A16739b) — source-verified |
| `MockGovernor` | [`0xE9F0B082Ac97518b41E6aA5f0aEb75BD26d8484E`](https://testnet.explorer.intuition.systems/address/0xE9F0B082Ac97518b41E6aA5f0aEb75BD26d8484E) — source-verified |
| Voter / delegate / executor | `0x99FD1744…97De` · `0x7DbF9154…9Ffb` · `0xa3a3Aa99…7601` (HybridDeleGator v1.3.0) |
| Delegation Framework | v1.3.0 at canonical CREATE2 addresses — all 31 standard enforcers present |
| Tests | 46 passing (25 unit, 9 fork against live MultiVault, 9 gas, 3 governor); **100 %** line/statement/branch/function coverage on the enforcer |

---

## 1. The problem, and the shape of the answer

A domain-scoped delegation has to answer one question at redemption time: *is the
proposal's domain underneath the domain this delegation was scoped to?* In a knowledge
graph, that is a reachability question.

The Intuition MultiVault cannot answer it directly. Storage is

```solidity
mapping(bytes32 tripleId => bytes32[3] atomIds)   // keyed by hash(subject, predicate, object)
```

There is **no reverse index**. A contract can ask *"does (X, P, Y) exist?"* — because it
can compute the key — but never *"what are the children of Y?"*. On-chain breadth-first
search from a root is not expensive, it is **impossible**: the enforcer has no way to
enumerate candidate intermediate nodes.

That single storage fact determines the architecture.

### The witness pattern (ADR-A)

The redeemer supplies the path as `_args`, and the enforcer verifies **every hop**
against live chain state:

```solidity
// terms — signed by the delegator, immutable
bytes32 rootDomainId;   // this delegation's scope
bytes32 predicateId;    // the edge type, e.g. "is a sub-domain of"
uint8   maxDepth;       // hop cap
uint64  expiry;         // 0 = none
address attestor;       // address(0) => the delegator

// args — supplied by the redeemer, untrusted
bytes32[] path;         // path[0] = proposal domain, path[n-1] = rootDomainId
```

For each `i`: compute `calculateTripleId(path[i], predicateId, path[i+1])`, require it
classifies as a positive triple, require the attestor holds a position on it.

This is the standard prover/verifier split — the same shape as a Merkle proof. The
redeemer supplies a *witness*, not a *fact*. A forged intermediate node produces a
triple id that was never created, and the hop fails. Discovery is off-chain because it
must be; verification is on-chain because it can be.

**This collapses Open Question 1's either/or into a third option that is both.** The
bounty framed the choice as "on-chain reads **or** an off-chain proof pattern". The
right answer is off-chain *discovery* with on-chain *verification*: you get the gas
profile of a proof system and the trust model of direct reads, because the prover is
never believed — only checked, hop by hop, against the same graph the DAO governs.

### Attestation is position, not existence (ADR-B)

Intuition triples are permissionless. Anyone can mint
`legal — is a sub-domain of — design` for about 1e15 wei. If the enforcer treated
existence as authorization, any griefer could widen any delegation's scope for pocket
change — and the bounty's own acceptance criterion ("a `legal` proposal fails") would
break for an accidental reason.

Two MultiVault facts resolve this:

1. **The creator of a term is not readable on-chain.** `AtomCreated` / `TripleCreated`
   carry the creator as an *event* only — there is no `getCreator`, no storage slot. An
   enforcer cannot filter by authorship.
2. **But creation forces a deposit.** `createTriples(subjects, predicates, objects, assets)`
   takes an `assets` array; the creator always ends up holding shares. So
   `getShares(X, tripleId, curveId) > 0` is the on-chain-readable proxy for *"X created
   or endorsed this edge"*.

So every hop additionally requires:

```solidity
if (MULTI_VAULT.getShares(attestor, tripleId, curveId) == 0) revert NotAttested(tripleId, attestor);
```

Existence is a fact about the world; **stake is a claim by somebody**. Authorization
should follow the claim.

The `attestor` field makes that claim's owner a parameter, and one line of code then
expresses two different governance models:

| `attestor` in terms | Meaning |
|---|---|
| an org address or proxy | *"Only our organisation's ontology counts."* Institutional curation — what most DAOs would actually deploy. |
| `address(0)` → the delegator | *"My delegation is read through my own view of the graph."* Since `_delegator` differs at each level, **every hop is interpreted through its own signer's curation.** |

The second is the deeper fit with liquid democracy: delegating "within design" means
within what *I* recognise as design, not what anyone with 1e15 wei says design is. The
POC ships both and switches between them by changing two lines of signed terms — no
redeploy. There is a dedicated test for the dial in both directions.

We deliberately did **not** add a `minShares` threshold: `> 0` is sufficient for a POC
and avoids tuning a number we cannot justify. Stake-weighted variants are a Mission 11
recommendation (§6), not POC code.

### One more trap worth naming (ADR-C)

Every triple has a counter-triple — the vault for staking *against* the relation. And
`isTriple(counterTripleId)` returns **true**: it answers "is this in the triple family?",
not "is this a positive assertion?". An enforcer using `isTriple` as its existence check
would accept a hop whose on-chain meaning is the *negation* of the claimed edge.

The enforcer uses the precise classifier instead — `getVaultType(id) == 1` — which
rejects atoms (0), counter-triples (2) and never-created terms in a single read. There
is a dedicated unit test, and a fork test that proves the trap is real on the live
deployment rather than hypothetical:

```
isTriple(counterId)     == true      // the trap
getVaultType(counterId) == 2         // COUNTER_TRIPLE — rejected
```

### Narrowing is emergent (ADR-E)

`voter → delegate` is scoped to `design`; `delegate → executor` is narrowed to `UX`. We
wrote **no narrowing code**. The Delegation Framework runs every caveat on every
delegation in the chain and requires all of them to pass, so a proposal must verify a
path to `UX` *and* a path to `design`. The intersection is the narrowing.

Note the semantics are an intersection, not an enforced subset relation: a delegate who
"narrows" to a disjoint domain produces a chain where nothing can pass. That is a dead
delegation, not an escalation — escalation is impossible because level 1's enforcer
still runs. Test 14 and the fork suite prove it end to end.

---

## 2. What runs, end to end

```
voter EOA ──signs EIP-712──▶ delegation 1 (scope: design)   ─┐
delegate EOA ─signs EIP-712─▶ delegation 2 (scope: UX)       │  offline, zero transactions
                                                             ▼
executor SA ──user op──▶ EntryPoint ──▶ DelegationManager ──▶ enforcer × 2 ──▶ MultiVault
                                              │                                    (3 reads/hop)
                                              ▼
                                    voter SA executes propose() ──▶ Governor
```

The proposal is recorded **in the voter's name** — the governor sees the voter's smart
account as `msg.sender`. That is what makes it delegation rather than impersonation.

All six flows are verified live (`bun run phase3:run`):

| Flow | Result |
|---|---|
| `UX` through the full two-level chain | passes — proposal recorded, proposer = voter SA |
| `branding` under the `design` root | passes |
| `legal` under the same delegation | `NotATriple(0x4385e3…)` |
| `branding` through the `UX`-narrowed chain | `NotATriple(0x5b52dc…)` — narrowing |
| 2-hop `logo` under a `maxDepth = 1` variant | `PathTooLong(2, 1)` |
| voter revokes the root | executor **and** delegate revert `CannotUseADisabledDelegation` |

Revocation is framework-native: `disableDelegation` is checked by the DelegationManager
before any hook runs. We wrote zero code for it, and the test is green with a stub
enforcer — which is the proof that no custom code is involved.

### A deployment detail worth knowing: there is no bundler on 13579

`DeleGatorCore.execute` is `onlyEntryPoint`, so a smart account can only act through an
ERC-4337 user operation — and chain 13579 has no public bundler. Rather than add a
relayer (explicitly out of scope) we **self-bundle**: a funded EOA submits
`EntryPoint.handleOps([op], beneficiary)` as a plain transaction. The operation is
signed by the account's owner, each account pre-pays its own gas in tTRUST, and the
submitter is refunded as beneficiary. No relayer, no paymaster — the same pattern the
Delegation Framework's own test suite uses (ADR-0010).

If Intuition wants smart-account UX on this chain at scale, a public bundler is the
missing piece of infrastructure. That is a Mission 11 conversation, not a blocker.

---

## 3. Traversal and gas

Measured 2026-08-17, `optimizer_runs = 200`, cold storage (worst case).

| Depth (hops) | vs. MockMultiVault | vs. live MultiVault |
|---|---|---|
| 0 — exact match | 17,535 | 17,535 (no vault call at all) |
| 1 | 35,211 | 44,209 |
| 2 | 45,150 | 58,115 |
| 3 | 55,088 | ~72,000 (extrapolated) |
| 4 | 65,027 | ~86,000 |
| 5 | 74,964 | ~100,000 |

**Marginal cost per hop: ≈ 13,900 gas on the live vault** (≈ 9,900 against the mock).
Each hop costs three staticcalls — `calculateTripleId` (pure keccak), `getVaultType`
(one cold SLOAD family), `getShares` (one cold SLOAD). The live vault sits behind a
proxy, so every call pays an extra delegatecall hop; that is the mock/live gap. Depth ≥ 1
also pays one `getBondingCurveConfig` read per hook, because the default curve id is
governance-configurable and must never be hardcoded.

For the demo's two-level chain, total caveat overhead is the sum of the levels involved —
about 62k gas for leaf-depth-0 + root-depth-1. On an L3 where gas is effectively free
this is not a constraint; on mainnet it would still be a fraction of a Uniswap swap.

**Why the depth cap exists.** Cost is strictly linear in hops and the loop is bounded by
the signed `maxDepth` (a `uint8`), so there is no unbounded-loop surface. But the cap is
also semantic: every hop is one more edge the attestor must have staked, and a delegation
whose scope needs six levels of taxonomy to justify itself is probably scoped wrong. 3–5
is the useful range.

---

## 4. Security properties

Full threat-model walk in [`contracts/SECURITY_REVIEW.md`](contracts/SECURITY_REVIEW.md)
(reviewed clean, no code findings). The properties that matter here:

- **`_args` is never believed.** Every path element is either compared against a binding
  (the execution's domain word, the signed root) or fed into `calculateTripleId`, whose
  result must classify as a positive triple *and* carry the attestor's stake. The
  redeemer cannot smuggle a triple id directly — the enforcer computes it.
- **The execution is pinned.** Target must be the governor, selector must be `propose`,
  and only single default execution mode is accepted (batch and try modes revert). Without
  the selector check, any other function on the target would slip through.
- **The enforcer is stateless.** No storage, no value, view-only calls. Hooks are callable
  by anyone, which is safe precisely because there is nothing to poison: an unauthorised
  call is a predicate that reverts or returns.
- **Fail closed.** The live vault *reverts* for never-created terms rather than returning a
  sentinel; the `try/catch` converts that into `NotATriple`. Every error carries the
  offending value, which is what makes the frontend legible.
- **Attestation cannot be gifted.** Verified on the live vault during review: a third
  party cannot `deposit(receiver = attestor)` without prior approval — it reverts. The
  trust anchor of ADR-B holds.

---

## 5. Known limitations — and what I would build next

**`_args` is not signed, so the redeemer chooses *which* valid path to present.**
Harmless here: every path presented is fully verified, so any accepted witness is a
genuine proof of membership. Which of several proofs you pick does not change what is
proven. It would matter only if paths carried semantics beyond reachability (weights,
provenance) — and that is a design change, not a patch.

**`> 0` is a blunt attestation test.** It answers "did this attestor endorse the edge?"
but not "how strongly, and against how much dissent?". Production wants a **stake ratio
against the counter-triple's vault** (`shares(triple) / shares(counterTriple) > k`) or a
**multi-attestor quorum** (m-of-n curators). Both are additive: the terms grow a field,
the loop grows a comparison. The reason it is not in the POC is that any threshold we
picked would be unjustifiable without governance input on what the number means.

**The graph can change between signing and redemption, so a delegation's effective scope
is not static.** This is simultaneously the feature and the risk — it is precisely the
property the bounty asks to demonstrate. ADR-B is what bounds it: scope can only be
widened by an edge *the attestor personally staked*, so drift is bounded by the trust
anchor the signer chose. A voter using themself as attestor cannot have their scope
widened by anyone else at all. The residual risk is an attestor who stakes carelessly,
which is a curation problem, not a protocol one. If a deployment needs hard immutability,
the natural knob is a signed `graphSnapshotBlock` in the terms with historical reads —
at the cost of losing the live-extension property entirely.

**The attestor can weaken a delegation by redeeming shares.** Withdrawing a position
un-authorizes edges and silently narrows scopes downstream. Symmetric to the widening
case and bounded the same way.

**Expiry is re-implemented rather than composed.** All 31 standard enforcers are deployed
on 13579, including `TimestampEnforcer`. We kept `expiry` in our terms for demo legibility
— a parameterized `DelegationExpired(expiry, now)` reads better on stage than a generic
framework revert. Production should compose the audited `TimestampEnforcer` and drop the
field, shrinking the custom surface (ADR-0009).

**`value` is discarded from the execution.** Safe only because `propose` is non-payable.
A production enforcer should bind `value == 0` or compose `ValueLteEnforcer`.

---

## 6. What Mission 11 needs

**The vocabulary already ports.** `calculateAtomId` is `pure` over the atom's data bytes,
so atom ids are deterministic and **chain-independent**. Everything seeded on testnet
keeps its id on mainnet — the domain vocabulary is free groundwork, not throwaway. Only
*state* (existence, stake) is per-chain and must be re-verified before a production write.
The seeding script is already idempotent (compute id → `isTermCreated` → create if absent)
and therefore already the mainnet seeder.

One deliberate deviation to revisit: testnet atoms are raw strings, because that is what
already existed and minting pinned `Thing` variants would have forked the vocabulary.
**Mainnet should seed pinned Things** — richer metadata, better graph citizenship, same
chain-independence. Nothing is wired there yet, so there is no continuity cost (ADR-0008).

**A real Governor integration needs three things** the mock elides: (a) the enforcer must
learn the target Governor's actual proposal signature — most Governors take
`(address[] targets, uint256[] values, bytes[] calldatas, string description)` with no
domain word at all, which is exactly why Open Question 3 matters; (b) the domain must be
recoverable from that calldata deterministically; (c) if voting *weight* is also to derive
from the graph, the enforcer needs a second reading mode (stake-weighted, not boolean),
which is a materially different contract.

**Wallet UX.** The POC drives local demo keys so the presentation needs no wallet dance
(ADR-0011). Production wants browser-wallet or passkey signers on the HybridDeleGator
accounts — supported by the Smart Accounts Kit today, orthogonal to the enforcer.

**A public bundler on the Intuition chain** would remove the self-bundling step entirely
and unlock smart-account UX for every application on the chain, not just this one.

---

## 7. Answers to the three Open Questions

> The exact wording of the bounty's questions should be confirmed against the brief; the
> substance below is what the implementation earned.

**1 — On-chain reads or an off-chain proof pattern?**
**Both, and the split is forced rather than chosen.** Discovery must be off-chain because
the MultiVault has no reverse index — on-chain BFS is impossible, not merely costly.
Verification must be on-chain because the redeemer is untrusted. So: the redeemer computes
the path from the graph index and submits it as a witness in `_args`; the enforcer
recomputes each triple id and checks it against live state, hop by hop, at ~13.9k gas per
hop. Neither pure alternative is available: pure on-chain traversal cannot be written, and
a pure off-chain proof would need a trusted signer and would break the property that the
graph itself is the authority.

**2 — What does a graph edge have to be before it can authorize anything?**
**It has to be staked, not merely to exist.** Permissionless minting means existence costs
1e15 wei and proves nothing; the enforcer therefore requires a position on the edge from a
named `attestor`, using shares as the readable proxy for authorship-or-endorsement (the
creator is not on-chain-readable, but creation forces a deposit). Making `attestor` a
signed term turns one line of code into a governance dial: an org address gives
institutional curation, `address(0)` resolves to the delegator and gives each level of the
chain its own signer's view of the graph. The second is the honest liquid-democracy
reading and it is what the POC demonstrates by default.

**3 — Should the domain live in the proposal calldata or in a registry?**
**Calldata for the POC; a registry is the wrong default for production, but a resolver is
right.** In calldata the domain is bound to the proposal by the signature and needs no
extra storage or trust — that is why it works here, and why the enforcer can check it with
one `bytes32` decode. It fails as soon as you meet a real Governor, whose `propose`
signature has no domain field: you cannot add one without forking the Governor.

The answer that survives contact with production is a **domain resolver**: a small,
enforcer-side interface that maps a proposal (or its target/selector) to a domain id, with
the *resolver address pinned in the signed terms*. Calldata-embedding becomes one resolver
implementation; a registry becomes another; a Governor-specific adapter becomes a third —
and the choice moves into the signed terms rather than into the enforcer's code. The
critical property is that whichever resolver is used must be immutable-per-delegation:
if a mutable registry can re-map a domain after signing, it becomes a silent authority to
rewrite everyone's delegation scope, which is a strictly worse trust story than the graph
itself.

---

## 8. Reproducing this

```bash
bun install
bun run verify            # read-only: asserts every demo claim against live chain state
bun run dev               # the five-panel frontend on http://localhost:5173

cd contracts && forge test   # 46 tests (unit + fork against live MultiVault)
```

From a clean chain: `bun run seed` (vocabulary + attestor stakes) →
`bun run phase3:setup` (three smart accounts) → `bun run phase3:delegate` (sign the
chain) → `bun run phase3:run` (the six acceptance flows).

Decision record: [`docs/adr/`](docs/adr/) — ADRs 0001–0011, each with the
alternatives that were rejected and why. Phase gates and the vocabulary audit (with
re-runnable GraphQL queries) are in [`docs/`](docs/).
