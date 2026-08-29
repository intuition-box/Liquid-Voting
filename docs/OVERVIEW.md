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

On a donc partagé le travail en deux. Le navigateur cherche le chemin qui va de
`micro-grants` jusqu'à `treasury` et le joint au vote. Le contrat, lui, ne le croit pas : il
recalcule chaque maillon contre ce que le graphe contient réellement au moment du vote.

Pour chaque maillon, il pose deux questions. D'abord, est-ce que ce lien existe vraiment,
comme affirmation positive ? Ensuite, est-ce que le curateur a misé dessus ? C'est la
deuxième qui empêche la triche, et la section suivante explique pourquoi.

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

La solution a été de signer une délégation par voix portée. B en signe deux vers C : l'une
pour sa voix propre, l'autre pour relayer celle de A. Elles vivent séparément, et c'est ce
qui change tout au moment d'une reprise.

Si A reprend `treasury`, la voix qu'il avait prêtée disparaît, puisqu'elle dépendait de
lui. Celle de B, elle, reste valable, parce qu'elle n'a jamais été à A. Concrètement, C
passe de trois voix à deux : il perd celle de A et garde celle de B. Personne n'est réduit
au silence, et chacun ne reprend que ce qu'il avait prêté.

Techniquement, ce n'était pas une contrainte du standard mais une conséquence de notre
premier choix — le standard permet de racheter plusieurs chaînes indépendantes dans le
même appel, ce qu'on fait désormais.
*(Décision détaillée : [ADR 0012](adr/0012-one-delegation-per-voice.md).)*

---

## Ce qu'on n'a pas eu à écrire

La partie la plus révélatrice du projet est ce qui n'existe pas dans notre code.

La révocation, d'abord. On n'a écrit aucune ligne pour elle, parce que le standard ERC-7710
la fournit déjà : le délégateur désactive sa délégation et toute chaîne qui en dérivait
cesse de fonctionner. Notre contrat, lui, n'a même pas connaissance de la notion.

Le resserrement, ensuite. Quand A délègue `treasury` et que B ne transmet que `grants`, C
ne peut pas voter sur `payroll`, alors qu'aucune ligne ne l'interdit nulle part. Ça découle
de la structure : comme le contrôle s'exécute à chaque niveau, un vote doit être valable
pour tous les niveaux à la fois, et l'intersection produit le resserrement d'elle-même.

Ces deux comportements ont été obtenus gratuitement, en s'appuyant sur le standard plutôt
qu'en le contournant.

---

## Les six choix, et pourquoi

Chacune de ces décisions est arrivée de la même façon : on a d'abord essayé la solution
évidente, elle ne marchait pas, et on a compris pourquoi.

### 1 · C'est le votant qui donne le chemin

La première idée était que le contrat remonte le graphe tout seul, de `micro-grants`
jusqu'à `treasury`. Ça n'a pas été possible, parce que le graphe d'Intuition sait dire si
un lien existe, mais il ne sait pas dire quels sont les enfants d'un nœud. C'est un
annuaire dans lequel on peut vérifier un numéro qu'on connaît déjà, mais où on ne peut pas
chercher qui habite dans une rue. Ce n'est pas une question de lenteur, c'est simplement
impossible.

Alors on a inversé le sens. C'est le votant qui annonce son chemin — micro-grants, puis
builder-grants, puis grants, puis treasury — et le contrat vérifie chaque étape une par
une contre le graphe. Le chemin annoncé ne prouve rien du tout, il indique seulement où
regarder.

### 2 · Il faut avoir misé de l'argent, pas seulement écrit la phrase

On aurait pu accepter n'importe quel lien présent dans le graphe. Le souci, c'est que sur
Intuition écrire une phrase coûte une fraction de centime et que n'importe qui peut écrire
n'importe quoi. Un délégué à qui vous avez confié la trésorerie pourrait publier lui-même
« les événements font partie de la trésorerie », puis voter sur les événements avec votre
voix. Il agrandirait son propre pouvoir sans rien demander à personne.

