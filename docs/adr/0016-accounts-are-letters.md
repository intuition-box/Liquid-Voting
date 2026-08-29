# 0016 — The accounts are A, B and C

**Status:** Accepted
**Date:** 2026-08-29
**Triggered by:** user request — "les account doivent être nommés a b c pas voter delegate et executor"

## Context

The three demo accounts were `voter`, `delegate` and `executor` in the code and the
manifest, while the UI called them A, B and C through a `ROLE_LABELS` table. Two
vocabularies for the same three accounts.

The long names also stopped being true. Once voices were split (ADR 0012), B is a delegate
of A and a delegator to C at the same time, and any of the three can be either. The name
described a position in one scenario, not an identity.

## Decision

`Role` is `"A" | "B" | "C"`. The letter is the identity and its own label, so the lookup
table is gone. `manifest.accounts` and `data/accounts.json` are keyed the same way.

`manifest.attestation` becomes `manifest.curation`, and `orgAttestor` becomes `curator`:
the field holds who curates the graph and what they staked per edge.

## Alternatives considered

- **Keep the long names in code, letters in the UI** — what we had; the divergence is
  exactly what made the manifest hard to read against the screen.
- **Rename to something role-neutral but wordier** (`accountOne`…) — no better than a
  letter, and longer at every call site.

## Consequences

**Positive:**
- The manifest, the code and the screen use one vocabulary.
- Nothing in a name claims a fixed role that the delegation graph can contradict.

**Negative:**
- A letter carries no meaning on its own; the demo script has to introduce who they are.

**Neutral (worth knowing):**
- `manifest.accounts` and `data/accounts.json` had to migrate in the same change:
  `setup-accounts` reads keys by role name, so renaming one alone would have generated
  three fresh EOAs and deployed new smart accounts over the demo. Verified by running it.

## References

- Related ADR: `docs/adr/0012-one-delegation-per-voice.md` — why the roles stopped being fixed.
- Related code: `src/lib/roles.ts`
