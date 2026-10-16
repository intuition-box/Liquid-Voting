# 0029 — The curator ships in the bundle

**Status:** Accepted
**Date:** 2026-10-16
**Supersedes:** the first draft of this ADR, which approved individual accounts to stake
on the curator's behalf. That mechanism is removed.
**Triggered by:** a browser session that could mint a domain and write its edge, and then
could not stake it — `MultiVault_SenderNotApproved()`, arriving as a bare selector.

## Context

An edge counts when a *named* address holds stake on it, and that name comes from the
delegation's signed terms (ADR 0004 — a triple is permissionless, so existence is not
attestation):

```solidity
if (MULTI_VAULT.getShares(_attestor, tripleId_, curveId_) == 0) revert NotAttested(...);
```

Every delegation this demo signs names one address, the curator. That is what lets one
seeded graph serve every account, and it is the mechanism behind the central claim: a
delegation signed before a domain existed covers it the moment the edge is staked,
because the edge is staked by the voice the signature already named.

`MultiVault.deposit` takes a `receiver` and refuses one that is not the sender unless that
receiver approved it. So staking an edge for the curator means being the curator. On the
local path that was invisible — the key that seeded the graph is the key that submits — but
a hosted visitor's submitter is a burner generated in their browser, which the curator has
never heard of. Minting a domain got as far as the third transaction and failed.

Staking it for the visitor instead is not a fix: the edge would carry stake and authorize
nothing, which is exactly what `test_Fork_UnattestedEdge_LogoFails` demonstrates.

## Options

**A server holds the curator key and approves each session it funds.** Rejected. It keeps
the key off the client, but it buys that with a Cloudflare worker, a KV namespace, a
rate limiter and a deploy to keep alive — and what it guards is a testnet burner. A
compromise of the worker grants exactly what publishing the key grants.

**Approve a fixed set of accounts (the first draft here).** Rejected for the same reason,
plus it does not solve the hosted case at all: a session's wallet is random, so it cannot
be approved in advance.

**Each delegator attests its own graph** (`terms.attestor == 0`, which the enforcer already
supports). Rejected: every account would then need stake on every edge of its own paths,
and the demo's point is that one seeded graph serves all three.

## Decision

**The curator is a testnet burner whose key ships inside the production bundle.**

It is exposed as `VITE_CURATOR_KEY` — `VITE_` rather than `DEMO_` because in this project
`DEMO_*` is injected in development only and `VITE_*` is published. `extendGraph` signs
with it, so the stake always lands on the attestor, and `resolveFunder` uses it to pay for
visitors' sessions, which removes the faucet from the hosted path entirely.

What publishing it actually grants, stated rather than assumed:

- It is **not** the deployer. That key stays in `contracts/.env` and is never exposed.
- `DemoVotes.mint` is already open to everyone by design, so it grants no voting power
  that was not already there for the taking.
- It **can** attest arbitrary edges on this graph, and spend its own few tTRUST.

`bun run build` still greps the bundle for key material and still refuses it. The curator
is exempted **by name** in `scripts/check-bundle.ts`, never by relaxing the rule: the
deployer's key and all three owner keys are still refused, and a guard with a hole shaped
like "any key we decided was fine" is not a guard.

A connected wallet remains a funder, demoted to a fallback. It used to be offered to every
visitor who merely had MetaMask installed, which produced a connection prompt and made
them pay while a funded curator sat unused.

## Consequences

**Positive:**
- A hosted visitor creates a domain and it is covered immediately by delegations signed
  long before, which is the demo's whole argument.
- Nothing to deploy and nothing to keep alive beyond the static site: no worker, no KV, no
  rate limiter, one wallet to top up.
- The trust model is legible: one address attests the graph, and the demo says out loud
  that anyone can act as it.

**Negative:**
- **Anyone can drain it.** When it empties, hosted sessions stop until it is topped up;
  the connected-wallet path is the way through in the meantime.
- **Anyone can attest a false edge** — staking `fee-switch is a sub-domain of treasury`
  would make a treasury grant reach `fee-switch` and the narrowing demonstration would
  quietly stop being true. Recoverable by re-seeding under a fresh curator, but it is a
  live griefing surface during a presentation.
- Rotating the curator means re-staking every edge and re-signing every delegation, since
  the attestor is written into the signed terms.

**Not acceptable beyond a testnet**, and deliberately so. On a real deployment the
attestor is the DAO and extending the graph is a governance action — propose, vote, then
the DAO stakes. The groundwork is that none of the enforcer, the governor or the signed
delegations changes for that: only who holds the role.

## References

- Related ADRs: `0004-attestation-is-a-stake-position.md` (why a named attestor at all),
  `0011-frontend-demo-keys.md` (the rule this is the one exception to),
  `0023-sessions-are-made-in-the-browser.md` (where the burner submitter comes from)
- `src/lib/actions/graph-editing.ts`, `src/lib/config/app-config.ts`,
  `scripts/check-bundle.ts`, `scripts/seed-graph.ts`, `vite.config.ts`
