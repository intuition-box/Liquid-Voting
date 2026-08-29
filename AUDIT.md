# Audit de code — Liquid-demo

> Audit de code mort, duplication de logique et sur-ingénierie, réalisé le 2026-08-28.
> Objectif : garder ce POC professionnel et maintenable pour servir de base à un vrai projet.
> Les adresses de wallet et clés privées en dur sont assumées et hors périmètre (voir §6).

## Contexte pour l'agent qui applique ces corrections

Périmètre audité : `src/`, `scripts/`, `contracts/src/`, `contracts/test/`.
Exclus : `contracts/lib/` (submodules forge-std et delegation-framework), `node_modules/`, `dist/`.

Vérifications faites au moment de l'audit, toutes vertes :

- `bun run typecheck` → 0 erreur (mode strict, `noUncheckedIndexedAccess`, `noUnusedLocals`)
- `forge test --no-match-path 'test/fork/*'` → 85 tests passent, 0 échec
- `git ls-files` → aucun secret tracké (`.env`, `data/accounts.json`, `data/delegations.json` correctement ignorés)

**Règles à respecter en appliquant ces corrections :**

1. Ne pas casser `bun run typecheck` ni les 85 tests Solidity. Les relancer après chaque section.
2. Préserver le style de commentaire existant : il explique le *pourquoi* (souvent en renvoyant à un ADR de `docs/adr/`), pas le *quoi*. C'est une qualité du repo, pas du bruit.
3. Ne pas ajouter de dépendance, de couche d'abstraction ni de fichier de config non demandé.
4. Ne pas toucher aux signatures publiques des contrats Solidity (ils sont déjà déployés, cf. `manifest/13579.json`).

**État général : la base est solide.** La séparation lib/hooks/composants est réellement respectée,
`GraphDomainCaveatEnforcer.sol` est sans état avec des erreurs paramétrées et des boucles bornées.
Les corrections ci-dessous sont du raffinement, pas du sauvetage.

---

## 1. Bug de correction — les délégations signées dans l'UI ne servent jamais à voter

**Priorité : haute. C'est le seul vrai bug, et il touche la fonctionnalité centrale de la démo.**

### Le problème

`src/lib/demo-actions.ts`, fonction `chainFor` (~ligne 61) ignore le contenu réel des grants
et code en dur la paire de délégations issue du seed :

```ts
function chainFor(config: DemoConfig, level: ChainLevel) {
  const { root, leaf } = config.delegations;
  return level === "full"
    ? { chain: [leaf, root], redeemer: "executor", roots: ["UX", "design"], principals: ["voter", "delegate"] }
    : { chain: [root],       redeemer: "delegate", roots: ["design"],       principals: ["voter"] };
}
```

Et `src/components/ProposalsPanel.tsx` (~ligne 95) choisit la chaîne ainsi :

```ts
const level = role === "executor" ? "full" : "root";
```

### Trois conséquences concrètes

**a) Les grants signés via `ChainPanel` sont purement décoratifs.**
`signDelegation` signe, `addGrant` persiste en localStorage, `DomainTree` affiche le badge —
mais le chemin de vote ne consulte jamais `demo.grants`. Si A donne `legal` à C pendant la démo,
le vote de C sur `legal` passera toujours par la paire seedée et échouera.
Seul le transfert de poids on-chain (`delegateWeight`) prend effet, ce qui rend l'écart
d'autant plus déroutant : le badge et le poids affichés disent oui, le vote dit non.

**b) Le rôle `voter` ne peut pas voter.**
Avec `role = "voter"` → `level = "root"` → `redeemer = "delegate"`. `submitVote` construit
alors le compte avec la clé de B et soumet en son nom. A clique sur « for » et c'est B qui vote.

**c) Les labels `"UX"` / `"design"` en dur** signifient qu'un renommage de domaine dans
`manifest/13579.json` casse le vote silencieusement, sans erreur de typage.

### Correction attendue

Dériver la chaîne depuis `grants` (le rôle courant + le domaine sélectionné) au lieu de deux
constantes. `src/lib/grants.ts` contient déjà la logique de graphe nécessaire (`upstreamOf`,
`covers`, `computePath`) : c'est un chaînon manquant, pas une réécriture.

Le redeemer doit **toujours** être le rôle qui clique — c'est l'invariant que l'enforcer
vérifie de son côté (`VoterIsNotRedeemer`).

> **Décision produit requise avant d'appliquer :** soit l'UI vote réellement à travers les
> grants signés en session (correction complète ci-dessus), soit la démo reste sur la chaîne
> seedée et `ChainPanel` est explicitement présenté comme illustratif. Ne pas trancher seul.

### Note sur l'état du repo

