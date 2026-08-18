# 0003 — Path witness in `_args`, verified on-chain (bootstrap ADR-A)

**Status:** Accepted
**Date:** 2026-08-17
**Triggered by:** Bootstrap §4 (architecture decided pre-Phase-0); flag loudly if
implementation proves it wrong.

## Context

The enforcer must decide whether a proposal's domain is under the delegation's root
domain in the Intuition graph. MultiVault storage is
`mapping(bytes32 tripleId => bytes32[3] atomIds)`, keyed by
`hash(subject, predicate, object)`. There is **no reverse index**: the contract can
answer *"does (X, P, Y) exist?"* but never *"what are the children of Y?"*. On-chain BFS
from the root is therefore **impossible**, not merely expensive — the enforcer cannot
discover intermediate nodes.

The bounty's Open Question 1 frames the options as "on-chain reads **or** off-chain
proof pattern."

## Decision

The redeemer **supplies the path** as `_args`
(`bytes32[] path`, `path[0]` = proposal domain, `path[n-1]` = root domain), and the
enforcer **verifies every hop against live chain state**: for each hop `i`,
`tripleId = calculateTripleId(path[i], predicateId, path[i+1])`, then
`getVaultType(tripleId) == 1` (ADR 0005) and the attestor-stake check (ADR 0004).

This is not a trust compromise — it is the standard prover/verifier split, like a Merkle
proof: the redeemer supplies a *witness*, not a *fact*. A forged intermediate node fails
`getVaultType`. Cost is one `keccak` + one `SLOAD`-backed staticcall per hop (~2.5k gas
of state access). It collapses Open Question 1's either/or into a third option that is
both: off-chain path *discovery*, on-chain path *verification*. This argument is the
intellectual core of the writeup.

`_args` is redeemer-supplied and untrusted by construction (it is not part of the signed
delegation); it is safe here precisely because nothing in it is believed — only checked.
Known consequence for the writeup's limitations section: the redeemer chooses *which*
valid path to present when several exist (harmless: any fully-verified path proves
membership).

## Alternatives considered

- **Pure on-chain traversal** — impossible; no reverse index (see Context).
- **Off-chain proof / signed oracle attestation** — rejected; introduces a trusted
  signer and a liveness dependency, and throws away the property that the graph itself
  is the authority. The witness pattern gets equivalent gas economy with no new trust.
- **Maintain a reverse index in our own contract** — rejected; duplicates graph state,
  needs write-path hooks Intuition doesn't offer, and breaks the "no redeploy when the
  graph grows" headline property.

## Consequences

**Positive:**
- Adding `branding — is a sub-domain of — design` to the graph extends every
  `design`-scoped delegation with no contract change — the headline demo.
- Verification cost is linear in path length and bounded by `maxDepth`.

**Negative:**
- The redeemer (frontend / executor tooling) must compute the path client-side from the
  GraphQL index — a liveness dependency on the indexer for *convenience*, though not
  for *correctness* (any correct path can be built from chain data alone).

**Neutral (worth knowing):**
- The graph can change between signing and redemption; a delegation's effective scope
  is deliberately dynamic. ADR 0004 bounds who can extend it.

## References

- Related ADR: `0004-attestation-is-position.md`, `0005-getvaulttype-not-istriple.md`,
  `0007-narrowing-is-emergent.md`
- Related rule: `.claude/rules/metamask-delegation.md` (`_terms` vs `_args` trust model)
