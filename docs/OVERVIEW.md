# Ce qu'on a construit, et pourquoi

> Une explication en clair, sans prérequis. Pour le détail technique — gas, limites,
> alternatives écartées — voir [WRITEUP.md](WRITEUP.md). Pour les décisions une par une,
> [`adr/`](adr/).

---

## Le problème

Dans une DAO, déléguer son vote est aujourd'hui **tout ou rien**. Vous confiez votre voix
à quelqu'un, et cette personne vote sur tout : la trésorerie, les paramètres du protocole,
les événements communautaires. Or personne n'est compétent partout.

Ce qu'on voudrait dire, c'est :

> « Je te confie mon vote **sur la trésorerie**. Pas sur le reste. »

Le problème, c'est que « la trésorerie » n'est pas une adresse ni un nombre. C'est un
**domaine** — une notion qui a des sous-parties, qui évoluent. La trésorerie contient les
subventions, qui contiennent les subventions aux développeurs, qui contiennent les
micro-subventions. Et cette arborescence change : une DAO crée un nouveau programme tous
les trimestres.

Un système classique demanderait de lister les domaines autorisés au moment de la
signature. Chaque nouveau programme obligerait alors à re-signer toutes les délégations.

---

## L'idée

**La hiérarchie des domaines existe déjà** — dans le graphe de connaissances d'Intuition,
où la DAO décrit sa propre organisation :

```
governance
├── treasury
│   ├── grants
│   │   ├── builder-grants
│   │   │   └── micro-grants
│   │   └── retro-funding
│   └── payroll
│       └── contributor-comp
├── protocol
│   ├── parameters  →  fee-switch, rate-model
│   └── upgrades    →  emergency-patches
└── community  →  events, content
```

Chaque flèche est une affirmation publique enregistrée on-chain :
`grants — is a sub-domain of — treasury`.

**Notre idée : ne pas lister les domaines dans la délégation, mais y inscrire une
question.** La délégation ne dit pas « tu peux voter sur grants, payroll, micro-grants… »,
elle dit :

> « Tu peux voter sur tout domaine que le graphe rattache à `treasury`. »

La différence est décisive. Ajoutez une branche au graphe, et **toutes les délégations
déjà signées la couvrent immédiatement** — sans redéployer de contrat, sans re-signer quoi
que ce soit. Le périmètre suit l'organisation parce qu'il *est* l'organisation.

C'est la démonstration centrale : on crée un domaine en direct pendant la présentation, et
une délégation signée avant la réunion l'autorise.

---

## Comment la vérification fonctionne

Une contrainte a façonné toute l'architecture : **le graphe ne peut pas être parcouru
depuis un contrat.** On peut demander « ce lien existe-t-il ? », jamais « quels sont les
enfants de ce nœud ? ». Il n'y a pas d'index inverse.

Le parcours on-chain n'est donc pas coûteux — il est *impossible*.

D'où la répartition retenue :

| Côté | Rôle |
|---|---|
| **Le navigateur** | trouve le chemin `micro-grants → builder-grants → grants → treasury` et le joint au vote |
| **Le contrat** | ne le croit pas — il **recalcule** chaque maillon contre l'état on-chain |

Le chemin fourni sert d'indice sur *où regarder*, jamais de preuve. Pour chaque maillon, le
contrat recalcule l'identifiant du lien et pose deux questions au graphe :

1. **Ce lien existe-t-il vraiment**, comme affirmation positive ?
2. **Le curateur a-t-il misé dessus ?**

La deuxième question est ce qui empêche la triche.

*(Le détail complet est dans le schéma [scope-check.excalidraw](scope-check.excalidraw).)*

---

## Pourquoi la mise, et pas seulement l'existence

Sur Intuition, **n'importe qui peut créer n'importe quelle affirmation** pour une fraction
de centime. Rien n'empêche un délégué mal intentionné de publier :

```
events — is a sub-domain of — treasury
```

Si le contrat se contentait de vérifier l'existence du lien, ce délégué **élargirait
lui-même sa propre délégation** pour presque rien.

C'est pourquoi l'autorisation suit la **mise**, pas l'existence. Un lien sur lequel le
curateur n'a rien misé n'autorise rien. Créer une fausse affirmation reste possible — elle
ne sert simplement à rien.

Et *quelle* mise compte est inscrit dans la signature : l'adresse d'une organisation pour
une curation institutionnelle, ou une valeur spéciale qui désigne le délégateur lui-même —
chaque niveau lit alors le graphe selon sa propre vision de l'organisation.

