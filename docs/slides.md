# Slide outline — Intuition core team

Seven slides, ~12 minutes of demo in the middle. Speaker notes are the substance; the
slides themselves should be nearly bare (a title, a diagram, three lines at most).

---

## 1 · The mission, in one sentence

> Voting authority scoped by domain, where the scope check is a traversal of the
> Intuition graph — so adding an edge widens every delegation already signed, with no
> redeploy and no new signature.

**On the slide:** the sentence, and the three live addresses (enforcer, governor,
MultiVault) so anyone can follow along on the explorer.

**Say:** what the acceptance criteria were, and that all of them pass live on 13579.

---

## 2 · The constraint that shaped everything

**On the slide:** the storage line, nothing else.

```solidity
mapping(bytes32 tripleId => bytes32[3] atomIds)   // key = hash(subject, predicate, object)
```

**Say:** you can ask *does (X, P, Y) exist* because you can compute the key. You can
never ask *what are the children of Y*. There is no reverse index — so on-chain BFS is
not expensive, it is impossible. Every design decision downstream follows from this one
fact.

---

## 3 · The answer: a witness, verified hop by hop

**On the slide:** the terms/args split, and one line of gas.

```
terms (signed, immutable):  rootDomain · predicate · maxDepth · expiry · attestor
args  (redeemer, untrusted): bytes32[] path

per hop: calculateTripleId → getVaultType == 1 → getShares(attestor) > 0    ≈ 14k gas
```

**Say:** the prover/verifier split, like a Merkle proof. The redeemer supplies a witness,
not a fact — a forged node produces a triple id that was never created. This collapses
your Open Question 1 into a third option that is both on-chain reads *and* an off-chain
proof pattern, and the split is forced by the storage layout rather than chosen.

---

## 4 · Existence is not attestation

**On the slide:** two rows, nothing else.

```
anyone can mint  “legal is a sub-domain of design”   for ~1e15 wei
authorization therefore follows STAKE, not existence
```

**Say:** the creator of a term is not readable on-chain — but creation forces a deposit,
so shares are the readable proxy for authorship-or-endorsement. Then the dial: `attestor`
is a signed term. An org address gives institutional curation; `address(0)` resolves to
the delegator, so every level of the chain is read through its own signer's view of the
graph. Same contract, two governance models, zero redeploys. **This is the answer to
"what stops anyone creating the triple?"** — and it is the part that makes this a
trust-layer integration rather than a lookup table.

---

## 5 · Demo

Switch to the browser. Follow `docs/DEMO.md`:
graph → exact match → one hop → `events` fails → narrowing blocks `payroll` →
**extend the graph live** → revoking takes back what was lent, not what B gave.

**The moment to land:** a delegation signed before the meeting authorizing
`audit-fund`, a domain that did not exist when it was signed.

---

## 6 · What we found on your chain

**On the slide:** three findings.

- Delegation Framework v1.3.0 is fully deployed on 13579 — all 31 standard enforcers,
  canonical CREATE2 addresses, source-verified. (We verified rather than assumed.)
- `isTriple` returns **true** for counter-triples — using it as an existence check is a
  real vulnerability, reproduced against your live deployment in a fork test. Use
  `getVaultType == 1`.
- There is **no public bundler** on 13579, and `DeleGatorCore.execute` is
  `onlyEntryPoint`. We self-bundle via `handleOps`. A public bundler would unlock smart
  account UX for every app on the chain, not just this one.

**Say:** these are gifts to the DAO regardless of what happens with Mission 11.

---

## 7 · Mission 11

**On the slide:** what changes, in four lines.

- **Vocabulary ports for free** — `calculateAtomId` is pure, so atom ids are
  chain-independent; the seeder is already idempotent and is already the mainnet seeder.
  (Seed mainnet as pinned `Thing`s, not raw strings — nothing is wired there yet.)
- **A domain resolver, pinned in the signed terms** — real Governors have no domain field
  in `propose`. Calldata-embedding and a registry become two implementations of one
  interface, and the choice moves into the terms. Immutable per delegation, or a mutable
  registry becomes a silent authority to rewrite everyone's scope.
- **Attestation gets a shape** — stake ratio against the counter-triple, or an m-of-n
  curator quorum, replacing the POC's `> 0`. The threshold needs governance input, which
  is why it isn't in the POC.
- **Compose, don't re-implement** — drop our `expiry` for the audited `TimestampEnforcer`,
  bind `value == 0` or compose `ValueLteEnforcer`, and budget a real audit.

**Close with the ask.** Then: questions — the appendix in `docs/DEMO.md` has the short answers
to the five we expect.
