# Plan de refonte — la hiérarchie de domaines

> Rédigé le 2026-08-29, après vérification de l'état réel du dépôt.
> Objectif : donner un propriétaire unique à la notion parent / enfant / ancêtre,
> séparer métier et actions, et rendre la base scalable pour un vrai projet.
> Complète `AUDIT.md` (code mort, duplications) — les deux se lisent ensemble.

## État vérifié au moment de la rédaction

- `bun run typecheck` → 0 erreur
- `forge test --no-match-path 'test/fork/*'` → **91 tests passent**, 0 échec
- Contrats redéployés le 2026-08-29 :
  - `MockGovernor` → `0x2bEE53dd6BE3eEea1769A74AAb64773b1C176cEE`
  - `GraphDomainCaveatEnforcer` → `0x948CFe8438161390DbeF07c291Cb8ffDd7955302`
- Sélecteur `delegateWeight(address,bytes32,bytes32[])` (`b703cc39`) **confirmé présent
  dans le bytecode en ligne**. L'ancienne signature 2-args a disparu.

### Déjà corrigé — ne pas refaire

Le blocage ABI/contrat identifié hier est **résolu** :

- `src/lib/abis.ts` porte la signature à 3 arguments, plus les erreurs `AlreadyDelegated`
  et `CoveredByParent`.
- Les trois appelants passent `domainPath` (`signDelegation`, `revokeWeight`, `seed-proposals.ts`).
- `ChainPanel.tsx` calcule le chemin, détecte la couverture par un ancêtre (`coveredBy`),
  et propose `revokeParent()` comme voie de retour.
- `MockGovernor.delegateWeight` refuse un domaine dont un ancêtre est déjà délégué.

**Ce plan part de cet état.** Il ne s'agit plus de réparer, mais de consolider : la logique
de hiérarchie fonctionne, elle est simplement dispersée.

---

## Diagnostic — la hiérarchie n'a pas de propriétaire

« `branding` est sous `design` » est réimplémenté à cinq endroits :

| Où | Forme | Question |
|---|---|---|
| `src/lib/graph.ts` `computePath` | BFS sur `EdgeState[]` | chemin de X vers Y ? |
| `src/components/DomainTree.tsx` (l.42-59) | `Map` reconstruite à chaque render | arbre à afficher ? |
| `src/lib/grants.ts` `covers` (l.45) | wrapper sur `computePath` | ce grant couvre-t-il ce domaine ? |
| `src/components/ChainPanel.tsx` | `computePath` + `labels.slice(1)` | quels ancêtres ? |
| `MockGovernor._verifyPath` / `Enforcer._verifyHops` | `bytes32[]` fourni | le chemin est-il réel ? |

**Les deux implémentations Solidity sont légitimes et doivent rester.** Le MultiVault n'a pas
d'index inverse : la chaîne ne peut pas marcher le graphe, le redeemer fournit donc le témoin,
vérifié hop par hop (ADR 0003). C'est un choix architectural correct.

Le problème est côté TypeScript. `computePath` est appelé **10 fois depuis 5 fichiers**, chaque
appelant reconstruisant l'index des arêtes à chaque invocation :

- `ProposalsPanel` : une traversée **par proposition affichée, à chaque render**
- `DomainTree` : reconstruit `childrenOf`, `hasParent` et `roots` à chaque render
- `ChainPanel` : recalcule le chemin vers la racine à chaque render

Et la logique « quels sont mes ancêtres » vient d'être écrite une deuxième fois dans
`ChainPanel` (`path.labels.slice(1)`), alors que c'est une question de graphe pur.

---

## Étape 1 — `DomainGraph`, la classe qui possède la hiérarchie

**Fichier neuf : `src/lib/domain-graph.ts`.** Objectif : une seule implémentation, indexée une
fois, interrogée partout.

### Constantes à exporter ici

```ts
/** Racine conventionnelle du graphe de gouvernance. */
export const ROOT_DOMAIN = "governance";

/** Séparateur des clés d'arête du manifest (`child->parent`). */
export const EDGE_KEY_SEPARATOR = "->";
```

`"governance"` est aujourd'hui en dur dans `useDemo.ts` et `ChainPanel.tsx` ;
`"->"` est répété dans `demo-config.ts`, `verify-demo.ts` et `rehearse-extend.ts`.

### API proposée

```ts
export class DomainGraph {
  private readonly termIdOf: ReadonlyMap<string, Hex>;
  private readonly labelOf: ReadonlyMap<string, string>;
  private readonly childrenByParent: ReadonlyMap<string, readonly EdgeState[]>;

  /** Construit et indexe. Détecte les cycles ici, une fois pour toutes. */
  static from(nodes: DomainNode[], edges: EdgeState[], limits?: GraphLimits): DomainGraph;

  // — Requêtes de hiérarchie (métier pur, testable sans chaîne) —
  pathTo(from: string, to: string): PathResult;
  pathToRoot(domain: string): PathResult;
  ancestorsOf(domain: string): string[];
  isDescendantOf(domain: string, ancestor: string): boolean;
  childrenOf(domain: string): string[];
  roots(): string[];
  tree(): TreeNode[];

  // — Ponts vers la chaîne : produisent exactement ce que les contrats attendent —
  witnessTo(from: string, to: string): Hex[];
  domainPathOf(domain: string): Hex[];
}
```

