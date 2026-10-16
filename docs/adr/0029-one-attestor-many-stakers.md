# 0029 — One attestor, several stakers

**Status:** Accepted
**Date:** 2026-10-15
**Triggered by:** a browser session that could mint a domain and write its edge, and then
could not stake it — `MultiVault_SenderNotApproved()`, arriving as a bare selector.

## Context

The enforcer resolves a domain path by walking attested edges, and what makes an edge
count is a *named* address holding stake on it (ADR 0004 — a triple is permissionless, so
existence is not attestation):

```solidity
if (MULTI_VAULT.getShares(_attestor, tripleId_, curveId_) == 0) revert NotAttested(...);
```

`_attestor` comes from the delegation's signed terms, with one fallback:

```solidity
terms_.attestor == address(0) ? _delegator : terms_.attestor
```

So two models were available from the start. A **named attestor**, where one address speaks
for the whole graph. Or **attestor zero**, where each delegator attests the graph it is
willing to delegate over, and has to hold stake on every edge of the path itself.

The demo signs a named attestor: the account that seeded the vocabulary, recorded in the
manifest as `curation.curator`. That is what lets one seeded graph serve every account, and
it is what makes the central claim work — a delegation signed before a domain existed
covers it the moment the edge is staked, because the edge is staked by the same voice the
signature already named.

The consequence nobody had met until a session hit it: `MultiVault.deposit` takes a
`receiver`, and refuses a receiver that is not the sender unless that receiver approved the
sender. Staking an edge for the curator therefore requires *being* the curator. On the
local path that was invisible — the key that seeds the graph is the key that submits, so the
curator was depositing to itself. A session submits from a burner wallet generated in the
browser, which had never been heard of by anyone.

Staking it for the burner instead is not a fix. The edge would exist, carry stake, and
authorize nothing, because the signed delegations name the curator and the curator holds
nothing on it. That is precisely the case `test_Fork_UnattestedEdge_LogoFails` exists to
demonstrate.

## Decision

**The attestor stays a single named address, and that address approves others to stake in
its name.**

The attestor is treated as a *role*, not a person. Today the role is held by a key. In
production it is the DAO. The enforcer cannot tell the difference and needs no change for
it: `getShares(role, edge)` asks the same question either way.

`bun run setup` has the curator approve each of the three accounts
(`MultiVault.approve(account, 1)` — deposit), recorded in the manifest under
`curation.stakers`. `bootstrapSession` does the same for a session's submitter, but only
when the funder *is* the curator. Approval is idempotent without an `approvals` view to
read: a deposit is simulated in the curator's name, and the approval is sent only when the
answer is `MultiVault_SenderNotApproved`. Any other outcome means it is already there.

`extendGraph` runs that same probe before spending anything.

## Consequences

**Positive:**
- A, B, C and a local session can each pay for and create a domain, and the domain is
  covered by delegations signed before it existed — because the attestation is still the
  role's.
- The trust model is stated rather than implied: one voice attests the graph, and a listed
  set of accounts may act for it. Swapping the key for a DAO address changes nothing else.
- A session that cannot stake is refused before it mints, instead of at the third
  transaction. Finding out last left a domain in the rail that authorized nothing — a
  legitimate state, and an inexplicable one to reach by accident.

**Negative:**
- A hosted session funded by a visitor's own wallet or by the faucet cannot be approved:
  neither is the curator, and only the curator can grant it. Those sessions vote, delegate
  and read everything, and cannot extend the graph. They are told so in a sentence.
- The approval is a standing permission. An approved account could stake anything for the
  curator, including edges the curator would not endorse. Acceptable here because the
  accounts are the demo's own and the chain is a testnet; **not** acceptable for a DAO,
  which is the next point.

**What Mission 11 has to decide, and this deliberately does not:**
- The role should be the DAO, and extending the graph should be a governance action —
  propose, vote, then the DAO stakes — rather than a standing approval to a set of
  accounts. The groundwork here is that nothing in the enforcer, the governor or the signed
  delegations has to change for that: only who holds the role, and how it decides to stake.
- Whether a domain should be removable, which staking alone cannot express (a stake can be
  redeemed, and what that does to delegations already signed over it is unexamined).

## References

- Related ADRs: `0004-attestation-is-a-stake-position.md` (why a named attestor at all),
  `0023-sessions-are-made-in-the-browser.md` (where the burner submitter comes from),
  `0007-emergent-narrowing.md` (what a new edge does to an existing signature)
- `contracts/src/enforcers/GraphDomainScope.sol` — the attestor fallback
- `scripts/setup-accounts.ts`, `src/lib/chain/bootstrap.ts`, `src/lib/actions/graph-editing.ts`
