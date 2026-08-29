# 0015 — A DAO-shaped vocabulary, five levels deep

**Status:** Accepted
**Date:** 2026-08-29
**Triggered by:** the demo scenario — a design-agency ontology did not look like anything
a DAO would govern

## Context

The graph seeded in Phase 2 was `design → branding → logo`, `UX`, `legal`. It exercised
the mechanism correctly but read as an example rather than a use case, and it was shallow:
three levels, so the depth of the traversal — the thing that costs gas and that the caveat
bounds — was never really shown.

## Decision

Reseed the vocabulary as a DAO's own governance ontology, five levels deep:

```
governance → treasury → grants → builder-grants → micro-grants
                      → payroll → contributor-comp
           → protocol → parameters → fee-switch, rate-model
                      → upgrades  → emergency-patches
           → community → events, content
```

The demo delegates `treasury` (A→B) and narrows to `grants` (B→C). The predicate is
unchanged: `is a sub-domain of`, resolved by term id (ADR 0008).

## Alternatives considered

- **Keep the design ontology** — works, but a reviewer has to translate it into their own
  governance before the argument lands.
- **A deeper synthetic tree** — depth without meaning; the point is that the hierarchy is
  one a DAO would actually recognise.

## Consequences

**Positive:**
- Four hops from root to `micro-grants` exercises the path witness and `maxDepth` for real.
- The refusal case is `events` under a `treasury` grant: two branches of the same DAO,
  which is a sharper illustration than an unrelated domain.

**Negative:**
- Everything referencing the old labels had to follow: the demo script, the writeup, the
  seeded proposals, the signed delegations. The atom ids derive from the label, so the
  whole vocabulary was re-created and re-staked on chain.

**Neutral (worth knowing):**
- `DEFAULT_MAX_DEPTH` moved from 3 to 5 — the deepest branch is four hops from the root.
- The signer now chooses how deep a grant reaches, signed into the terms.

## References

- Related ADR: `docs/adr/0008-vocabulary-reuse.md` — the atom format decision, unchanged.
- Related doc: `docs/DEMO.md`
