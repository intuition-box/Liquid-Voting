# 0026 — The clock is the parent chain's

**Status:** Accepted
**Date:** 2026-10-14
**Triggered by:** a session whose accounts reported every step successful, held a hundred
tokens each, and could not vote.

## Context

Setting up a session (ADR 0023) deployed three accounts, gave each a hundred `DVOTE` and
self-delegated so the balance would count. Every step verified its own effect and every
one passed. `getVotes` said 100 for all three. The app showed the last account or two with
no weight and no way to vote, and the first attempt to delegate reverted
`AmountExceedsBalance(…, 100, 0)`.

Nothing had failed. Three facts have to line up, and none of them is obvious on its own.

**`getVotes` is not what the governor reads.** `GovernorVotes._getVotes` calls
`token().getPastVotes(account, timepoint)`, and ERC-5805 refuses to report voting power for
the current timepoint — `getPastVotes` reverts with `ERC5805FutureLookup` if asked. So the
governor reads `clock() - 1`, and a checkpoint written at the current timepoint is invisible
to it until the clock has moved past it.

**`clock()` is not `eth_blockNumber`.** Intuition testnet runs `nitro/v3.9.9` — it is an
Arbitrum Nitro chain, where `block.number` inside the EVM reports the *parent* chain's
height rather than the L2 block height. Measured on 2026-10-14:

```
eth_blockNumber         9,372,167     what the RPC reports
block.number (clock())  48,107,914    what a contract sees
```

A factor of five apart. Verifying a checkpoint by asking `getPastVotes(account,
eth_blockNumber - 1)` is asking about a timepoint five times too early. It answers zero for
every account, always, and looks exactly like a mint that did not land.

**And the clock only moves when an L2 block is produced.** This chain makes no empty blocks:
with no traffic, neither height advanced over 25 seconds of watching. A transaction produces
an L2 block, which resamples the parent height — and the parent advances about once a
second, so two transactions sent back to back read the very same clock:

```
round 1:  48,107,914 -> 48,107,989   delta 75   (idle for a while beforehand)
round 2:  48,107,989 -> 48,107,989   delta  0   (sent immediately after)
round 3:  48,107,989 -> 48,107,996   delta  7   (six seconds later)
```

So waiting alone never helps, and neither does a burst of transactions. Both are needed,
in that order.

## Decision

**The token's own `clock()` is the only timepoint used to reason about voting power.**
`eth_blockNumber` is for naming blocks a reader might look up; it is never an argument to
`getPastVotes`.

**A session does not finish until the governor can see its weight.** `settleWeight` reads
`getPastVotes(account, clock() - 1)` for all three accounts, and while any is short, waits
~1.5 s and sends one cheap transaction to resample. It reports what it did in the
transaction log, under its own step, so the wait is explained rather than merely endured.

It does not throw if the clock is still behind after six attempts. The accounts are
deployed, funded and endowed by then; the next transaction anybody makes will bring the
weight into view, and discarding a working session over a clock a second behind would be
the worse outcome. The step says so.

**Nudges are paced, never batched.** `recordProposal` waits for a proposal to become
Active, which is the same clock in a different costume: it now pauses between fillers
instead of firing twenty transactions that may all read one height.

## Consequences

This is a property of the chain, not of the contracts, and it would bite any ERC-5805
governor deployed on an Arbitrum chain. `SNAPSHOT_WEIGHT = false` (ADR 0015) makes it
visible rather than causing it: reading weight live is what puts the read next to a
checkpoint fresh enough to be out of view. A snapshot deployment would meet the same
constraint at proposal creation instead.

`delegateWeight` checks the balance at `clock() - 1` for the same reason, so settling the
clock is what makes a new session able to delegate at all — not merely able to display
correctly.

The window is about a second of wall clock, and it cannot be shortened by spending more
gas. It can only be waited out, with one transaction at the end of the wait.
