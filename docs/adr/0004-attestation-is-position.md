# 0004 — Attestation is *position*, not existence (bootstrap ADR-B)

**Status:** Accepted
**Date:** 2026-08-17 (revised same day for bootstrap v2 — `minShares` threshold dropped
in favor of a bare `> 0` check with the `attestor` term as the governance dial)
**Triggered by:** Bootstrap §4 (architecture decided pre-Phase-0).

## Context

Intuition triples are permissionless: anyone can mint
`legal — is a sub-domain of — design` for ~1e15 wei on testnet. If the enforcer treated
triple *existence* as authorization, the acceptance criterion "a `legal` proposal fails"
would break for pocket change — and *"what stops anyone from creating the triple?"* is
the first question the core team will ask in the presentation. It gets answered in one
line of code, not with "it's a POC".

Two MultiVault structural facts are the hinge:

1. **The creator of a term is not readable on-chain.** `AtomCreated`/`TripleCreated`
   carry the creator only as an event; there is no `getCreator` and no storage slot. An
   enforcer cannot filter by creator.
2. **But creation forces a deposit.** `createTriples`/`createAtoms` both take an
   `assets` array, so the creator always holds shares.
   `getShares(X, tripleId, curveId) > 0` is the on-chain-readable proxy for *"X created
   or endorsed this triple"*.

## Decision

Each hop requires the attestor to hold a position on that triple:

```solidity
if (MV.getShares(attestor, tripleId, curveId) == 0) revert NotAttested(tripleId, attestor);
```

**No `minShares` threshold** — `> 0` is sufficient for a POC and avoids tuning a number
that cannot be justified. Stake-*weighted* variants (ratio against the counter-triple's
vault, quorum across several attestors) belong in the writeup as the Mission 11
recommendation, not in this code.

`attestor` is a **term**, so one line of code expresses two governance policies:

| `attestor` in terms | Meaning |
|---|---|
| the org's address / proxy | *"Only our organisation's ontology counts."* Institutional curation. |
| `address(0)` → resolved to `_delegator` at hook time | *"My delegation is read through my own view of the graph."* |

The second is the deeper fit with liquid democracy: `_delegator` differs at each level
of the chain, so every hop is interpreted through its own signer's curation. The first
is what most DAOs would actually deploy. **Demo both** — a two-line terms change
flipping the trust model is a strong presentation moment, and §6 test 10 (attestor
switching) proves the dial works.

## Alternatives considered

- **Existence-only check** — rejected; permissionless minting makes scope injection
  cost ~1e15 wei.
- **`minShares` threshold in terms** — dropped (bootstrap v2); an unjustifiable tuning
  parameter for a POC. The regime comparison moves to the writeup.
- **Total-stake threshold on the triple (anyone's shares)** — rejected; an attacker can
  stake on their own forged edge. *Whose* stake matters, not how much in aggregate.
- **Creator-based filtering** — impossible; creator is not on-chain-readable (Context).

## Consequences

**Positive:**
- Graph-poisoning is neutralized: a minted edge the attestor never staked authorizes
  nothing.
- The trust model is a terms field, not a contract property — two policies, one
  enforcer, no redeploy.

**Negative:**
- Phase 2 must execute attestor deposits on every edge (existence has no teeth); the
  demo needs tTRUST for stakes, not just gas.
- If the attestor redeems their shares, previously valid paths stop verifying —
  delegations weaken silently. That is the feature *and* the risk; the honest framing
  is that this ADR bounds scope drift to the attestor's own actions.

**Neutral (worth knowing):**
- The 0.b audit (ADR 0008) found the three intended sub-domain triples already exist on
  testnet with **zero** real positions — under this ADR they authorize nothing until our
  attestor deposits, which is exactly the designed behavior.

## References

- Related ADR: `0003-path-witness-in-args.md`, `0008-vocabulary-reuse.md`
- Related rule: `.claude/rules/security.md` (front-running / MEV section)
- MultiVault facts: bootstrap §3.2 (facts 3 and 4)
