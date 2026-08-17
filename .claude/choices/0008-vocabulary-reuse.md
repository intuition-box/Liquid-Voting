# 0008 — Testnet vocabulary: reuse the existing atoms and triples (raw-string atoms)

**Status:** Proposed
**Date:** 2026-08-17
**Triggered by:** Phase 0.b — graph vocabulary audit against testnet GraphQL, following
the methodology of Hourglass ADR 0003 (resolve by `term_id`, never by label; prefer
reuse over near-synonyms). The reuse-vs-create *decision* on the predicate is flagged
for the Intuition team per bootstrap §7 — hence Proposed.

## Context

Audit of `https://testnet.intuition.sh/v1/graphql` on 2026-08-17 (read-only; all rows
resolved by `term_id`; full report with re-runnable queries preserved in
`docs/phase0/vocabulary-audit.md`).

**Headline finding:** the exact predicate and all three intended hierarchy triples
already exist — evidently seeded by a prior run of this same project (creator
`0x6d37Ee84c3A7D38f87b9C5DAC761951a4741fD03`, 2026-06-23 batch; a separate `Design`
Thing atom was created by wieedze.eth `0xc634457aD68b037E2D5aA1C10c3930d7e4E2d551`).

### Reuse-vs-create table

| Item | Verdict | term_id | Format | Notes |
|---|---|---|---|---|
| `is a sub-domain of` | **Reuse** | `0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80` | TextObject (raw string) | Exact label; its only 3 triples are exactly our semantics. No competing sub-domain predicate exists graph-wide. **Thin**: 0 real positions, single creator — exact-but-thin, not independently established. |
| `design` | **Reuse** | `0x1392c1e72e3408bd41c4d2b670e4ac4371ca30c1b92b43b15d8b25a6954cb066` | TextObject | Already the parent object of both existing triples. (A richer pinned `Design` Thing `0xb90130…` exists but is disconnected from the hierarchy.) |
| `branding` | **Reuse** | `0x8017cd335e3f8c0ab844d752a8212952e78b772257c59d65142a6be8ebbeee7f` | TextObject | Sole atom with the label; in 2 hierarchy triples. |
| `UX` | **Reuse** | `0xafd298baa9c88ca6dd45aee1e061b48f2e5d914fc0a6c02b0a73aa2b83859420` | TextObject | Sole atom; subject of `UX→design`. |
| `legal` | **Reuse** | `0xc9bbf040865761d20ca7e63e5b00c61db924521e0e0c306a0c4f0e9cf52b2325` | TextObject | Sole atom; deliberately stays unlinked (negative case). |
| `logo` | **Reuse** | `0x1d3f36760a218532b7ceca6364a490f1d2674ec3f3eb29739b9da7e1edaddf7a` | TextObject | Subject of `logo→branding`. Two same-label Thing atoms are semantic mismatches (a university logo; the Logo language) — label resolution would pick wrong. |

Existing triples (predicate `0x9c2e2f…`, all with **zero** real positions):

| Triple | term_id |
|---|---|
| `branding → design` | `0x176419b5177cfa99cba68cb6b0b884ea7bb593a84f0053ef6baf1e082f373784` |
| `UX → design` | `0xae3359f86f0ea89d3ff29f4d6e36d8d35d1610343da9442e9ca89f4a661ab7de` |
| `logo → branding` | `0xdcec7ce37346e051b98f1e19bc7d088a4844cdbe55d2b3ce9a3e5a320d70e865` |

## Decision

1. **Reuse everything found.** No atom or triple creation is needed on testnet; Phase 2
   reduces to (a) attestor deposits on each of the three triples — under ADR 0004 the
   existing zero-position triples authorize nothing until staked — and (b) emitting the
   term_id manifest. The idempotent seeding script still handles the create path
   (compute id → `isTermCreated` → create if absent) so it works on a clean chain.
2. **Atom format: raw TextObject strings**, resolving the bootstrap's raw-string vs
   pinned-Thing question. The existing, already-wired atoms are raw strings; switching
   to pinned Things would mint a parallel disconnected hierarchy and fragment the
   vocabulary. Tradeoff stated: pinned Things are better graph citizens (rich metadata,
   portal display) and equally chain-independent (the atom data is a content-addressed
   IPFS URI), but graph continuity beats metadata quality for this POC. Mission 11 can
   upgrade the vocabulary to pinned Things on mainnet, where nothing is wired yet.
3. **Escalation flag (bootstrap §7):** whether `is a sub-domain of` should remain
   project-seeded or the team wants a canonical predicate is **the team's call** — the
   evidence is that no established alternative exists (closest: `is part of`
   `0xfd3c41…`, pinned Thing, 1 use, broader mereology semantics; `is a member of`
   `0x72b43d…`, 178 uses, wrong semantics). Recommendation: keep `0x9c2e2f…`.

## Alternatives considered

- **Create a pinned-Thing predicate + fresh Thing atoms** — rejected; orphans the three
  existing conforming triples, fragments the vocabulary (Hourglass ADR 0003's core
  lesson), and adds ~9 paid writes for zero semantic gain.
- **Reuse `is part of`** — rejected; broader mereology (component/subset), 1 use,
  and switching predicates orphans the existing hierarchy.

## Consequences

**Positive:**
- Phase 2 shrinks to deposits + manifest; near-zero new state on a shared testnet.
- term_ids are already stable and can be pinned in tests/frontend now (revalidate with
  `isTermCreated` on-chain before any write — GraphQL is an index, not the authority).

**Negative:**
- Raw-string atoms carry no metadata; the explorer/portal shows bare words.
- The predicate is thin (single creator, no stake) — acceptable for a POC whose trust
  signal is per-edge attestor stake (ADR 0004), but Mission 11 should establish it
  properly on mainnet.

**Neutral (worth knowing):**
- `calculateAtomId` is pure on data, so the raw-string atom ids are chain-independent:
  the same vocabulary keeps its ids on mainnet — free Mission 11 groundwork (for the
  writeup).
- All term_ids above are testnet-specific *state* (existence + stake), even though the
  ids themselves are chain-invariant: mainnet existence must be re-verified before any
  prod write.

## References

- Methodology: Hourglass `.claude/choices/0003-intuition-testnet-predicate-reuse.md`
- Full audit + queries: `docs/phase0/vocabulary-audit.md`
- Related ADR: `0004-attestation-is-position.md`
- Skill: `.agents/skills/intuition/reference/graphql-queries.md`
