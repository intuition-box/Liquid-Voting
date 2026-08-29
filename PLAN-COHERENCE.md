# Plan de mise en cohérence

> Rédigé le 2026-08-29 après le passage au vocabulaire DAO (commits `752a691` → `538f2a5`).
> Objectif : que le dépôt soit officiel et présentable — le code, le manifest et les
> documents disant tous la même chose.
>
> **Un autre agent travaille en parallèle.** Ce plan est découpé pour que chaque section
> soit applicable seule, et signale ce qui touche des fichiers partagés.

## État vérifié

- `bun run typecheck` → 0 erreur
- `forge test` → **103 tests** (91 unitaires + 12 fork). La commande
  `--no-match-path 'test/fork/*'` en affiche 91 : elle exclut les tests fork, qui
  interrogent le vrai MultiVault. Les deux chiffres sont justes, c'est la commande qui
  change.
- `bun run verify` → vert : les 16 arêtes autorisent, 3 votes délégués passent, 2 rejets
  `NotATriple` viennent bien de l'enforcer.
- Graphe DAO en place, 5 niveaux : `governance → treasury → grants → builder-grants →
  micro-grants`. Délégations signées `A→B` sur `treasury`, `B→C` sur `grants`,
  `maxDepth = 5`.

---

## Déjà appliqué (non commité)

Quatre fichiers modifiés dans le working tree. À committer tel quel, ou à reprendre.

### `DEMO.md` — réécrit sur le graphe DAO

37 mentions de l'ancien vocabulaire (`design`, `branding`, `UX`, `logo`, `legal`) →
**0**. Le script décrivait un graphe qui n'existe plus : chaque étape aurait échoué en
direct. Correspondances retenues :

| Ancien | Nouveau | Rôle dans la démo |
|---|---|---|
| `design` | `treasury` | la racine déléguée A→B |
| `UX` | `grants` | le resserrement B→C |
| `branding` | `payroll` | domaine couvert, poids 2 |
| `legal` | `events` | hors scope, `NotATriple` |
| `motion design` | `audit-fund` | le domaine créé en direct (sous `grants`) |

Durée de l'extension corrigée : 18 s → **8 s** (mesuré).

### `README.md` et `WRITEUP.md`

- Vocabulaire aligné (les occurrences légitimes — « design decisions », « wallet UX » —
  sont conservées).
- **Adresses corrigées** : le WRITEUP annonçait `0x97874e29…` / `0xE9F0B082…`, périmées
  depuis le redéploiement. Remplacées par celles du manifest (`0x948CFe84…` /
  `0x2bEE53dd…`).
- **Compte de tests corrigé** : « 46 passing » → « 103 passing ».
- Tableau des flux vérifiés en direct aligné sur ce que `bun run votes` produit.

### `src/lib/actions/common.ts`

Doublon de commentaire au-dessus de `DEFAULT_MAX_DEPTH` (l'ancien et le nouveau se
suivaient). Ligne morte supprimée, valeur inchangée.

---

## À faire — par ordre d'impact

### 1. Renommer les comptes `voter/delegate/executor` → `A/B/C`

**Demandé explicitement. Touche beaucoup de fichiers — à faire quand l'autre agent a fini.**

L'UI affiche déjà A, B, C (`ROLE_LABELS`), mais le code et le manifest disent
`voter`/`delegate`/`executor`. Deux vocabulaires pour la même chose, et les noms portent
un rôle figé qui n'est plus vrai : depuis la séparation des voix, B est à la fois
délégataire et délégant.

Portée :

- `src/lib/roles.ts` — `Role = "A" | "B" | "C"`, `ROLES`, `ROLE_LABELS` devient l'identité
- `manifest/13579.json` — clés de `accounts`
- `scripts/setup-accounts.ts`, `sign-delegations.ts`, `seed-proposals.ts` — bouclent sur `ROLES`
- `data/accounts.json` — clés des trois clés privées (fichier gitignored, à migrer aussi)
- `scripts/lib/config.ts`, `runner.ts` — construisent `Record<Role, …>`
- `src/lib/config/app-config.ts` — `AppConfig["accounts"]`

