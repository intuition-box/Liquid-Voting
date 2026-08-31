# 0018 — The app runs on the OpenZeppelin governor

**Status:** Accepted
**Date:** 2026-08-29
**Triggered by:** user request — run the demo on OpenZeppelin rather than on our own
governor, and show what each identity holds.

## Context

The POC shipped with `DemoGovernor`, written from scratch. It made the demo easy: voting
power is a map, so an identity can be given a weight and a delegation changes it at once.
It also invites the obvious objection, that the scheme might depend on a governor we
control.

`OZGovernor` had been deployed and tested (ADR 0015 lineage, WRITEUP §5) but nothing
connected to it. Moving the app across meant four things:

- OZ has no proposal counter and stores no proposal struct. An id is a hash of the call a
  proposal would execute, and the details live in `ProposalCreated`.
- `propose` takes a call, not a subject, and has nowhere to put a domain. The resolver
  beside the governor holds that, so proposing is two transactions.
- Voting goes through `castVoteWithReasonAndParams`, the entry point that carries the
  `params` our domain register reads.
- Weight is held, not assigned: it comes from an `ERC20Votes` balance, which counts for
  nothing until the holder delegates to itself.

## Decision

The app talks to `OZGovernor`, `ProposalDomains` and `DemoVotes`. `DemoGovernor` stays
deployed and its tests stay green, but nothing in the frontend points at it.

Each identity holds one `DVOTE`, self-delegated, so the numbers stay legible: a handover
takes an account from 1 to 2 rather than from 47 to 93. The masthead shows the balance,
and says when one is not self-delegated, because a balance that counts for nothing is a
real state and an unhelpful thing to debug from a weight of zero.

## Alternatives considered

- **Stay on DemoGovernor** — simpler, and the demo already worked. It leaves the strongest
  claim untested in the product itself.
- **Run both, switchable** — twice the surface to keep working, and a demo that has to
  explain which governor it is on before it can explain anything else.

## Consequences

**Positive:**
- The demo runs on audited, widely deployed governance code, with nothing in the
  OpenZeppelin package modified.
- Weight visibly comes from a token rather than from a function anyone could call, which
  is the honest version of how a DAO counts votes.

**Negative:**
- Proposing costs two transactions instead of one.
- Listing proposals is a log read rather than a counter, so it is slower.

**Neutral (worth knowing):**
- **The ERC-7710 caveat is no longer on the vote path.** On this governor the scope is
  checked by `DomainVotes._verifyPath` at vote time, not by `GraphDomainScope` at
  redemption. The enforcer stays deployed, tested and documented, and it is still the
  contribution the bounty asks about — but the running app now demonstrates the same
  scoping through the governor's own extension point rather than through a delegation
  being redeemed. Anyone presenting this should say so rather than let it be discovered.
- verify changed with it: there is no redemption to simulate, so it asks the graph
  whether a grant on one domain reaches another, which is the same question the panel asks.

## References

- Related ADR: `docs/adr/0014-onchain-bounds-are-read.md`, and the OZ integration in
  `docs/WRITEUP.md` §5.
- Related code: `src/lib/actions/voting.ts`, `contracts/src/governance/DomainVotes.sol`
