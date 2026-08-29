# 0012 — One delegation per voice, not one per grant

**Status:** Accepted
**Date:** 2026-08-29
**Triggered by:** user request — "si A revoke B design mais que B lui ne revoke pas B to C, est-ce que C garde B quand même ?"

## Context

Handing a domain on used to sign a single delegation. When B passed `treasury` to C,
that one object carried two different things at once: B's own voice, which is B's to
give, and A's voice, which B only held because A had lent it.

Because the object was chained to A's grant (`authority = hash(A→B)`), the
DelegationManager treated both as one. A revoking its grant killed the whole thing —
including the part that was never A's to take back. The framework is right to refuse a
chain whose root is disabled; the mistake was putting two claims in one chain.

## Decision

Sign one delegation per voice. Handing a domain on produces the signer's own grant, rooted
at `ROOT_AUTHORITY`, plus one relaying each voice lent to it, chained to the grant that
lent it. `redeemDelegations` already takes an array of permission contexts and validates
each independently, so a holder carrying several voices presents several chains.

`Grant` gains a `principal` field: whose voice travels through it, distinct from `from`,
who signed it.

## Alternatives considered

- **One chained delegation (what we had)** — simpler, and correct for a single-level
  chain, but it ties a voice to authority it merely borrowed. Revoking upstream silences
  an account that had delegated its own vote independently.
- **All grants rooted at ROOT_AUTHORITY** — no cascade at all, so revoking A→B would leave
  C exercising A's weight through B with nothing authorising it. Loses the property that
  makes ERC-7710 authority derive.

## Consequences

**Positive:**
- A revoking `treasury` drops the relayed voice and leaves B's own standing: C keeps what
  B gave it. This is the semantics liquid democracy actually needs.
- Each voice is auditable on its own — the grant list reads A → B → C for a relayed one.

**Negative:**
- Handing a domain on signs N delegations rather than one, so N signatures and N distinct
  salts (they differ by authority alone, and `disableDelegation` blacklists a hash).
- A vote redeems N permission contexts, which costs more gas than one.

**Neutral (worth knowing):**
- `DelegationSet` settles the cascade client-side by walking the `authority → hash` links,
  so a chain dead on chain is shown as dead rather than offered and left to revert.
- The governor's weight register is a separate question: `_delegatedTo` holds one delegate
  per domain and does not distinguish an own voice from a relayed one.

## References

- Related ADR: `docs/adr/0007-narrowing-is-emergent.md` — per-delegation hooks are what
  make each level verify against its own signer's scope.
- Related code: `src/lib/actions/delegating.ts`, `src/lib/delegation/delegation-set.ts`