Piège : `data/accounts.json` et `manifest.accounts` doivent être renommés **ensemble**,
sinon `setup-accounts` régénère trois nouvelles clés et déploie trois nouveaux comptes.
Prévoir une migration qui relit l'ancien format et réécrit le nouveau, ou renommer les
deux fichiers à la main avant de relancer quoi que ce soit.

Après : `bun run verify`, puis `bun run delegate` si les scopes ont bougé.

### 2. Syntaxe des triples et des stakes dans le manifest

**À vérifier contre l'énoncé du bounty avant de changer quoi que ce soit.**

État actuel :

```json
"predicate": { "label": "is a sub-domain of", "termId": "0x9c2e…" },
"triples":   { "grants->treasury": "0x6609…" },
"attestation": { "stakes": { "grants->treasury": { "shares": "…", "txHash": "…" } } }
```

La clé `child->parent` est une **abréviation interne**, pas la forme du triple. Le triple
réel est `(sujet, prédicat, objet)` = `grants — is a sub-domain of — treasury`, et c'est
bien ce qui est calculé on-chain (`calculateTripleId(subject, predicate, object)`) — la
clé ne sert qu'à s'y retrouver dans le fichier.

Trois options :

- **a)** Laisser tel quel, et documenter la convention en tête du manifest.
- **b)** Passer à une forme explicite :
  `"grants is-a-sub-domain-of treasury"`, ou un objet
  `{ "subject": "grants", "predicate": "is a sub-domain of", "object": "treasury" }`.
- **c)** Aligner exactement sur la syntaxe de l'énoncé du bounty — **il me faut le texte
  de l'énoncé pour trancher**, je ne l'ai pas dans le dépôt.

Si (b) ou (c) : `EDGE_KEY_SEPARATOR` dans `src/lib/graph/domain-graph.ts` et le parsing
dans `scripts/lib/config.ts` suivent. Les termIds ne changent pas — seule la clé de
lecture bouge.

### 3. Le champ `attestation`

Nom peu parlant pour ce qu'il contient : l'adresse de l'attestor, l'id de courbe, et le
détail des dépôts par arête. `stakes` serait plus juste, ou `curation`.

Non urgent, mais c'est le champ que vous avez signalé comme incompréhensible.

### 4. Vérifier `phase0/vocabulary-audit.md` et les ADR

`docs/phase0/vocabulary-audit.md` documente le choix du prédicat sur l'ancien
vocabulaire. À relire pour cohérence — c'est une pièce que les juges peuvent ouvrir.

---

## Ordre suggéré

| # | Étape | Risque | Bloqué par l'autre agent ? |
|---|---|---|---|
| 0 | Committer les 4 fichiers déjà corrigés | nul | non |
| 1 | Syntaxe manifest (§2) — après lecture de l'énoncé | faible | non |
| 2 | Renommer `attestation` (§3) | faible | non |
| 3 | Renommer les rôles en A/B/C (§1) | **élevé** | oui — attendre |
| 4 | Relire les docs `phase0` (§4) | nul | non |

Après chaque étape :

```bash
bun run typecheck
cd contracts && forge test        # 103, fork inclus
bun run verify                    # lecture seule, ~5 s
```

## Ce qu'il ne faut pas casser

1. Le vote passe par les délégations réellement signées (`DelegationSet.chainFor`) —
   jamais de paire codée en dur.
2. Une voix appartient à son émetteur : une délégation par voix, `principal` distinct
   de `from`.
3. `MAX_DOMAIN_PATH` reste on-chain, seule autorité ; le client le lit, ne le recopie pas.
4. `ROOT_DOMAIN = "governance"` dans `domain-graph.ts` — renommer l'atome racine oblige
   à changer cette constante.
5. Le cloisonnement des secrets (`vite.config.ts`, `canWrite()`) — déjà correct.