### Ce que chaque migration supprime

| Appelant | Remplacement |
|---|---|
| `graph.ts` `computePath` | devient l'implémentation privée de `pathTo` |
| `grants.ts` `covers` | `graph.isDescendantOf(domain, scope)` |
| `ChainPanel` `path.labels.slice(1)` | `graph.ancestorsOf(domain)` |
| `DomainTree` (l.42-59) | `graph.tree()` |
| `ProposalsPanel` filtre `shown` | `graph.isDescendantOf(...)` |
| `useDemo` `computePath(..., "governance")` | `graph.domainPathOf(label)` |

### Points d'attention

- **Immutabilité.** `useDemo` la construit dans un `useMemo` sur `[nodes, edges]` et la passe
  en prop. Les composants ne la reconstruisent jamais.
- **Détection de cycle à la construction.** Règle le garde-fou manquant de `DomainTree`
  (récursion infinie sur `a → b → a`) de façon structurelle, plus dans chaque consommateur.
- **`domainPathOf()` est le point unique** qui sait produire l'argument que le governor exige.
  C'est ce qui évite le retour de la désynchronisation corrigée aujourd'hui.

---

## Étape 2 — Les bornes on-chain, lues et non recopiées

**Principe non négociable : `MAX_DOMAIN_PATH` et `MAX_DELEGATION_DEPTH` restent des
constantes Solidity, seule autorité.** Ce sont des garde-fous anti-DoS qui bornent les boucles
de `_verifyPath`, `_routesTo` et `_wouldCircle`. Un garde-fou dont la valeur dépend de ce que
l'appelant croit n'est plus un garde-fou.

**Ne jamais** recopier ces valeurs en TypeScript, **ne jamais** retirer une vérification
on-chain sous prétexte que le client filtre déjà.

### Le problème réel : le client les ignore

`computePath` peut produire un chemin de 8 hops en toute confiance. L'utilisateur clique, signe,
paye le gas, et découvre `DomainPathTooLong` dans un revert.

### La solution : les lire depuis la chaîne

Les deux sont déjà `public constant` (l.160 et l.170), elles exposent donc un getter.
C'est la règle que le dépôt applique déjà, écrite dans `scripts/seed.ts` l.36 :

> *« Session setup (governance-configurable — query, never hardcode). »*

`getAtomCost`, `getTripleCost` et `getBondingCurveConfig` sont interrogés plutôt que recopiés.
Les bornes du governor relèvent du même traitement.

**À faire :**

