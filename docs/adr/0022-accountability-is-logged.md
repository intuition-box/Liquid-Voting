# 0022 — Accountability is logged, not reconstructed

**Status:** Accepted
**Date:** 2026-10-14
**Triggered by:** the Intuition Box review, 2026-10-13 — "viewing A's profile gives no
indication that A's vote was triggered by B", called out as the core gap.

## Context

The proposition of delegating by domain is that a delegator stays accountable for what is
done in its name. The app could not answer the question at all. A handed its treasury to B,
B voted with it, and A's view of the world was unchanged.

OpenZeppelin indexes the account that *submitted* a vote. `VoteCast` and
`VoteCastWithParams` both have `voter` as their only indexed field, so "what was cast in my
name?" meant fetching every vote the governor ever recorded and decoding each one's params
looking for your own address.

Which is what the frontend did, and worse. `readAllBallots` decoded the principals a vote
*claimed*, then asked the register what each of them had lent, then walked the domain's
ancestors because a grant on a parent covers everything beneath it, then capped each share
by what the principal still held. Four helpers, and a sequential contract read per
principal per ballot — arriving, with luck, at a number the governor had already computed
and thrown away. Any divergence between that reconstruction and the contract was invisible
until it mattered.

## Decision

The governor says it, once per voice a vote carried:

```solidity
event VoteCastOnBehalf(
    uint256 indexed proposalId, address indexed principal, address indexed voter, uint256 weight
);
```

`principal` is indexed, which is the whole point: a delegator's question becomes one
filtered query against one topic.

The shares are computed by the same `_ownShare` and `_carriedShare` the vote path uses, at
the same timepoint, so they add up to the weight the tally received. Deriving them from the
total afterwards would be a guess, and a guess is exactly what this replaces.

The frontend reads the event. `readAllBallots` lost ninety lines and four helpers, and a
"My voice" panel answers the review's question directly: what this account holds, what it
handed over, and every share of its weight that reached a ballot, with who carried it and
a link to the transaction.

`hasVoted` is deliberately **not** widened to cover carried voices. It answers OZ's narrower
question — did this account submit a vote — and a partial lender has had something cast in
its name while still being able to vote with the rest, so a boolean there would be wrong
both ways. `voiceCast(proposalId, account)` returns the amount, and `weightOn` returns what
an account may still cast on one open proposal, which is what a vote button should read.

## Consequences

The split is on chain, so anything can read it — a block explorer, a subgraph, a rival
front end — without trusting this one or reimplementing its arithmetic. For a project whose
pitch is on-chain accountability, having it be a client-side reconstruction was close to a
contradiction.

An event per voice costs about 1.5k gas each. A vote carrying three voices pays ~4.5k on
top of a path verification that costs 14k per hop.

A vote cast before this event existed has no split to find. `readAllBallots` shows those
whole, under the voter, rather than dropping them.

Readable reverts came along with it: OZ's own errors are now in the decoder, so a refused
vote says `GovernorAlreadyCastVote(0x…)` instead of "no revert reason" — the least useful
thing a demo aimed at developers can say.
