# 0008 — Testnet vocabulary: create-if-absent with raw-string atoms (converges with the existing seed)

**Status:** Proposed
**Date:** 2026-08-17 (revised same day for bootstrap v2 — the team confirmed we create
the vocabulary ourselves; the audit shows what that means in practice on this testnet)
**Triggered by:** Phase 0.b — graph vocabulary audit against testnet GraphQL, following
the methodology of Hourglass ADR 0003 (resolve by `term_id`, never by label; check
before minting — duplicating an established predicate fragments the vocabulary and is
the kind of thing the core team notices).

## Context

Bootstrap v2 (§4.2): we create the domain atoms and triples ourselves — confirmed with
the team; creation is part of the demo (Phase 4 panel 5 creates a new atom + triple
live). It also asks for a recorded decision on atom format: raw strings vs pinned
`Thing` JSON.

Audit of `https://testnet.intuition.sh/v1/graphql` on 2026-08-17 (read-only; all rows
resolved by `term_id`; full report with re-runnable queries in
`docs/phase0/vocabulary-audit.md`):

**Headline finding:** the exact predicate `is a sub-domain of` and all three intended
hierarchy triples **already exist on testnet** — evidently seeded by a prior run of this
same project (creator `0x6d37Ee84c3A7D38f87b9C5DAC761951a4741fD03`, 2026-06-23 batch; a
separate `Design` Thing atom was created by wieedze.eth
`0xc634457aD68b037E2D5aA1C10c3930d7e4E2d551`). All five domain words exist as raw
TextObject atoms; the three triples carry **zero** real positions (ghost shares only);
`legal` is unlinked, as intended.

**The key mechanical fact:** `calculateAtomId` is pure over the atom's data bytes. For
raw-string atoms, *"create ourselves"* and *"reuse"* are the same act — creating
`branding` again produces the identical term_id, and the idempotent seeding script
(compute id → `isTermCreated` → create only if absent) simply finds it present. The
tension between §4.2 ("create ourselves") and the audit ("it exists") dissolves: on
this testnet the script converges onto the existing ids and proceeds to deposits; on a
clean chain (mainnet, Mission 11) the same script creates everything from scratch.

### Vocabulary table (audit result; ids the manifest will pin)

| Item | On testnet | term_id | Format |
|---|---|---|---|
| `is a sub-domain of` | exists | `0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80` | TextObject |
| `design` | exists | `0x1392c1e72e3408bd41c4d2b670e4ac4371ca30c1b92b43b15d8b25a6954cb066` | TextObject |
| `branding` | exists | `0x8017cd335e3f8c0ab844d752a8212952e78b772257c59d65142a6be8ebbeee7f` | TextObject |
| `UX` | exists | `0xafd298baa9c88ca6dd45aee1e061b48f2e5d914fc0a6c02b0a73aa2b83859420` | TextObject |
| `legal` (stays unlinked) | exists | `0xc9bbf040865761d20ca7e63e5b00c61db924521e0e0c306a0c4f0e9cf52b2325` | TextObject |
| `logo` | exists | `0x1d3f36760a218532b7ceca6364a490f1d2674ec3f3eb29739b9da7e1edaddf7a` | TextObject |
| `branding → design` | exists, 0 positions | `0x176419b5177cfa99cba68cb6b0b884ea7bb593a84f0053ef6baf1e082f373784` | triple |
| `UX → design` | exists, 0 positions | `0xae3359f86f0ea89d3ff29f4d6e36d8d35d1610343da9442e9ca89f4a661ab7de` | triple |
| `logo → branding` | exists, 0 positions | `0xdcec7ce37346e051b98f1e19bc7d088a4844cdbe55d2b3ce9a3e5a320d70e865` | triple |

Same-label distractors confirming the term_id-not-label rule: two `Design` Thing atoms
(one rich, one empty), a `logo` Thing that is a university logo, a `Logo` Thing that is
the programming language. No competing sub-domain predicate exists graph-wide (closest:
`is part of` `0xfd3c41…`, 1 use, broader mereology; `is a member of` `0x72b43d…`, 178
uses, wrong semantics).

## Decision

1. **Atom format: raw TextObject strings.** On this testnet, pinned Things would mint a
   *parallel* vocabulary (different data → different ids), orphaning the three existing
   conforming triples and duplicating labels — precisely the fragmentation 0.b warns the
   core team notices, made worse because the duplicates would be of our own prior seed.
   Tradeoff stated honestly: pinned Things are better graph citizens (rich metadata,
   portal display) and equally chain-independent (their data is a content-addressed IPFS
   URI), and §4.2 is right that this matters for permanent atoms — so **Mission 11
   should seed mainnet as pinned Things**, where nothing exists yet and no convergence
   constraint applies. On testnet, continuity wins.
2. **Seeding is create-if-absent + deposits.** Phase 2's idempotent script computes ids,
   creates only what is missing (on this testnet: nothing, unless state changed —
   revalidate with `isTermCreated` before writing), then executes the attestor deposits
   on all three triples (ADR 0004 — zero-position triples authorize nothing) and emits
   the JSON manifest. Panel 5 exercises the *create* path live on stage
   (`motion design`), so creation is demonstrated regardless.
3. **Escalation flag (bootstrap §7 v2):** is there an Intuition Box ontology or
   namespace these domain atoms should attach to? Evidence gathered (none found in the
   audit's sweeps); the decision is the team's — ask via Wieedze before Phase 2 writes.

## Alternatives considered

- **Pinned-Thing vocabulary on testnet** — rejected; creates a disconnected duplicate
  hierarchy next to our own prior seed (see Decision 1). Adopted instead as the
  Mission 11 mainnet recommendation.
- **Reuse `is part of`** — rejected; broader mereology semantics, 1 use, and switching
  predicates orphans the existing conforming triples.
- **Fresh predicate label (e.g. `has parent domain`)** — rejected; near-synonym minting
  is exactly what Hourglass ADR 0003 warns against.

## Consequences

**Positive:**
- Phase 2 on testnet shrinks to deposits + manifest; near-zero new state on a shared
  chain, and the script is already the Mission 11 mainnet seeder.
- term_ids are stable now and can be pinned in tests/frontend immediately (revalidate
  on-chain with `isTermCreated` before any write — GraphQL is an index, not the
  authority).

**Negative:**
- Raw-string atoms show as bare words in the explorer/portal (no metadata).
- The `design` atom was created by a third party (`0xcBd9…5415`, 2025-10-22) — harmless
  under ADR 0004 (authorization is attestor stake, not creatorship), but worth one line
  in the presentation if asked who owns the vocabulary.

**Neutral (worth knowing):**
- Chain-independent ids: the raw-string vocabulary keeps its term_ids on mainnet — free
  Mission 11 groundwork (writeup point). Existence and stake are per-chain *state* and
  must be re-verified before any prod write.

## References

- Methodology: Hourglass `docs/adr/0003-intuition-testnet-predicate-reuse.md`
- Full audit + queries: `docs/phase0/vocabulary-audit.md`
- Related ADR: `0004-attestation-is-position.md`
- Skill: `.agents/skills/intuition/operations/create-atoms.md` (both formats),
  `reference/graphql-queries.md`
