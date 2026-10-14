# 0021 — A lending is passed on

**Status:** Accepted
**Date:** 2026-10-14
**Triggered by:** looking for the double-vote bug of ADR 0020 and finding this underneath it.

## Context

The README's first line calls this a three-level delegation chain. It was not one.

A lends `treasury` to B, B lends it to C, C votes. The signatures chain correctly — each
delegation carries its parent's hash as `authority`, the DelegationManager walks the chain
leaf to root, and every caveat on it is enforced. The register did not follow:

```solidity
(address to_, uint256 amount_) = _lentAny(principal, domains);
if (to_ != account) return 0;
```

One hop. Asked whether A's weight belonged to C, it looked up A's lending, found B, and
returned zero. A's hundred stranded at B and dropped out of C's ballot in silence. A
three-level chain counted 200 where it should have counted 300, and no test covered it
because the governor suite only ever tested a single hand-over.

The second thing in the way was in the client. `buildRedeem` pairs each permission context
with its own execution, so redeeming three chains called `castVoteFor` three times; the
first counted and the second was refused by OZ's one-vote-per-account guard, taking the
whole operation down with it. A holder carrying more than one voice could not vote at all.

## Decision

**The register follows the chain to its end.** `_terminalHolder` walks the lendings from a
principal until nobody has passed them on, and a voice is claimable only by whoever is
standing there. A lending is a hand-over, not a copy, and a hand-over can be handed on
again — so an intermediate holds nothing: B, having passed on what it held, cannot claim
A's weight any more than it can claim its own.

Bounded by `MAX_DOMAIN_PATH` and stopped when the chain comes back round to its lender, so
a cycle in the register costs a fixed number of reads instead of every drop of gas
available.

The walk is domain-aware, which is what makes narrowing work without any extra code. If A
lends `treasury` to B and B lends only `grants` to C, then on a `payroll` proposal the walk
from A reaches B and stops — B's lending is on a domain this proposal does not touch — so
A's weight stays with B and is not claimable by C. The same mechanism that follows the chain
is the one that refuses to follow it too far.

**And one chain is redeemed per vote, not one per voice.** Which puts the two halves of
authority where each belongs:

- The **caveat** answers *may this account vote on this domain*. The chain redeemed is
  walked link by link and every caveat on it verifies the announced path against live graph
  state. Redeeming the deepest lineage means the longest chain of signatures in play is the
  one actually checked.
- The **register** answers *whose weight does it carry*, and the governor checks that
  itself, following each named principal's lendings and ignoring any that does not end at
  the voter on a domain that reaches this proposal.

Neither half is taken on trust and neither needs the other repeated. The alternative —
teaching the governor to accumulate across several `castVoteFor` calls in one transaction —
would have meant reimplementing OZ's tally, since `_proposalVotes` is private to
`GovernorCountingSimple`, and the whole point of ADR 0018 is that the audited counting is
inherited as published.

## Consequences

The three-level chain the project is named for now transfers weight, which is the headline
claim and was quietly false.

A holder carrying several voices can vote, which it could not before on this governor.

ADR 0007 said narrowing is emergent because every caveat in a chain must pass. That still
holds for the chain that is redeemed. It no longer holds across *sibling* chains a holder
happens to own, because only one is walked — and it does not need to, because the register
is domain-aware and refuses weight that a narrower lending did not actually route to this
voter.

Proven by `test_ThreeLevels_WeightReachesTheEndOfTheChain`,
`test_ThreeLevels_TheMiddleOfTheChainHoldsNothing` and
`test_ACycleInTheRegisterCarriesNothing` offline, and live on 13579 by `bun run acceptance`,
where C votes on `payroll` carrying B and A for 300.
