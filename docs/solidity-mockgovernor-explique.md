# Solidity expliqué ligne par ligne — `MockGovernor.sol`

Document d'apprentissage. On part du fichier [contracts/src/MockGovernor.sol](../contracts/src/MockGovernor.sol)
et on explique chaque construction du langage au fur et à mesure qu'elle apparaît.

Le contrat est un bon terrain d'apprentissage : il contient des `enum`, un `struct`,
un tableau dynamique, un mapping imbriqué, des erreurs personnalisées, des events,
des constantes, et surtout la distinction `storage` / `memory` / `calldata` — le
concept le plus important et le plus piégeux de Solidity.

---

## Sommaire

1. [En-tête du fichier](#1-en-tête-du-fichier)
2. [Les types : `enum` et `struct`](#2-les-types--enum-et-struct)
3. [Les erreurs personnalisées](#3-les-erreurs-personnalisées)
4. [Les événements](#4-les-événements)
5. [L'état : constantes, tableau, mapping](#5-létat--constantes-tableau-mapping)
6. [`propose` — écrire dans l'état](#6-propose--écrire-dans-létat)
7. [`castVote` — le pointeur `storage`](#7-castvote--le-pointeur-storage)
8. [`execute`](#8-execute)
9. [Les fonctions de lecture (`view`)](#9-les-fonctions-de-lecture-view)
10. [Les fonctions privées](#10-les-fonctions-privées)
11. [Fiches de référence](#11-fiches-de-référence)
12. [Ce que ce contrat n'illustre pas](#12-ce-que-ce-contrat-nillustre-pas)

---

## 1. En-tête du fichier

```solidity
// SPDX-License-Identifier: MIT
```

Commentaire spécial, pas du code. Le compilateur le lit pour connaître la licence
et l'inscrit dans les métadonnées du contrat. Sans lui, tu as un warning à la
compilation. `MIT` = licence permissive.

```solidity
pragma solidity >=0.8.23 <0.9.0;
```

`pragma` est une directive au compilateur : « ce fichier doit être compilé avec une
version ≥ 0.8.23 et < 0.9.0 ».

Pourquoi c'est important : **depuis Solidity 0.8.0, les opérations arithmétiques
revertent automatiquement en cas d'overflow/underflow**. Avant 0.8, `uint8 x = 255;
x + 1` valait `0` silencieusement, d'où la bibliothèque `SafeMath` omniprésente dans
le vieux code. Aujourd'hui elle est inutile.

> On borne toujours la version par le haut (`< 0.9.0`) : une future version majeure
> pourrait introduire des ruptures de comportement.

```solidity
/// @title MockGovernor
/// @notice Minimal governance recorder for the POC ...
/// @dev The `propose` signature deliberately carries the domain ...
```

`///` introduit un commentaire **NatSpec** (Ethereum Natural Language Specification),
le format de documentation standard. Les balises :

| Balise | Destinataire | Usage |
|---|---|---|
| `@title` | tous | Nom du contrat |
| `@notice` | utilisateur final | Peut être affiché par un wallet au moment de signer |
| `@dev` | développeur | Détails d'implémentation |
| `@param` | développeur | Un argument |
| `@return` | développeur | Une valeur de retour |

Ce ne sont que des commentaires : **zéro gas**, extraits dans les métadonnées.

```solidity
contract MockGovernor {
```

Déclaration du contrat. Un `contract` ≈ une classe : il possède un état persistant
(le *storage*, écrit sur la blockchain) et des fonctions. Les outils comme Foundry
s'attendent à ce que le nom corresponde au nom du fichier.

---

## 2. Les types : `enum` et `struct`

### `enum`

```solidity
enum ProposalState {
    Pending,
    Active,
    Defeated,
    Succeeded,
    Executed
}
```

Un type énuméré. **En interne c'est un `uint8`** :

| Membre | Valeur |
|---|---|
| `Pending` | 0 |
| `Active` | 1 |
| `Defeated` | 2 |
| `Succeeded` | 3 |
| `Executed` | 4 |

Deux bénéfices : la lisibilité, et le compilateur refuse toute valeur hors bornes.

La conversion vers un entier est **explicite et obligatoire** :

```solidity
uint8 n = uint8(ProposalState.Active);   // 1 — OK
uint8 n = ProposalState.Active;          // erreur de compilation
```

```solidity
enum VoteType {
    Against,   // 0
    For,       // 1
    Abstain    // 2
}
```

Cet ordre n'est pas arbitraire : c'est celui d'OpenZeppelin `GovernorCountingSimple`.
Un outil externe qui envoie `support = 1` s'attend à « Pour ». Réordonner casserait
la compatibilité avec tout l'écosystème.

### `struct`

```solidity
struct Proposal {
    bytes32 domainId;
    address proposer;
    string  description;
    uint256 voteStart;
    uint256 voteEnd;
    uint256 againstVotes;
    uint256 forVotes;
    uint256 abstainVotes;
    bool    executed;
}
```

Un `struct` regroupe des valeurs sous un même type, comme un objet ou un record.

Les types employés :

| Type | Sens |
|---|---|
| `bytes32` | 32 octets bruts, **taille fixe**. Coût constant. Standard pour les identifiants et les hashes. |
| `address` | Adresse Ethereum, 20 octets. |
| `string` | Texte UTF-8, **taille variable** → impose de préciser `memory` / `calldata` / `storage`. |
| `uint256` | Entier non signé 256 bits. C'est le mot machine natif de l'EVM, donc le type le **moins cher**. |
| `bool` | `true` / `false`, 1 octet. |

> **Réflexe à prendre** : `uint256` est moins cher que `uint8` pour une variable
> isolée, parce que l'EVM travaille nativement sur 256 bits et doit ajouter des
> instructions de masquage pour les types plus petits. Les petits types ne
> deviennent rentables que quand ils sont *packés* ensemble (voir ci-dessous).

**Storage packing.** L'EVM range le storage par slots de 32 octets et peut regrouper
plusieurs petits champs contigus dans un même slot. Ici `address` (20) + `bool` (1)
tiendraient ensemble — mais ils sont séparés par un `string` et des `uint256`, donc
pas de packing. Le commentaire `@dev` du fichier explique le compromis : l'ordre des
champs a été figé pour ne pas casser le frontend et le runner d'acceptance qui lisent
les champs par position.

---

## 3. Les erreurs personnalisées

```solidity
error ProposalNotFound(uint256 proposalId);
error VotingNotActive(uint256 proposalId, ProposalState state);
error AlreadyVoted(uint256 proposalId, address account);
error InvalidVoteType(uint8 support);
error ProposalNotSucceeded(uint256 proposalId, ProposalState state);
```

`error` (Solidity ≥ 0.8.4) déclare une erreur typée. On la déclenche avec `revert` :

```solidity
revert ProposalNotFound(42);
```

`revert` **annule toute la transaction** : chaque écriture déjà faite est défaite,
aucun event n'est conservé, et le gas non consommé est rendu.

Comparaison avec l'ancien style :

```solidity
require(id < _proposals.length, "MockGovernor: proposal not found");  // ancien
if (id >= _proposals.length) revert ProposalNotFound(id);             // moderne
```

Avantages de l'erreur personnalisée :

- **moins chère** : 4 octets de sélecteur + arguments ABI-encodés, au lieu de stocker
  une chaîne complète dans le bytecode ;
- **structurée** : le frontend peut décoder et afficher *quel* id a échoué ;
- **typée** : `VotingNotActive` transporte même un `enum` (encodé en `uint8`).

---

## 4. Les événements

```solidity
event ProposalCreated(
    uint256 indexed proposalId,
    bytes32 indexed domainId,
    address indexed proposer,
    string description,
    uint256 voteStart,
    uint256 voteEnd
);
```

Un `event` écrit un **log** dans le receipt de la transaction.

Propriété fondamentale : **les logs ne sont pas lisibles depuis un autre contrat**.
Ils existent pour le monde hors-chaîne (frontend, indexeur, The Graph). En
contrepartie, ils sont **beaucoup moins chers** que le storage — c'est le bon endroit
pour de la donnée qu'on veut consulter mais sur laquelle aucune logique on-chain ne
s'appuie.

### `indexed`

Un paramètre `indexed` devient un **topic** filtrable. Tu peux demander au node
« tous les `ProposalCreated` où `domainId == 0xabc…` » sans parcourir tous les logs.

Deux règles à connaître :

1. **Maximum 3 paramètres `indexed`** par event. Le topic 0 est réservé au hash de la
   signature (`keccak256("ProposalCreated(uint256,bytes32,address,string,uint256,uint256)")`),
   il reste donc 3 places. C'est exactement pourquoi `description`, `voteStart` et
   `voteEnd` ne sont pas indexés ici : les trois places sont prises.

2. **Un type à taille variable `indexed` ne stocke que son hash**, pas le contenu. Un
   `string indexed description` serait donc filtrable mais illisible. Raison
   supplémentaire de le laisser en données brutes.

```solidity
event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight);
event ProposalExecuted(uint256 indexed proposalId);
```

Choix d'indexation typiques : ce sur quoi on voudra filtrer (« tous les votes de
cette adresse », « tous les votes sur cette proposition »).

---

## 5. L'état : constantes, tableau, mapping

### Constantes

```solidity
uint256 public constant VOTING_DELAY  = 1;
uint256 public constant VOTING_PERIOD = 50;
uint256 public constant QUORUM        = 1;
```

Trois choses dans cette ligne :

- **`public`** → le compilateur génère automatiquement un getter `VOTING_DELAY()`
  appelable de l'extérieur. Tu n'écris pas la fonction toi-même.
- **`constant`** → valeur fixée à la compilation, **inlinée dans le bytecode**. Elle
  n'occupe aucun slot de storage, donc la lire est quasi gratuit.
- **Convention** : `MAJUSCULES_AVEC_UNDERSCORES`.

À ne pas confondre avec `immutable` :

| | Valeur fixée | Peut dépendre de… |
|---|---|---|
| `constant` | à la compilation | rien, littéral uniquement |
| `immutable` | au déploiement (constructeur) | arguments du constructeur |
| variable normale | à tout moment | tout |

### Tableau dynamique

```solidity
Proposal[] private _proposals;
```

Un tableau dynamique de structs, en storage.

- `private` → pas de getter généré, et **inaccessible aux contrats héritiers**
  (`internal` le permettrait).
- Le préfixe `_` est une convention pour « privé / interne ».

> ⚠️ **`private` n'est pas un secret.** Tout le storage d'un contrat est lisible sur
> la chaîne avec `eth_getStorageAt`. C'est une restriction de visibilité au niveau du
> *langage*, pas de la confidentialité. Ne mets jamais de donnée sensible on-chain.

### Mapping imbriqué

```solidity
mapping(uint256 proposalId => mapping(address account => bool)) private _hasVoted;
```

Un `mapping` est une table de hachage clé → valeur. Ici **imbriquée** :
`proposalId` → (`account` → `bool`).

La syntaxe avec les noms de clés (`uint256 proposalId =>`) date de Solidity 0.8.18 et
est purement documentaire. L'ancienne forme est strictement équivalente :

```solidity
mapping(uint256 => mapping(address => bool)) private _hasVoted;
```

Deux propriétés à retenir absolument :

1. **Toutes les clés existent déjà**, avec la valeur par défaut du type (`false`, `0`,
   `address(0)`, `""`…). Il n'y a **pas** de notion de « clé absente », donc pas
   d'équivalent de `.has()` ou `in`.
2. **Un mapping n'est pas itérable** et ne connaît pas sa taille. C'est précisément
   pourquoi le tableau `_proposals` existe à côté : pour compter et énumérer.

Lecture : `_hasVoted[3][msg.sender]` → `true` si cette adresse a voté sur la
proposition 3.

---

## 6. `propose` — écrire dans l'état

```solidity
function propose(bytes32 domainId, string calldata description)
    external
    returns (uint256 proposalId)
{
```

### Décomposition de la signature

**`string calldata description` — le *data location***

C'est le concept central de Solidity. Trois emplacements possibles :

| Emplacement | Nature | Modifiable | Coût | Où l'utiliser |
|---|---|---|---|---|
| `calldata` | données brutes de la transaction | non (lecture seule) | le moins cher, aucune copie | paramètres de fonctions `external` |
| `memory` | RAM temporaire, effacée en fin d'appel | oui | moyen | variables locales, retours |
| `storage` | état persistant on-chain | oui | **très cher** | variables d'état, pointeurs internes |

Règle pratique :

- Types à **taille variable** (`string`, `bytes`, tableaux, structs) → tu **dois**
  préciser l'emplacement.
- Types **valeur** (`uint256`, `address`, `bool`, `bytes32`, `enum`) → tu ne le
  précises **jamais**, ils sont copiés d'office.

**`external` — la visibilité**

| Mot-clé | Appelable depuis l'extérieur | Depuis le contrat lui-même | Depuis un héritier |
|---|---|---|---|
| `external` | ✅ | ❌ | ❌ |
| `public` | ✅ | ✅ | ✅ |
| `internal` | ❌ | ✅ | ✅ |
| `private` | ❌ | ✅ | ❌ |

**`returns (uint256 proposalId)` — retour nommé**

Nommer le retour crée une **variable locale initialisée à zéro**. Lui assigner une
valeur suffit ; `return` devient optionnel.

### Le corps

```solidity
    proposalId = _proposals.length;
```

L'id est simplement l'index d'insertion : le premier vaut 0. Comme on ne supprime
jamais d'élément, les ids restent uniques et stables.

```solidity
    uint256 voteStart_ = block.number + VOTING_DELAY;
    uint256 voteEnd_   = voteStart_ + VOTING_PERIOD;
```

**`block.number`** est une variable globale. Les plus courantes :

| Globale | Sens |
|---|---|
| `block.number` | numéro du bloc courant |
| `block.timestamp` | timestamp Unix du bloc |
| `msg.sender` | qui a appelé cette fonction |
| `msg.value` | ETH envoyé avec l'appel (en wei) |
| `msg.data` | calldata brut |
| `tx.origin` | l'EOA à l'origine de la transaction (⚠️ presque jamais ce que tu veux) |

Le suffixe `_` sur `voteStart_` est une convention de style (Solhint, style
OpenZeppelin) pour éviter qu'une variable locale ne masque (« shadow ») un nom du
contrat.

L'addition est protégée : depuis 0.8.0 un overflow **revert** au lieu de reboucler.

```solidity
    _proposals.push(
        Proposal({
            domainId: domainId,
            proposer: msg.sender,
            description: description,
            voteStart: voteStart_,
            voteEnd: voteEnd_,
            againstVotes: 0,
            forVotes: 0,
            abstainVotes: 0,
            executed: false
        })
    );
```

`.push(x)` ajoute un élément à la fin d'un tableau dynamique en storage.

**Construction nommée vs positionnelle** — les deux existent :

```solidity
Proposal({domainId: d, proposer: p, ...})   // nommée   ✅ recommandé
Proposal(d, p, ...)                          // positionnelle  ⚠️ fragile
```

La forme positionnelle compile toujours si quelqu'un réordonne les champs du struct,
mais écrit alors **les mauvaises valeurs dans les mauvais champs**. Utilise toujours
la forme nommée.

En contrepartie, la forme nommée exige **tous** les champs — d'où les
`againstVotes: 0` explicitement écrits alors que 0 est déjà la valeur par défaut.

> ⚠️ **`msg.sender` n'est pas « l'utilisateur ».** Si un contrat appelle `propose`,
> `msg.sender` est *ce contrat*, pas la personne derrière. C'est le point précis que
> la note `@param proposer` du fichier soulève : dans une chaîne de délégation, la
> proposition apparaît comme venant du délégateur racine.

```solidity
    emit ProposalCreated(proposalId, domainId, msg.sender, description, voteStart_, voteEnd_);
```

`emit` déclenche l'événement. Le mot-clé est obligatoire depuis Solidity 0.5.0.

---

## 7. `castVote` — le pointeur `storage`

```solidity
function castVote(uint256 proposalId, uint8 support) external returns (uint256 weight) {
```

**Pourquoi `uint8 support` et pas `VoteType support` ?** C'est volontaire. Si le
paramètre était typé `VoteType` et qu'on envoyait `3`, le décodage ABI déclencherait
un `Panic` générique et opaque. En prenant un `uint8` brut, on peut valider soi-même
et renvoyer l'erreur explicite `InvalidVoteType(3)`.

```solidity
    Proposal storage proposal_ = _requireProposal(proposalId);
```

**Le point le plus important de tout ce document.**

`storage` ici signifie : `proposal_` est un **pointeur** vers la proposition dans
l'état persistant, **pas une copie**. Toute écriture via `proposal_.forVotes += 1`
modifie réellement la blockchain.

Le piège classique :

```solidity
Proposal storage p = _proposals[0];
p.forVotes += 1;   // ✅ l'état est modifié

Proposal memory  p = _proposals[0];
p.forVotes += 1;   // ❌ on modifie une copie en RAM, perdue en fin de fonction.
                   //    Ça compile, ça ne fait rien. Aucun warning.
```

```solidity
    ProposalState state_ = _state(proposal_);
    if (state_ != ProposalState.Active) revert VotingNotActive(proposalId, state_);
    if (_hasVoted[proposalId][msg.sender]) revert AlreadyVoted(proposalId, msg.sender);
    if (support > uint8(VoteType.Abstain)) revert InvalidVoteType(support);
```

**Pattern « checks first »** : toutes les validations avant toute écriture. Comme
`revert` annule la transaction entière, on ne peut jamais laisser un état à moitié
modifié.

`uint8(VoteType.Abstain)` est la conversion explicite enum → entier, ici `2`. Donc
`support > 2` est rejeté ; `0`, `1`, `2` passent.

```solidity
    _hasVoted[proposalId][msg.sender] = true;
```

Le drapeau anti-double-vote est posé **avant** de toucher aux compteurs. C'est
l'esprit du pattern *checks-effects-interactions* : on ferme la porte d'abord.

```solidity
    weight = 1;
    if (support == uint8(VoteType.Against))   proposal_.againstVotes  += weight;
    else if (support == uint8(VoteType.For))  proposal_.forVotes      += weight;
    else                                      proposal_.abstainVotes  += weight;

    emit VoteCast(proposalId, msg.sender, support, weight);
}
```

`weight` est le retour nommé : lui assigner `1` suffit, la fonction renverra `1`.

Le `else` final couvre `support == 2` sans le retester, puisque la validation
précédente a déjà éliminé tout ce qui dépasse 2.

> **Coût** : chaque `+=` sur `proposal_.X` est un `SSTORE`, l'opération la plus chère
> de l'EVM (~5 000 gas pour modifier un slot non nul, ~20 000 pour en écrire un
> nouveau). C'est pourquoi on regroupe les écritures et qu'on préfère les events au
> storage quand la donnée n'a pas besoin d'être lue on-chain.

---

## 8. `execute`

```solidity
function execute(uint256 proposalId) external {
    Proposal storage proposal_ = _requireProposal(proposalId);
    ProposalState state_ = _state(proposal_);
    if (state_ != ProposalState.Succeeded) revert ProposalNotSucceeded(proposalId, state_);
    proposal_.executed = true;
    emit ProposalExecuted(proposalId);
}
```

Pas de clause `returns` → la fonction ne renvoie rien. Encore une écriture à travers
un pointeur `storage`.

**Protection contre le rejeu, sans code dédié.** Poser `executed = true` a un effet
en cascade : `_state` teste `executed` **en premier** et renvoie alors `Executed`
pour toujours. Un second appel à `execute` verrait `Executed`, pas `Succeeded`, et
reverterait. L'idempotence tombe gratuitement de l'ordre des tests dans `_state`.

---

## 9. Les fonctions de lecture (`view`)

```solidity
function proposalCount() external view returns (uint256 count_) {
    count_ = _proposals.length;
}
```

**`view`** — la fonction **lit** l'état mais ne le modifie pas ; le compilateur le
vérifie et refuse toute écriture.

Conséquence pratique majeure : une fonction `view` peut être appelée **gratuitement**
via `eth_call`, sans transaction ni gas, parce que le node l'exécute localement.

Les quatre mutabilités :

| Mot-clé | Lit l'état | Écrit l'état | Reçoit de l'ETH |
|---|---|---|---|
| (aucun) | ✅ | ✅ | ❌ |
| `view` | ✅ | ❌ | ❌ |
| `pure` | ❌ | ❌ | ❌ |
| `payable` | ✅ | ✅ | ✅ |

```solidity
function getProposal(uint256 proposalId) external view returns (Proposal memory proposal_) {
    proposal_ = _requireProposalView(proposalId);
}
```

Ici **`memory` et non `storage`** — et c'est obligatoire. Un pointeur storage ne peut
pas franchir la frontière d'un appel externe : l'appelant reçoit des octets
ABI-encodés, pas une référence à la mémoire d'un autre contrat.

```solidity
function state(uint256 proposalId) external view returns (ProposalState state_) {
    state_ = _state(_requireProposalView(proposalId));
}
```

La fonction publique `state` et la fonction privée `_state` coexistent sans conflit :
noms différents.

Un enum renvoyé est **encodé en `uint8` dans l'ABI**. Le frontend reçoit `3`, pas
`"Succeeded"` — c'est à lui de refaire le mapping.

```solidity
function proposalVotes(uint256 proposalId)
    external
    view
    returns (uint256 againstVotes_, uint256 forVotes_, uint256 abstainVotes_)
{
    Proposal memory proposal_ = _requireProposalView(proposalId);
    return (proposal_.againstVotes, proposal_.forVotes, proposal_.abstainVotes);
}
```

**Retours multiples** : Solidity renvoie un tuple. Côté appelant en Solidity :

```solidity
(uint256 against, uint256 forV, uint256 abstain) = gov.proposalVotes(0);
```

On peut ignorer une position en laissant un trou : `( , uint256 forV, ) = ...`.

Note de style : ici on utilise `return (a, b, c)` explicite plutôt que d'assigner les
trois noms un par un. Les deux formes sont valides et équivalentes.

---

## 10. Les fonctions privées

```solidity
function _requireProposal(uint256 proposalId) private view returns (Proposal storage proposal_) {
    if (proposalId >= _proposals.length) revert ProposalNotFound(proposalId);
    proposal_ = _proposals[proposalId];
}
```

Renvoyer un `Proposal storage` n'est possible que depuis une fonction
`private` / `internal` : c'est un pointeur interne, il ne peut pas sortir du contrat.
C'est ce qui permet à `castVote` et `execute` d'écrire à travers le résultat.

**Pourquoi vérifier l'index à la main ?** L'EVM reverterait de toute façon sur un
accès hors bornes — mais avec un `Panic(0x32)` opaque. L'erreur nommée est bien plus
exploitable côté frontend et côté tests.

```solidity
function _requireProposalView(uint256 proposalId) private view returns (Proposal memory proposal_) {
    if (proposalId >= _proposals.length) revert ProposalNotFound(proposalId);
    proposal_ = _proposals[proposalId];
}
```

**Corps identique, sémantique opposée.** Comme le type cible est `memory`, la ligne
`proposal_ = _proposals[proposalId]` effectue une **copie complète storage → memory**.

Deux fonctions quasi jumelles existent précisément parce que le data location change
tout : l'une pour écrire, l'autre pour lire.

```solidity
function _state(Proposal memory proposal_) private view returns (ProposalState) {
```

Prend un `memory` : la fonction ne fait que lire, une copie suffit.

Le `returns (ProposalState)` est ici **anonyme** — pas de nom de variable. Il faut
donc obligatoirement des `return` explicites dans le corps.

```solidity
    if (proposal_.executed) return ProposalState.Executed;
    if (block.number < proposal_.voteStart) return ProposalState.Pending;
    if (block.number <= proposal_.voteEnd) return ProposalState.Active;
```

Une cascade de retours anticipés où **l'ordre porte la logique** :

1. exécutée → état terminal, on ne regarde rien d'autre ;
2. avant l'ouverture → `Pending` ;
3. `<= voteEnd` (borne **inclusive**) → le vote est ouvert.

```solidity
    uint256 cast_ = proposal_.forVotes + proposal_.againstVotes + proposal_.abstainVotes;
    if (cast_ < QUORUM || proposal_.forVotes <= proposal_.againstVotes) return ProposalState.Defeated;
    return ProposalState.Succeeded;
}
```

`||` est un OU logique **court-circuité** : si `cast_ < QUORUM` est vrai, le second
test n'est jamais évalué.

Le `<=` de `forVotes <= againstVotes` est strict volontairement : **une égalité
parfaite est un échec**. C'est la règle d'OpenZeppelin — une proposition doit gagner
strictement pour passer.

Noter aussi que les abstentions **comptent pour le quorum** mais **ne comptent pas**
dans la comparaison Pour/Contre. C'est là encore le comportement standard.

---

## 11. Fiches de référence

### Data location — la fiche à retenir

```
calldata  →  lecture seule, pas de copie, le moins cher
             (paramètres de fonctions external)

memory    →  copie temporaire en RAM, modifiable, effacée en fin d'appel
             (variables locales, valeurs de retour)

storage   →  état persistant on-chain, pointeur (pas une copie !)
             (variables d'état, retours de fonctions private/internal)
```

Obligatoire pour : `string`, `bytes`, tableaux, structs.
Jamais pour : `uint*`, `int*`, `address`, `bool`, `bytes32`, `enum`.

### Tableau récapitulatif des mots-clés

| Concept | À retenir |
|---|---|
| `storage` / `memory` / `calldata` | Le plus important. `storage` = pointeur persistant, `memory` = copie temporaire, `calldata` = lecture seule et gratuit |
| Visibilité | `external` / `public` / `internal` / `private` |
| Mutabilité | rien (écrit) / `view` (lit) / `pure` (ni l'un ni l'autre) / `payable` (reçoit de l'ETH) |
| `mapping` | Table de hachage. Toutes les clés existent avec la valeur par défaut. **Non itérable**, pas de `.length` |
| `enum` | Sucre syntaxique au-dessus de `uint8`. Conversion explicite obligatoire |
| `struct` | Toujours construire avec la syntaxe nommée `T({a: x, b: y})` |
| `error` + `revert` | Moins cher et plus informatif qu'un `require` avec une chaîne |
| `event` + `emit` | Logs hors-chaîne. `indexed` pour filtrer, **3 max**. Invisibles depuis un contrat |
| `constant` | Inliné dans le bytecode, ne consomme aucun slot de storage |
| `immutable` | Fixé dans le constructeur, également hors storage |
| `public` sur une variable | Génère automatiquement un getter |
| Retours nommés | Assigner la variable suffit, `return` devient optionnel |
| Overflow | Revert automatique depuis 0.8.0. `SafeMath` est obsolète |
| `private` | Restriction du **langage**, pas de la confidentialité. Le storage reste lisible on-chain |

### Coûts relatifs en gas (ordre de grandeur)

```
SSTORE (nouveau slot)        ~20 000   ← à éviter
SSTORE (slot déjà non nul)    ~5 000
LOG (event)                ~375 + 375/topic + 8/octet   ← bon marché
SLOAD (lecture storage)       ~2 100 (froid) / ~100 (chaud)
Opération arithmétique            ~3
```

Règle : si une donnée n'est jamais lue par un contrat, mets-la dans un **event**, pas
en storage.

---

## 12. Ce que ce contrat n'illustre pas

Les briques suivantes que tu croiseras très vite mais qui sont absentes ici :

| Absent | À quoi ça sert |
|---|---|
| `constructor` | Code exécuté une seule fois au déploiement |
| `modifier` | Préambule réutilisable, par ex. `onlyOwner` — un `_;` marque l'emplacement du corps de la fonction |
| Héritage (`is`, `override`, `virtual`) | `contract MyGov is Governor, Ownable { }` |
| `interface` / `abstract contract` | Contrats de type sans implémentation |
| `payable`, `receive()`, `fallback()` | Recevoir de l'ETH |
| Appels externes (`.call`, `IERC20(t).transfer(...)`) | Interagir avec d'autres contrats — et donc **la réentrance**, le risque n°1 |
| `library` + `using X for Y` | Code réutilisable attaché à un type |
| `unchecked { }` | Désactiver localement le contrôle d'overflow pour économiser du gas |
| `assembly { }` | Yul, l'assembleur EVM inline |
| Proxies / `delegatecall` | Contrats upgradables |

La suite logique de l'apprentissage : **héritage + `modifier`**, puis **les appels
externes et la réentrance**.

---

## Fichiers liés

- Le contrat : [contracts/src/MockGovernor.sol](../contracts/src/MockGovernor.sol)
- Ses tests : [contracts/test/unit/MockGovernor.t.sol](../contracts/test/unit/MockGovernor.t.sol) —
  bon complément, les tests Foundry montrent comment on appelle chaque fonction et
  comment on assert un revert (`vm.expectRevert`).
- Notes de comparaison avec un vrai Governor OpenZeppelin :
  [contracts/src/gouvernorOpenZpplinExmple.md](../contracts/src/gouvernorOpenZpplinExmple.md)
