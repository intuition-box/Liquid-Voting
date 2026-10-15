# 0020 — A voice is spent once

**Status:** Accepted
**Date:** 2026-10-14
**Triggered by:** the Intuition Box review, 2026-10-13 — a proposal three accounts hold 300
weight between them reported 300 For with only 200 legitimately behind it.

## Context

A handed `treasury` to B. B voted on a `grants` proposal, carrying its own hundred and A's:
200, correctly. A then took the domain back and voted on the same proposal, and the tally
reached 300.

The register had no memory of the vote. It answered one question — *who may exercise this
account's weight on this domain right now* — and after the revocation the honest answer
was "A itself". The token agreed: A's balance had never moved, because a lending here moves
no tokens. Both registers were telling the truth and the sum was a lie.

Stock OpenZeppelin cannot have this bug, and it is worth being precise about why, because
the reason is not the guard it looks like. `GovernorCountingSimple` keys `hasVoted` on the
account that *submits* a vote, so A voting after B is a different account and passes. What
actually prevents double counting in OZ is the token: `delegate()` moves the checkpoint, so
`getVotes(A)` answers zero and A's second vote counts nothing. The arithmetic makes it
impossible and no guard is needed.

Per-domain delegation gives that up deliberately. A cannot move the token checkpoint to B,
because the checkpoint is global and the grant is for the treasury only — A has to keep its
weight on everything else. So the weight stays where it is and a side register says who may
use it, which means nothing in the token's accounting notices when a voice is spent.

Two near misses were rejected before this one.

**Snapshot the register at proposal creation.** Then a revocation mid-ballot changes
nothing. It also means a delegation made after a proposal opened does not count on it,
which is the opposite of what ADR 0015 chose on purpose: handing a domain over is meant to
take effect at once, and the demo's whole closing move is adding a graph edge and watching
an already-signed delegation widen.

**Widen `hasVoted` to cover carried voices.** One line, and wrong in both directions once
lending can be partial (ADR 0019): a lender who handed over a quarter has had something
cast in its name and may still vote with the rest, so a boolean would both refuse a vote it
should allow and claim a vote that never happened.

## Decision

The governor keeps the ledger OpenZeppelin cannot keep for it: **how much of each account's
weight is already on each proposal, whoever put it there.**

```solidity
mapping(uint256 proposalId => mapping(address principal => uint256 weight)) private _cast;
```

An amount, not a flag, for the partial-lending reason above. The invariant it maintains is
the one that matters: *across a proposal, no more weight is ever counted in an account's
name than it holds.*

Every share a vote would cast is capped by what is left of its principal — `_unspent` is
the balance less what has been cast — and `_getVotes` and the counting path compute that
through the same two functions, `_ownShare` and `_carriedShare`, so the weight displayed is
the weight counted. Having a UI derive this separately is what let the two disagree in the
first place.

**It is written from `_countVote`, not instead of it.** `DomainVotes._spendVoices` runs
after `GovernorCountingSimple` has tallied, and a revert there rolls that tally back with
everything else. `Governor` declares `_countVote` without a body, so this module cannot
reach OZ's implementation through `super` and does not try to; the final contract resolves
the diamond and calls both. Nothing in the OpenZeppelin package is modified or copied.

**Only a genuine double vote is refused.** Carrying nothing because an account lent its
whole weight away, or holds none, is not an error — stock OZ records a vote worth zero and
so does this. The revert is `GovernorAlreadyCastVote`, OZ's own, raised when there is
nothing left to cast *and* something already cast in this account's name.

**And the entry point that names no domain is closed.** A stock `castVote` carries no
params, so the register cannot be read for the domain being voted on — not even to ask
whether this account lent it away. That door bypassed the register entirely. An account
with anything on loan is now sent to the params entry point and told to say which domain it
means (`DomainNotNamed`); an account that has lent nothing has nothing to bypass and keeps
the plain interface a front end like Tally calls.

## Consequences

A revocation stops the next vote and does not retract the last one. That is the right way
round — a governor that could retract a counted vote would be a worse governor — but it has
to be said out loud in the interface, and the "My voice" panel says it.

A voice is spendable once per proposal **by whoever holds it at the moment it is spent**,
which is a rule about proposals and not about accounts: the same lending is spent again,
freely, on the next ballot.

Two SLOADs per principal per vote, and one SSTORE per voice carried. Measured against the
benchmarks in `test/gas/`, inside the noise of the witness verification that dominates this
path.

Proven by `test_RevertWhen_LenderRevotesAfterTakingItBack` and five neighbours offline, and
by `bun run acceptance` live on 13579 — where the 200 stays 200 after the revocation and
the attempt comes back `GovernorAlreadyCastVote`.