---

## Une voix appartient à qui l'a émise

Le point qui a demandé le plus de réflexion.

Quand A confie `treasury` à B, puis que B transmet à C, B transmet **deux choses
différentes** : sa propre voix, qui lui appartient, et celle de A, qu'il ne fait que
porter.

Notre première version les regroupait dans un seul objet signé. Conséquence : si A
reprenait sa voix, C perdait **tout** — y compris ce que B lui avait donné de son propre
chef, ce que A n'avait aucun droit de reprendre.

**La solution : une délégation signée par voix portée.** B en signe deux vers C — l'une
pour sa voix propre, l'autre relayant celle de A. Elles vivent séparément :

| A reprend `treasury` | Résultat |
|---|---|
| la voix de A relayée par B | meurt — elle dépendait de A |
| la voix propre de B | **survit** — elle n'a jamais été à A |

Concrètement : C passe de 3 voix à 2. Il perd celle de A, garde celle de B. Personne n'est
réduit au silence, chacun ne reprend que ce qu'il avait prêté.

Techniquement, ce n'était pas une contrainte du standard mais une conséquence de notre
premier choix — le standard permet de racheter plusieurs chaînes indépendantes dans le
même appel, ce qu'on fait désormais.
*(Décision détaillée : [ADR 0012](adr/0012-one-delegation-per-voice.md).)*

---

## Ce qu'on n'a pas eu à écrire

La partie la plus révélatrice du projet est ce qui **n'existe pas** dans notre code.

**La révocation.** Aucune ligne écrite. Le standard ERC-7710 la fournit : le délégateur
désactive sa délégation, et toute chaîne qui en dérivait cesse de fonctionner. Notre
contrat n'a pas connaissance de la révocation.

**Le resserrement.** Quand A délègue `treasury` et que B ne transmet que `grants`, C ne
peut pas voter sur `payroll` — pourtant aucune ligne ne l'interdit. Ça découle de la
structure : le contrôle s'exécutant à chaque niveau, un vote doit être valide *pour tous
les niveaux à la fois*. L'intersection produit le resserrement toute seule.

Ces deux propriétés ont été obtenues gratuitement, en s'appuyant sur le standard plutôt
qu'en le contournant.

---

## Les choix qu'on a faits, et pourquoi

| Choix | Alternative écartée | Raison |
|---|---|---|
| Le chemin fourni par le demandeur | Parcours on-chain | Impossible — pas d'index inverse |
| Autorisation par la mise | Par l'existence du lien | Le minting est libre, donc l'existence ne prouve rien |
| Classification précise du lien | Un test grossier disponible | Le test grossier accepte aussi les liens de contestation |
| Une délégation par voix | Une seule chaînée | Sinon reprendre sa voix en fait taire d'autres |
| Bornes lues on-chain | Recopiées côté client | Un garde-fou qu'on peut contredire n'en est plus un |
| Le contrôle par délégation | Une fois par vote | C'est ce qui rend le resserrement automatique |

Chacun est consigné dans un ADR, avec les alternatives et ce qu'elles coûtaient.

---

## Où en est le projet

**Tout tourne en réel sur le testnet Intuition (chaîne 13579).** Rien n'est simulé : les
délégations sont signées, les votes envoyés, le graphe modifié pour de bon.

| | |
|---|---|
| Contrats | 843 lignes de Solidity (hors interfaces), source vérifiée on-chain |
| Tests | 103, dont 12 contre le vrai graphe Intuition |
| Graphe | 17 domaines, 16 liens, chacun misé par le curateur |
| Décisions | 16 ADR |
| Vérification avant démo | `bun run verify` — 5 secondes, lecture seule |

`verify` contrôle chaque affirmation de la démonstration contre l'état réel de la chaîne :
les liens autorisent, les votes attendus passent, et ceux qui doivent échouer échouent pour
la bonne raison.

---

## Ce que ça ouvre

Une DAO décrit déjà son organisation quelque part. L'idée du projet est de faire de cette
description **la source d'autorité** : le périmètre d'une délégation n'est plus une liste à
maintenir, c'est une question posée à l'organisation elle-même.

Ce qui devient possible : une sous-délégation en profondeur, où un délégué de la trésorerie
confie le programme de subventions à quelqu'un de plus proche du terrain, qui confie les
micro-subventions plus bas encore — chaque niveau limité par un graphe que la DAO curate
déjà, chaque niveau révocable séparément.

Le POC en démontre le mécanisme complet, de la signature au vote, sur un vrai réseau.
