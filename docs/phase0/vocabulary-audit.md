# Intuition Testnet Vocabulary Audit — sub-domain predicate + domain atoms

**Endpoint:** `https://testnet.intuition.sh/v1/graphql` · **Date:** 2026-08-17 · **Mode:** read-only GraphQL (no writes, no chain tx)
**Method:** per Hourglass `.claude/choices/0003-intuition-testnet-predicate-reuse.md` — resolve by `term_id`, never by label; prefer reusing established predicates over minting near-synonyms. Query shapes per `.agents/skills/intuition/reference/graphql-queries.md`.
**Decision derived from this audit:** ADR `.claude/choices/0008-vocabulary-reuse.md`.

**Headline finding:** An atom with the **exact label `is a sub-domain of` already exists** (`0x9c2e2f…`), and its 3 existing triples are **exactly** the intended child-domain → parent-domain semantics (`branding→design`, `UX→design`, `logo→branding`). Four of the five domain words already exist as atoms created in the same 2026-06-23 batch by the same wallet (`0x6d37Ee84c3A7D38f87b9C5DAC761951a4741fD03`) — this looks like a **prior run of this same project's vocabulary**. All five domain words exist as atoms in some form.

Note: `total_shares` = raw share units; `1000000` with `position_count: 0` is the creation-time ghost-share minimum (no real stake).

## A. Predicate: "is a sub-domain of" and variants

| term_id | label | data format | creator | created | positions / shares | as-predicate count | semantic fit |
|---|---|---|---|---|---|---|---|
| `0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80` | `is a sub-domain of` | **TextObject** — raw string `"is a sub-domain of"` (not IPFS-pinned) | `0x6d37Ee84c3A7D38f87b9C5DAC761951a4741fD03` | 2026-06-23T20:30:44Z | 0 / 1000000 (ghost only) | **3** | **Exact.** All 3 triples are child→parent domain (see below). Only atom on the whole graph with "domain" in its label used as a predicate. |
| `0xf499d9dc45d6fa45bccf6e85bda76966814d81f4f104ab6e5a52b53c47e7408d` | `is a` | Thing — `ipfs://QmSbTY2Qqh…` (thing: name `is a`, no description) | `0xEC3dcE71…99BE` (twood.eth) | 2025-10-22T04:08:33Z | 20 / 2.0e16 | **46** | Generic/noisy type-of. Examples: `Bitcoin —is a→ ZKsync`, `Ethereum —is a→ DECENTRALIZED FINANCE`. Not hierarchy-of-domains. |
| `0x5b82f0be01a28f03201267fe94883bcf14530a51810ce8fa6a61ba9060f2265c` | `Is A` | Thing — `ipfs://QmXqK42Z…` (empty description) | `0xBebD…8B49` | 2025-10-22T03:59:42Z | 5 / 5.0e15 | 3 | Casual claims (`audi —Is A→ Best`). No fit. |
| `0x5a7a37ea89c7b36e97e4af174e4f170e3cd6328db9b554f7372a20ed4cb790aa` | `is a` | Thing — `ipfs://QmTm9Aj5…` (description "almost in every conversation") | `0xb9f4…4b38` | 2025-10-22T03:59:39Z | 2 / 2.0e15 | 2 | Duplicate label of `0xf499d9…`; joke atom. No fit. |
| `0xfd3c413995e60603a56f0f547911c0064e116527e78226f6957b655291b88047` | `is part of` | Thing — `ipfs://bafkreigqzhr…` (description: "Indicates that one entity is a component or subset of another.") | `0x2412…c3f1` | 2025-10-22T04:09:03Z | 4 / 4.0e15 | 1 | Closest pinned mereology predicate; 1 use (`TevaStar —is part of→ Tevaera`, product→brand). Broader than domain taxonomy. |
| `0xef06fe17d71087c8e9393f9df5386eba7574fc86282bd93765d33d2735723bf1` | `part of` | Thing — `ipfs://bafkreifiuvxl…` (empty description) | `0xd82f…3e68` (istarengwa.eth) | 2025-10-22T04:08:10Z | 1 / 1.0e15 | **0** | Never used as predicate. |
| `0x72b43d4202fe2070725a41e4ff1c83def872b3befadc0627edcc23ffa11b1c66` | `is a member of` | TextObject — raw string | `0x7fd8…E4D0` | 2025-10-22T04:01:01Z | 9 / 9.0e15 | **178** | Heavily used but semantics = account/community membership (`sergo1.eth —is a member of→ Intuition`). Wrong semantics for domain taxonomy. |