Un travail en cours touche déjà `ChainPanel.tsx`, `useDemo.ts`, `demo-actions.ts` et
`demo-config.ts` (ajout de `revokeGrant` / `saveSessionGrants`). Vérifier que ces
modifications ne recouvrent pas déjà une partie de ce point avant de commencer.

---

## 2. Code mort

**Priorité : basse. Aucun risque, ~170 lignes supprimées.**

### Fonctions sans aucun appelant (ni `src/`, ni `scripts/`)

| Symbole | Fichier | Taille |
|---|---|---|
| `weightOn` + `WeightBreakdown` | `src/lib/grants.ts` (~ligne 92-141) | ~50 lignes |
| `previewExtension` + `ExtensionPreview` | `src/lib/demo-actions.ts` (~ligne 385-417) | ~33 lignes |
| `QUORUM` | `src/lib/demo-actions.ts` (~ligne 296) | 1 ligne |

`weightOn` est particulièrement trompeur : il calcule le poids côté client alors que le
governor est devenu l'autorité (`readWeights`). Le laisser invite à s'en resservir et à
réintroduire une divergence UI / chaîne.

### Champs exposés par `useDemo` que personne ne lit

Dans `src/hooks/useDemo.ts` — retirer de l'interface `DemoState`, du `return`, et supprimer
les states/calculs associés :

- `rootScope` et `leafScope` (calculés par le `scopeOf` local, voir §3e)
- `votingPower` — déclenche en plus un `readVotingPower` (3 appels RPC) à chaque refresh pour rien
- `leafDisabled` — **attention** : la variable reste nécessaire en interne, elle alimente
  `baseGrants(config, rootDisabled, leafDisabled)`. Seule l'exposition dans `DemoState` part.

Si `readVotingPower` n'a plus d'appelant après ça, le supprimer aussi de `demo-actions.ts`.

### Classes CSS mortes — `src/styles.css`

10 classes, ~80 lignes, vestiges d'une mise en page abandonnée :

`chip` (l.554), `chip-on` (l.569), `filters` (l.548), `level-dead` (l.714), `level-head` (l.719),
`level-scope` (l.695), `proposal-pick` (l.575), `role-badge` (l.244 et l.251),
`split-side` (l.99 et l.112), `tree-tick` (l.644), `wiring-side` (l.122)

> **Piège à éviter :** `state-*`, `tree-holder-*` et `status-pass` **sont bien utilisées**,
> via interpolation (`` `state-${proposal.state}` ``, `` `tree-holder-${side}` ``,
> `` `status-${verdict}` ``). Un outil de détection naïf les signalera à tort — ne pas les supprimer.

---

## 3. Duplications de logique

**Priorité : haute pour (a) et (d) — ce sont des sources de bugs silencieux.**

### a) Bootstrap `DemoConfig` dupliqué mot pour mot — ~27 lignes × 2

`scripts/verify-demo.ts` (~l.53-79) et `scripts/rehearse-extend.ts` (~l.59-85) construisent
un objet `DemoConfig` identique à partir du manifest.

C'est la duplication la plus coûteuse : **tout champ ajouté à `DemoConfig` doit être répliqué
aux deux endroits, sans que rien ne le signale.**

→ Extraire `configFromManifest()` dans `scripts/lib/` (à côté de `network.ts`).

### b) Bootstrap des scripts dupliqué — ~50 lignes × 2

`scripts/phase3-run.ts` (~l.50-81) et `scripts/vote-run.ts` (~l.53-81), identiques à la ligne près :
lecture de `accounts.json` / `delegations.json`, transport, `publicClient`, `submitter`,
les trois smart accounts, extraction des atoms.

→ Extraire un helper partagé dans `scripts/lib/`.

### c) La liste des rôles est définie 5 fois

- `src/lib/demo-config.ts` (~l.35) — `const ROLES: Role[]`
- `src/lib/grants.ts` (~l.5) — `export const ROLES: Role[]`
- `src/lib/demo-actions.ts` — deux fois en local, dans `readWeights` et `readVotingPower`
- `scripts/phase3-setup.ts` (~l.26)
- `scripts/seed-proposals.ts` (~l.42)

→ Une seule définition doit survivre. `grants.ts` importe déjà le type `Role` depuis
`demo-config.ts` : c'est le point de convergence naturel.

### d) `phase3-delegate.ts` réimplémente ce que `src/lib` exporte déjà

Dans `scripts/phase3-delegate.ts` :

- `delegationManagerAbi` redéfini sur 30 lignes (~l.35-65) alors que `src/lib/abis.ts` le contient
- `encodeTerms` réécrit (~l.77-88) alors que `src/lib/delegation.ts` (~l.47) l'exporte

**Risque réel : deux encodages de termes divergents produisent des délégations non redeemables,
sans la moindre erreur de compilation.** Les autres scripts importent déjà correctement depuis
`src/lib` — celui-ci est le seul écart.

→ Importer depuis `src/lib` et supprimer les copies locales.

