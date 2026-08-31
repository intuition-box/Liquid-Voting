# 0018 — The app runs on the OpenZeppelin governor

**Status:** Accepted
**Date:** 2026-08-29 (revised 2026-08-31)
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
- Weight is held, not assigned: it comes from an `ERC20Votes` balance, which counts for
  nothing until the holder delegates to itself.
- OZ reads the voter from `_msgSender()`, and an ERC-7710 redemption executes from the
  root delegator's account. Left alone, a vote B redeemed from A would be recorded as A's.

That last point is the one that decided the design, and the first attempt got it wrong.

## Decision

The app talks to `OZGovernor`, `ProposalDomains` and `DemoVotes`. `DemoGovernor` stays
deployed and its tests stay green, but nothing in the frontend points at it.

**The caveat scopes, the governor counts.** A delegated vote is a redemption through the
`DelegationManager`, so `GraphDomainScope` sits on the path and proves the domain is under
the delegated one before anything is counted. What happens after that is OZ's own
`_castVote`: the state check, the tally, the double-vote guard, the event.

Making that possible took one addition to our subclass, `castVoteFor`, which takes the
voter explicitly. It is not a shortcut around OZ. It is the answer to a problem every
ERC-7710 integration with a Governor meets, because the standard executes from the
delegator's account and OZ reads the caller. The enforcer is bound to that selector and
refuses a declared voter who is not the redeemer, so the delegation cannot be used to vote
under a third party's name.

`DomainVotes._getVotes` still overrides the extension point `Governor` declares virtual,
and still decides how much weight the announced principals carry. Scope and weight are
two questions, answered in two places: the caveat says whether the voice may be used here,
the governor says how much it is worth.

Holdings differ on purpose: A holds 12, B holds 30, C holds 7. Equal balances make every
total ambiguous, since 1 and 1 arriving at 2 could be either account's, whereas 12 landing
on 30 is unmistakably A's.

## Alternatives considered

- **Vote directly on the governor, scope checked only by `DomainVotes`.** This is what was
  built first, and it worked. It also quietly removed the caveat from the vote path, so
  the signed delegation was consulted rather than redeemed. That is the contribution the
  project is about, so keeping the result and dropping the mechanism was the wrong trade.
- **Stay on DemoGovernor** — simpler, and the demo already worked. It leaves the strongest
  claim untested in the product itself.
- **Run both, switchable** — twice the surface to keep working, and a demo that has to
  explain which governor it is on before it can explain anything else.

One more thing had to change, and it is the kind of bug that only appears in production.
The enforcer used a single address for two different jobs: the contract a vote must
target, and the contract a proposal's domain is read from. On a governor written for this
scheme those are the same. On OpenZeppelin they are not, because `propose` has nowhere to
put a domain, so it lives in a resolver alongside. The enforcer now takes both, and a test
holds them apart.

## Consequences

**Positive:**
- The demo runs on audited, widely deployed governance code, with nothing in the
  OpenZeppelin package modified.
- The ERC-7710 caveat is on the vote path, so the demo shows the mechanism rather than a
  reimplementation of its result.
- Weight visibly comes from a token rather than from a function anyone could call, which
  is the honest version of how a DAO counts votes.

**Negative:**
- Proposing costs two transactions instead of one.
- Listing proposals is a log read rather than a counter, so it is slower.

**Neutral (worth knowing):**
- `castVoteFor` is ours, so the claim is not "OZ unmodified with one method overridden".
  It is "OZ inherited as published, with a delegated entry point added beside it". Anyone
  presenting this should say the second sentence rather than the first.
- A vote for oneself does not go through the DelegationManager. There is no delegation to
  redeem and nothing for the caveat to check, so it is a plain call to the governor.

## References

- Related ADR: `docs/adr/0014-onchain-bounds-are-read.md`, and the OZ integration in
  `docs/WRITEUP.md` §5.
- Related code: `src/lib/actions/voting.ts`, `src/lib/delegation/encoding.ts`,
  `contracts/src/governance/OZGovernor.sol`, `contracts/src/governance/DomainVotes.sol`