**Absent variants (0 atoms):** `is a subdomain of`, `subdomain of`, `sub-domain of`, `sub domain` / `sub domain of`, `has sub-domain`, `has subdomain` — the wildcard sweeps `%subdomain%`, `%sub-domain%`, `%sub domain%` return exactly 1 atom total (the exact-label hit above), and `%domain%` + in-predicate-use returns only that same atom.

### All 3 existing triples on `is a sub-domain of` (complete usage, all by `0x6d37…fD03`, all 0 positions)

| triple term_id | subject (term_id) | object (term_id) |
|---|---|---|
| `0x176419b5177cfa99cba68cb6b0b884ea7bb593a84f0053ef6baf1e082f373784` | `branding` (`0x8017cd…ee7f`) | `design` (`0x1392c1…b066`) |
| `0xae3359f86f0ea89d3ff29f4d6e36d8d35d1610343da9442e9ca89f4a661ab7de` | `UX` (`0xafd298…9420`) | `design` (`0x1392c1…b066`) |
| `0xdcec7ce37346e051b98f1e19bc7d088a4844cdbe55d2b3ce9a3e5a320d70e865` | `logo` (`0x1d3f36…df7a`) | `branding` (`0x8017cd…ee7f`) |

## B. Domain atoms

| word | term_id | exact label | data format | creator | created | positions / shares | notes |
|---|---|---|---|---|---|---|---|
| design | `0x1392c1e72e3408bd41c4d2b670e4ac4371ca30c1b92b43b15d8b25a6954cb066` | `design` | TextObject — raw `"design"` | `0xcBd987Eb55a8726EF2947A377B016D90dB855415` | 2025-10-22T03:55:40Z | 2 / 2.0e15 | **Already the parent object** of the 2 existing sub-domain triples. |
| design | `0xb90130af296d2d58e41e13816e3cb2fb28347f61b2f5a212fbea7f3dd921e21f` | `Design` | Thing — `ipfs://bafkreigik5dva…`; thing: full Wikipedia-style description + `https://en.wikipedia.org/wiki/Design` | `0xB95ca3D3…9Fc5` (0xvital.eth) | 2025-11-04T04:58:45Z | 1 / 9.8e15 | Best-described pinned "Design" atom; no triple links to the hierarchy. |
| design | `0xac3b822b57e825bf940539ecb942a66393e490751037584db5cf6d21189b8aa2` | `Design` | Thing — `ipfs://bafkreid7lgvr…`; thing: empty description/url | `0xc634457aD68b037E2D5aA1C10c3930d7e4E2d551` (**wieedze.eth** — this project's own wallet) | 2026-05-07T09:00:47Z | 0 / 1000000 (ghost) | Duplicate `Design` label; empty metadata. |
| branding | `0x8017cd335e3f8c0ab844d752a8212952e78b772257c59d65142a6be8ebbeee7f` | `branding` | TextObject — raw `"branding"` | `0x6d37Ee84…fD03` | 2026-06-23T20:30:34Z | 0 / 1000000 (ghost) | **Only** branding atom (no `Branding`). In 2 existing sub-domain triples. |
| UX | `0xafd298baa9c88ca6dd45aee1e061b48f2e5d914fc0a6c02b0a73aa2b83859420` | `UX` | TextObject — raw `"UX"` | `0x6d37Ee84…fD03` | 2026-06-23T20:30:37Z | 0 / 1000000 (ghost) | **Only** UX atom (no `ux`/`Ux`). Subject of `UX→design` triple. |
| legal | `0xc9bbf040865761d20ca7e63e5b00c61db924521e0e0c306a0c4f0e9cf52b2325` | `legal` | TextObject — raw `"legal"` | `0xcBd987Eb…5415` | 2025-10-22T04:06:04Z | 2 / 2.0e15 | **Only** legal atom (no `Legal`). Not yet in any sub-domain triple. |
| logo | `0x1d3f36760a218532b7ceca6364a490f1d2674ec3f3eb29739b9da7e1edaddf7a` | `logo` | TextObject — raw `"logo"` | `0x6d37Ee84…fD03` | 2026-06-23T20:30:41Z | 0 / 1000000 (ghost) | Subject of `logo→branding` triple. |
| logo | `0x04c39152e0c0d28d16d5f67f22ccee35b0a5af4e1ba9b4e6a593ec00b61b5d33` | `logo` | Thing — `ipfs://QmcteApk7…`; thing description: **"logo UHV perbanas"** | `0xbB18…5EEd` | 2025-10-22T03:54:51Z | 2 / 2.0e15 | Semantic mismatch — a specific university's logo, not the concept. |
| logo | `0x07211892dcf3d31f762f27b0f84cf77e93c8314d95937811a7acdfb2356f56ee` | `Logo` | Thing — `ipfs://bafkreic47l4v…`; thing: **the Logo programming language** (+ Wikipedia url) | `0x311F…7695` | 2025-10-22T03:54:59Z | 2 / 2.0e15 | Semantic mismatch — programming language. |

Case-insensitive aggregate across all five words = **9 atoms** (all shown; the search was exhaustive, not truncated).

## Recommendations

See ADR 0008 for the recorded decision. Summary: reuse everything found (predicate `0x9c2e2f…` + the five lowercase TextObject domain atoms); the only missing piece of the intended vocabulary is attestor stake on the three triples (and `legal` deliberately stays unlinked). Per the skill's revalidation bridge, revalidate every chosen `term_id` on-chain with `isTermCreated` before any write; these ids are testnet-specific state.

## Queries used (exact strings, re-runnable via `curl -s -X POST https://testnet.intuition.sh/v1/graphql -H "Content-Type: application/json" -d '{"query":"…","variables":{…}}'`)

Q1 — subdomain label family (variables `{"limit": 50}`):
```graphql
query SubdomainFamily($limit: Int!) { atoms(where: { _or: [ {label: {_ilike: "%subdomain%"}}, {label: {_ilike: "%sub-domain%"}}, {label: {_ilike: "%sub domain%"}} ] }, limit: $limit, order_by: {created_at: desc}) { term_id label type data created_at creator { id label } term { vaults { position_count total_shares } } as_predicate_triples_aggregate { aggregate { count } } } atoms_aggregate(where: { _or: [ {label: {_ilike: "%subdomain%"}}, {label: {_ilike: "%sub-domain%"}}, {label: {_ilike: "%sub domain%"}} ] }) { aggregate { count } } }
```

Q2 — part-of / is-a exact variants (variables `{"limit": 50}`):
```graphql
query PartOfIsA($limit: Int!) { atoms(where: { _or: [ {label: {_ilike: "is part of"}}, {label: {_ilike: "part of"}}, {label: {_ilike: "is a part of"}}, {label: {_ilike: "is a"}}, {label: {_ilike: "has subdomain"}}, {label: {_ilike: "has sub-domain"}}, {label: {_ilike: "has sub domain"}}, {label: {_ilike: "is a subdomain of"}}, {label: {_ilike: "is a sub-domain of"}}, {label: {_ilike: "subdomain of"}}, {label: {_ilike: "sub-domain of"}}, {label: {_ilike: "sub domain of"}} ] }, limit: $limit, order_by: {created_at: asc}) { term_id label type data created_at creator { id label } term { vaults { position_count total_shares } } as_predicate_triples_aggregate { aggregate { count } } } }
```

Q3 — domain words, case-insensitive exact (variables `{"limit": 50}`):
```graphql
query DomainWords($limit: Int!) { atoms(where: { _or: [ {label: {_ilike: "design"}}, {label: {_ilike: "branding"}}, {label: {_ilike: "ux"}}, {label: {_ilike: "legal"}}, {label: {_ilike: "logo"}} ] }, limit: $limit, order_by: {created_at: asc}) { term_id label type data created_at creator { id label } term { vaults { position_count total_shares } } as_predicate_triples_aggregate { aggregate { count } } } atoms_aggregate(where: { _or: [ {label: {_ilike: "design"}}, {label: {_ilike: "branding"}}, {label: {_ilike: "ux"}}, {label: {_ilike: "legal"}}, {label: {_ilike: "logo"}} ] }) { aggregate { count } } }
```

Q4 — example triples per predicate candidate (by `predicate_id`):
```graphql
query ExampleTriples { subdomain: triples(where: { predicate_id: { _eq: "0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80" } }, limit: 5) { term_id subject { term_id label } predicate { term_id label } object { term_id label } subject_id object_id term { vaults { position_count total_shares } } } isa_f499: triples(where: { predicate_id: { _eq: "0xf499d9dc45d6fa45bccf6e85bda76966814d81f4f104ab6e5a52b53c47e7408d" } }, limit: 3) { term_id subject { label } object { label } } isa_5a7a: triples(where: { predicate_id: { _eq: "0x5a7a37ea89c7b36e97e4af174e4f170e3cd6328db9b554f7372a20ed4cb790aa" } }, limit: 3) { term_id subject { label } object { label } } IsA_5b82: triples(where: { predicate_id: { _eq: "0x5b82f0be01a28f03201267fe94883bcf14530a51810ce8fa6a61ba9060f2265c" } }, limit: 3) { term_id subject { label } object { label } } ispartof_fd3c: triples(where: { predicate_id: { _eq: "0xfd3c413995e60603a56f0f547911c0064e116527e78226f6957b655291b88047" } }, limit: 3) { term_id subject { label } object { label } } }
```

Q5 — pinned Thing metadata (variables: `ids` = the 9 Thing/candidate term_ids listed in the tables):
```graphql
query ThingMeta($ids: [String!]) { atoms(where: { term_id: { _in: $ids } }) { term_id label type data value { thing { name description url } } } }
```

Q6 — sweep: any `%part of%` / `%is a%` atoms actually used as predicates:
```graphql
query PartOfInUse { atoms(where: { _and: [ {label: {_ilike: "%part of%"}}, {as_predicate_triples: {}} ] }, limit: 20) { term_id label type data as_predicate_triples_aggregate { aggregate { count } } } isa_variants: atoms(where: { _and: [ {label: {_ilike: "%is a%"}}, {as_predicate_triples: {}} ] }, limit: 30, order_by: { as_predicate_triples_aggregate: { count: desc } }) { term_id label type as_predicate_triples_aggregate { aggregate { count } } } }
```

Q7 — sweep: any `%domain%` atoms used as predicates + `is a member of` detail/examples:
```graphql
query DomainPreds { domain_preds: atoms(where: { _and: [ {label: {_ilike: "%domain%"}}, {as_predicate_triples: {}} ] }, limit: 20) { term_id label type as_predicate_triples_aggregate { aggregate { count } } } member_of: atoms(where: { term_id: { _eq: "0x72b43d4202fe2070725a41e4ff1c83def872b3befadc0627edcc23ffa11b1c66" } }) { term_id label type data created_at creator { id label } term { vaults { position_count total_shares } } } member_examples: triples(where: { predicate_id: { _eq: "0x72b43d4202fe2070725a41e4ff1c83def872b3befadc0627edcc23ffa11b1c66" } }, limit: 3) { subject { label } object { label } } }
```

**Unverified hits:** none — every reported row was resolved by `term_id` directly from query results. One discarded noise hit: a long ETH-Denver-event Thing atom (`0x1b4e876a533b1a472f6d9cb36efec4a2e53149016e8848c23cd2057170676b4b`) matched the `%part of%` sweep only because its label text contains the phrase; irrelevant to the vocabulary.