### e) `scopeOf` dupliqué

Corps identique dans `src/hooks/useDemo.ts` (~l.160-165) et `src/lib/grants.ts` (~l.20-25).
Celui de `useDemo` n'alimente que `rootScope` / `leafScope`, qui sont morts (§2) —
il disparaît donc avec eux.

### f) `requireEnv` recopié, et dégradé

Défini deux fois à l'identique dans `scripts/seed.ts` et `scripts/phase3-setup.ts`.
Réécrit en ligne sous forme dégradée (`process.env["PRIVATE_KEY"] ?? ""`) dans
`scripts/phase3-run.ts` et `scripts/vote-run.ts` — cette variante silencieuse produit une clé
vide et un échec obscur au lieu d'un message clair.

→ Un seul `requireEnv` dans `scripts/lib/`, utilisé partout.

### g) `signDelegation` construit deux fois le même compte

`src/lib/demo-actions.ts` : `delegator` (~l.195) puis `account` (~l.229) — même rôle, même clé,
deux dérivations de compte inutiles. Réutiliser la première.

---

## 4. Sur-ingénierie

**Priorité : basse. Le repo est globalement sobre, seulement deux points.**

### a) `planVote` / `planVoteForcingWitness`

`src/lib/demo-actions.ts` : `planVoteForcingWitness` enveloppe `planVote`, qui n'est jamais
appelé directement ailleurs. La justification est bonne (montrer l'échec on-chain plutôt qu'un
refus UI) mais deux fonctions publiques pour un seul usage réel entretiennent le doute sur
laquelle appeler.

→ Rendre `planVote` privé, ou documenter explicitement laquelle est l'API publique.

### b) `readSessionGrants<T>()` inutilement générique

`src/lib/demo-config.ts` (~l.216) : le seul type utilisé est `Grant`. Le générique n'apporte
aucune sécurité — `isSessionGrant` renvoie `boolean` et le `as T[]` contourne la vérification.

→ Typer directement sur `Grant` : plus sûr et plus court.

---

## 5. Robustesse — deux angles morts

**Priorité : moyenne.**

### a) `DomainTree.build` est récursif sans détection de cycle

`src/components/DomainTree.tsx` (~l.49-55). Le graphe vient de la chaîne et rien n'empêche
un cycle `a → b → a`, qui fige l'onglet en stack overflow. L'`ErrorBoundary` rattrape le rendu,
mais un `Set` de nœuds visités coûte trois lignes et évite le problème à la source.

### b) `RevokePanel` code en dur des labels de domaine

`src/components/RevokePanel.tsx` (~l.50-51) utilise `"UX"` et `"branding"` comme sondes
post-révocation. Même fragilité que §1c : renommez un domaine et la sonde teste autre chose
que ce qu'elle annonce.

→ Dériver ces labels depuis la config / les grants.

---

## 6. Sécurité des secrets — RAS, ne rien changer

Vérifié et **correct** : le cloisonnement est bien fait et constitue le bon design pour un POC
destiné à grandir.

- `vite.config.ts` n'injecte les secrets que si `command === "serve"`. Un build de production
  reçoit des valeurs vides, `canWrite()` passe à false, les panneaux d'écriture basculent en
  lecture seule (ADR 0011).
- `data/accounts.json` n'est délibérément **pas** globbé par `import.meta.glob` — il transite
  uniquement par le define dev-only `__DEMO_OWNER_KEYS__`.
- `git ls-files` confirme qu'aucun secret n'est tracké (seul `contracts/.env.example` l'est,
  ce qui est voulu).

**Ne pas « durcir » ce point : il est déjà correct, et le toucher risquerait de casser la démo.**

---

## Ordre d'application recommandé

1. **§1 — corriger `chainFor`** (après décision produit). Sans quoi la fonctionnalité centrale
   — déléguer depuis l'UI — reste un décor.
2. **§3a + §3b — extraire `configFromManifest()` et le bootstrap de script partagé.**
   Supprime ~80 lignes copiées et le principal risque de dérive.
3. **§2 — supprimer le code mort** (`weightOn`, `previewExtension`, `QUORUM`, les champs
   inutilisés de `DemoState`, les 10 classes CSS). ~170 lignes, sans risque.
4. **§3c + §3d — unifier `ROLES`, faire pointer `phase3-delegate` sur `src/lib`.**
   Supprime la classe de bugs « deux encodages divergents ».
5. **§5 — garde-fou de cycle dans `DomainTree`, dé-hardcoder les sondes de `RevokePanel`.**
6. **§3e, §3f, §3g, §4 — finitions.**

Les étapes 2 à 6 sont mécaniques et sûres. Seule l'étape 1 demande une décision de conception.

Après chaque étape : `bun run typecheck` puis
`cd contracts && forge test --no-match-path 'test/fork/*'`.
