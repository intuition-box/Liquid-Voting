# 0019 — Weight is lent in parts

**Status:** Accepted
**Date:** 2026-08-31
**Triggered by:** user request — be able to lend some of a balance and keep the rest.

## Context

Delegating a domain moved the whole balance. The register held one address per
`(delegator, domain)` pair, the lender dropped to zero on that domain, and the delegate
counted for both. It made the demo legible and it is what the first implementation needed.

It is also not how anyone actually delegates. Backing someone on the treasury does not
mean going silent on the treasury, and an account holding 12 that wants to lend 5 had no
way to say so. All or nothing is a property of the storage, not a property of delegation.

## Decision

The register stores a `Lending`, which is a delegate and an amount, rather than an address.
`delegateWeight` takes the amount, and both the vote path and the display derive from the
same two rules: a lender casts its balance less what it lent, and a delegate adds what was
lent to it.

One delegate per domain still holds. Splitting a domain across several people is a
different feature with a different revocation story, and nothing here forecloses it.

**The amount is checked twice, and only the second one binds.** `delegateWeight` refuses
an amount larger than the balance, which catches an obvious mistake where the person can
still fix it. But a balance can fall after a delegation is signed, so the vote path caps
the lending at what the lender holds when the vote is counted. Weight nobody has any more
is not weight anybody can lend.

The display had to change with it. It used to derive the split by subtracting the voter's
own balance from the total, which only worked because lending was total. With partial
lendings that subtraction is meaningless, so the split now reads the register through a
new `lendingOf` getter, walking up to the ancestor the grant actually sits on. What is
left after the borrowed voices is the voter's own, derived rather than read, so the parts
always add up to the number the governor counted.

## Alternatives considered

- **Several delegates per domain, each with an amount.** Closer to how liquid democracy is
  usually described, and the natural next step. It turns the register into a list, makes
  revocation name a delegate, and makes every read a loop. Worth doing when the demo asks
  for it, not before.
- **A percentage rather than an amount.** Survives a balance change without a cap, which
  is genuinely nicer. It also means every display carries a rounding, and "I lent 5 of my
  12" is a sentence people say, while "I lent 41.6% of my 12" is not.

## Consequences

**Positive:**
- A lender can back someone and still vote, which is the ordinary case and was impossible.
- `WeightDelegatedAway` is gone: lending everything is now a lending of everything rather
  than a special case the contract has to check for.

**Negative:**
- Reading who carried what costs a register read per principal instead of arithmetic on
  balances.
- The slider is one more thing on screen at the moment of granting. It defaults to the
  whole balance, so anyone who does not care can ignore it.

**Neutral (worth knowing):**
- `DemoGovernor` keeps the all-or-nothing signature. It is no longer what the app talks to,
  and changing it would mean redeploying a contract nothing points at.
- Every account starts with the same hundred. Unequal balances were how a total used to
  say who contributed to it, and naming the amount says that outright, so the endowment
  went back to being equal. An equal footing is also the honest opening for a demo about
  delegation: what should differ between accounts is what they lent, not what they were
  handed. A hundred divides into readable parts, so a quarter is 25 rather than a rounding.

## References

- Related ADR: `docs/adr/0018-app-on-the-oz-governor.md`
- Related code: `contracts/src/governance/DomainVotes.sol`, `src/lib/actions/voting.ts`,
  `src/components/ChainPanel.tsx`