1. Ajouter `MAX_DOMAIN_PATH` et `MAX_DELEGATION_DEPTH` à `governorAbi` (absents aujourd'hui).
2. Les lire une fois au chargement, comme `curveId`.
3. Les passer à `DomainGraph.from(..., limits)` pour refuser un chemin trop long **avant**
   de le proposer.

Redondance de confort, jamais de vérité. Si le governor est redéployé avec d'autres valeurs,
le client se réaligne automatiquement.

---

## Étape 3 — `DelegationSet`, l'ensemble des grants en vigueur

**Fichier neuf : `src/lib/delegation-set.ts`**, extrait de `grants.ts`.

Aujourd'hui `upstreamOf`, `candidatesFor` et `weightOn` prennent tous
`(config, edges, grants, holder, domain)` — cinq paramètres répétés qui sont en réalité
l'état d'un objet.

```ts
export class DelegationSet {
  constructor(private readonly grants: readonly Grant[], private readonly graph: DomainGraph);

  liveOn(domain: string): Grant[];
  upstreamOf(holder: Role, domain: string): Set<Role>;
  candidatesFor(holder: Role, domain: string): Role[];

  /** Le grant d'un ancêtre qui emporte déjà ce domaine — miroir de `CoveredByParent`. */
  coveredBy(holder: Role, domain: string): Grant | null;

  /** La chaîne à racheter pour que `holder` vote sur `domain`. Remplace `chainFor`. */
  chainFor(holder: Role, domain: string): { chain: Delegation[]; redeemer: Role; principals: Role[] } | null;
}
```

`coveredBy` déplace dans le métier la logique que `ChainPanel` vient d'écrire en ligne, et lui
donne un nom qui correspond à l'erreur du contrat.

`chainFor` est le point clé : il remplace les constantes en dur `["UX", "design"]` de
`demo-actions.ts` — voir étape 4.

---

## Étape 4 — Corriger `chainFor` (report du §1 de l'AUDIT)

**Toujours d'actualité, vérifié aujourd'hui.** `src/lib/demo-actions.ts` :

```ts
return level === "full"
  ? { chain: [leaf, root], redeemer: "executor", roots: ["UX", "design"], ... }
  : { chain: [root],       redeemer: "delegate", roots: ["design"], ... };
```

Trois conséquences inchangées :

- Les grants signés dans l'UI ne servent jamais à voter (le chemin de vote ne lit pas `grants`).
- Le rôle `voter` ne peut pas voter : `level = "root"` → `redeemer = "delegate"`, la transaction
  part avec la clé de B.
- Renommer un domaine dans le manifest casse le vote silencieusement.

Une fois l'étape 3 faite, la correction devient un appel :

```ts
const plan = delegations.chainFor(role, domain);
```

> **Décision produit requise.** Soit l'UI vote réellement à travers les grants signés en session,
> soit `ChainPanel` est assumé comme illustratif et la démo reste sur la chaîne seedée.
> Ne pas trancher seul.

---

## Étape 5 — Séparer métier et actions

`demo-actions.ts` respecte déjà son en-tête (« No React, no DOM »). Ce qui n'est pas séparé,
c'est le métier **à l'intérieur** de la couche action :

- `signDelegation` fait deux choses : signer (cryptographie) **et** enregistrer un transfert de
  poids (transaction). C'est là que se cache le `toHybridAccount` construit deux fois pour le
  même owner (AUDIT §3g).
- `planVote` calcule des chemins **et** encode de la calldata.
- `chainFor` enfouit une règle métier dans un module d'I/O.

Découpage cible :

```
src/lib/
  domain-graph.ts     ← hiérarchie (métier pur, testable sans chaîne)
  delegation-set.ts   ← grants en vigueur (métier pur)
  demo-actions.ts     ← uniquement I/O chaîne : encode, signe, envoie
```

### Sur la POO — où elle paie, et où elle ne paie pas

`DomainGraph` et `DelegationSet` sont de bons objets : état + invariants + opérations dessus.

En revanche, **ne pas objectiser la couche action**. Les fonctions de `demo-actions.ts` sont
sans état par nature (un client entre, un résultat sort) ; les envelopper dans une classe
ajouterait de la cérémonie sans invariant à protéger. La POO paie là où il y a un état à garder
cohérent — le graphe et l'ensemble des grants — pas sur des appels RPC.

---

## Étape 6 — Nettoyage (report de l'AUDIT)

À faire une fois la refonte stabilisée, dans cet ordre :

1. Code mort : `weightOn`, `previewExtension`, `QUORUM`, champs inutilisés de `DemoState`
   (`rootScope`, `leafScope`, `votingPower`), 10 classes CSS.
   ⚠️ `leafDisabled` reste nécessaire en interne (alimente `baseGrants`) — seule
   l'exposition dans `DemoState` part.
   ⚠️ `state-*`, `tree-holder-*`, `status-pass` sont construites par interpolation : **vivantes**.
2. `configFromManifest()` partagé (`verify-demo.ts` / `rehearse-extend.ts`, ~27 lignes × 2).
3. Bootstrap de script partagé (`phase3-run.ts` / `vote-run.ts`, ~50 lignes × 2).
4. `ROLES` défini 5 fois → une seule.
5. `phase3-delegate.ts` : importer `delegationManagerAbi` et `encodeTerms` depuis `src/lib`
   au lieu de les réimplémenter (risque d'encodages divergents).
6. `RevokePanel` : dé-hardcoder `"UX"` / `"branding"` via `DomainGraph`.

---

## Ordre d'exécution et vérification

| # | Étape | Risque | Dépend de |
|---|---|---|---|
| 1 | `DomainGraph` + migration des 10 appels | moyen | — |
| 2 | Bornes lues on-chain | faible | 1 |
| 3 | `DelegationSet` | moyen | 1 |
| 4 | `chainFor` (décision produit) | élevé | 3 |
| 5 | Scinder `signDelegation` | faible | — |
| 6 | Nettoyage | faible | 1-5 |

Après **chaque** étape :

```bash
bun run typecheck
cd contracts && forge test --no-match-path 'test/fork/*'   # doit rester à 91 tests
bun run verify                                             # lecture seule, ~5 s
```

### Règles à tenir

1. Ne pas casser le typecheck ni les 91 tests.
2. Préserver le style de commentaire (le *pourquoi*, souvent avec renvoi ADR).
3. Aucune dépendance ni abstraction nouvelle hors de celles décrites ici.
4. Ne pas modifier les signatures publiques des contrats — ils sont déployés
   (`manifest/13579.json`, 2026-08-29).
5. **Ne pas toucher au cloisonnement des secrets** (`vite.config.ts`, `canWrite()`) :
   il est déjà correct, cf. AUDIT §6.