C'est pour ça qu'un lien ne compte que si le curateur de la DAO a misé de l'argent dessus.
Écrire reste gratuit et ouvert à tous, mais ça ne suffit plus : parler ne coûte rien,
s'engager coûte quelque chose.

### 3 · On vérifie quel type de lien, pas seulement qu'il y en a un

Il existait une fonction toute prête pour savoir si un lien existe, et on a failli s'en
servir. Elle cachait un piège : sur Intuition, on peut publier une affirmation et
publier son contraire. Pour chaque « A fait partie de B », quelqu'un peut enregistrer un
« non, A ne fait pas partie de B ». Or cette fonction répond oui dans les deux cas, parce
qu'elle regarde la famille du lien et pas son sens.

Un attaquant aurait donc pu se servir d'une contestation comme si c'était une
affirmation. On demande maintenant le type exact du lien et on n'accepte que l'affirmation
positive.

### 4 · Une signature par voix transmise

Quand B transmet à C ce que A lui a confié en même temps que sa propre voix, il aurait été
naturel de tout mettre dans un seul document signé. Sauf que ces deux voix n'appartiennent
pas à la même personne. Si A reprend la sienne, il détruit le document entier, et C perd
au passage la voix de B — que A n'avait pourtant aucun droit de reprendre. C'est comme si,
en récupérant un livre que vous aviez prêté, vous emportiez aussi celui que votre ami avait
offert à quelqu'un d'autre.

B signe donc deux documents séparés. A peut reprendre le sien, l'autre reste valable, et C
garde ce que B lui a donné.

### 5 · Les limites de sécurité restent dans le contrat

Le contrat refuse les chemins de plus de six étapes, et on aurait pu recopier ce six dans
l'application pour éviter d'envoyer des transactions vouées à l'échec. On ne l'a pas fait,
parce que deux copies d'un même chiffre finissent toujours par diverger, et surtout parce
qu'une limite de sécurité que le client peut contredire n'est plus une limite mais une
suggestion.

Le chiffre reste donc uniquement dans le contrat. L'application le lit pour vous éviter de
payer une transaction perdue d'avance, mais c'est toujours le contrat qui tranche. Si on
change la limite dans le contrat, l'application suit d'elle-même.

### 6 · Chaque maillon est vérifié séparément

On aurait pu contrôler le vote une seule fois, à son arrivée. On a préféré vérifier chaque
niveau de la chaîne indépendamment, et c'est ce qui a produit le résultat dont on est le
plus contents.

A a délégué `treasury` à B, et B n'a transmis que `grants` à C. Quand C vote, son vote doit
être valable pour les deux niveaux à la fois. Sur `payroll`, qui appartient à `treasury`
mais pas à `grants`, le niveau de B refuse — donc C ne peut pas voter dessus. Personne n'a
écrit cette règle nulle part : elle apparaît d'elle-même parce qu'on vérifie niveau par
niveau. La bonne structure a rendu inutile d'écrire la règle.

---

Chacun de ces six choix a son document dédié dans [`adr/`](adr/), avec les alternatives
qu'on a essayées et ce qu'elles coûtaient.

## Où en est le projet

Tout tourne en réel sur le testnet Intuition, et rien n'est simulé : les délégations sont
signées pour de bon, les votes partent sur la chaîne, et le graphe est modifié réellement
quand on ajoute un domaine pendant la démonstration.

Les contrats sont déployés avec leur code source vérifié, la suite de tests tourne en
partie contre le vrai graphe d'Intuition plutôt que contre une imitation, et chaque
décision d'architecture a son document dans [`adr/`](adr/).

Avant chaque présentation, une commande de cinq secondes — `bun run verify` — relit l'état
de la chaîne et contrôle chaque affirmation de la démonstration : que les liens autorisent
bien ce qu'on annonce, que les votes attendus passent, et que ceux qui doivent échouer
échouent pour la bonne raison plutôt que par accident.

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
