# Plan de différenciation d’Adarma

Date : 6 octobre 2026. Document de conception proposé, sans modification du jeu.

## Objectif et limites

Faire d’Adarma un jeu de stratégie autonome : mondes personnalisables, guerres de villages et alliances, outils de gestion accessibles à tous, modes ayant leurs propres règles. Conserver le moteur développé indépendamment et les créations graphiques dont la provenance est établie.

L’objectif est une différenciation réelle et documentée, pas une dissimulation de l’inspiration. Aucun nombre de changements ni pourcentage de différence ne garantit une absence de litige. Ce document n’établit pas que les éléments repérés sont juridiquement protégés : il identifie les reprises à examiner et propose des changements de conception.

Périmètre examiné : README, définitions des bâtiments et unités, formules, combat, configuration des mondes, conquête, factions, catalogue commercial, styles et organisation de l’interface, inventaire des tests. Aucune comparaison visuelle exhaustive avec Guerre Tribale ni vérification exhaustive des licences des assets n’a été réalisée.

## Constats dans le dépôt

| Domaine | Constat | Priorité de conception |
| --- | --- | --- |
| Économie | `src/game/data/buildings.js` reprend les valeurs de `get_building_info` : coûts, facteurs, niveaux et prérequis | Haute |
| Armées | `src/game/data/units.js` reprend coûts, statistiques, vitesses et recherches | Haute |
| Formules | `src/game/formulas.js` reprend constantes précises et table des marchands | Haute |
| Combat | `src/game/combat.js` documente les formules du wiki : muraille, morale, pertes, espionnage | Haute |
| Conquête | `src/services/NobleService.js` et le README décrivent pièces triangulaires, nobles consommés et réduction de loyauté | Haute |
| Modules | Collecte à quatre options, sceaux/drapeaux, paladin, foi et villages de runes reprennent des mécanismes documentés | À revoir ou différer |
| Interface | Plusieurs pages sont explicitement organisées d’après le jeu de référence ; certaines descriptions visibles le citent | Moyenne, avec nettoyage éditorial immédiat possible |
| Monétisation | `src/game/shopCatalog.js` réserve files supplémentaires, assistant de pillage et gestionnaire au premium ; les prix sont explicitement calés sur GT | Haute pour respecter la promesse d’équité |
| Factions | `src/game/factions.js` distingue les équipes et apparences, mais conserve les mêmes unités et bâtiments | Base utile pour un futur mode, pas encore un système différent |
| Mondes fantasy | `scripts/seed.js` contient des noms LOTR | Retirer ces noms du produit et vérifier l’identité des contenus concernés |

Le moteur daté, les transactions, les commandes, les comptes, les forums, la messagerie et l’architecture par mondes restent des bases réutilisables. L’existence d’une fonctionnalité similaire ailleurs ne justifie pas, à elle seule, sa suppression.

## Direction proposée

Positionnement : « Adarma, un jeu de stratégie de villages et d’alliances où chaque communauté compose sa campagne et où tous les joueurs disposent des mêmes outils compétitifs. »

Trois piliers :

1. Équité : mêmes files, mêmes automatisations et mêmes informations de jeu pour les joueurs payants et gratuits.
2. Campagnes configurables : choix de rythme, durée, protection nocturne et victoire dans les serveurs privés, à partir de règles Adarma.
3. Expansion disputée : conquête par occupation progressive et victoire par objectifs territoriaux, plutôt qu’une reproduction du parcours nobles/loyauté.

Le troisième pilier est une proposition à prototyper, pas une mécanique déjà disponible ni une preuve d’originalité juridique. Éviter d’ajouter simultanément cinq systèmes complexes : une campagne cohérente vaut mieux qu’une accumulation de modules.

## Lot 0 — Établir les preuves et figer le périmètre

- Inventorier les tableaux et paramètres repris, avec leur source et leur usage actuel.
- Consigner la collecte par URL publiques sans connexion : dates, URL et scripts disponibles. Ne pas effacer les fichiers de recherche ou l’historique Git pour masquer cette origine.
- Séparer les documents de recherche du contenu livré : vérifier les routes statiques et scripts de déploiement pour que `research/raw` ne soit pas publié par inadvertance.
- Établir un registre de provenance des images, polices, textes et dépendances ; distinguer preuves disponibles et provenance encore à vérifier.
- Identifier les mondes et éventuels droits premium existants avant de décider leur transition.

Livrable : inventaire des reprises et registre de provenance. Vérification juridique de la collecte et des droits revendicables par un conseil compétent.

## Lot 1 — Identité et modèle économique

Réécrire les descriptions visibles dans `src/game/serverSettings.js`, `src/web/gameStyles.js`, `src/web/gameLayouts.js`, `src/views/incomings.ejs` et les pages publiques autour du comportement d’Adarma. Conserver dans la documentation interne une description exacte de l’inspiration et des changements réalisés. Un changement de texte réduit l’association commerciale ; il ne modifie pas la licéité des paramètres.

Remplacer les noms des mondes LOTR par des noms propres à Adarma, sans supprimer le concept générique de factions fantasy. Vérifier la disponibilité du nom et du logo Adarma avant leur protection ou un lancement commercial.

Rendre les outils compétitifs accessibles à tous : file de construction identique, gestionnaire, modèles, routes commerciales, alertes, assistant de pillage et accès aux informations conservées. Des limites techniques communes restent possibles. Audit nécessaire des contrôles premium dans services et routes : modifier seulement le catalogue ne suffit pas.

Conserver éventuellement des cosmétiques payants et une offre d’hébergement de serveurs privés, avec règles équitables à l’intérieur de chaque monde. Recalculer les prix selon les coûts et le produit ; arrêter de prendre le tarif concurrent comme référence. Si des droits ont déjà été vendus, préparer un traitement explicite des engagements avant modification.

Acceptation : deux comptes avec des droits commerciaux différents disposent des mêmes possibilités compétitives sur un même monde ; descriptions commerciales et contrôles serveur concordent.

## Lot 2 — Versionner les règles avant de changer les valeurs

Introduire un profil immuable de règles pour chaque monde, par exemple `rulesetVersion: 'adarma-v1'`. Le nom est indicatif. Aujourd’hui les définitions d’unités et bâtiments sont globales : le réglage de monde ne suffit pas pour isoler un nouvel équilibrage.

Adapter les accès du registre, les calculs et les services pour utiliser le profil du monde. Auditer les usages directs de `registry` dans combat, points, files, recrutement, simulation, rapports, bots et interface. Un combat ne doit pas utiliser les statistiques d’un autre profil.

Les mondes en cours ne changent pas de règles silencieusement : ordres datés, ressources, armées et attentes des joueurs seraient affectés. Décider selon leur état entre fin de monde, réinitialisation annoncée ou migration calculée. Un ancien profil éventuellement conservé temporairement exige son propre examen juridique ; ce n’est pas une solution au risque de reprise. Ne pas ouvrir de nouveaux mondes avec ce profil par défaut.

Acceptation : profils distincts isolés ; calculs à la création et à l’exécution des commandes cohérents ; profil publié avec les réglages du monde.

## Lot 3 — Concevoir l’économie et l’armée Adarma

Commencer par les objectifs, puis calculer les chiffres. Hypothèses de prototype à mesurer : nombre de sessions quotidiennes attendu, temps jusqu’à une première armée viable, délai d’expansion, durée de campagne et effort nécessaire pour gérer plusieurs villages. Aucun chiffre cible n’est présenté ici comme validé.

### Économie

- Conserver bois, argile et fer si cela sert le jeu ; une ressource générique n’a pas besoin d’être renommée pour paraître différente.
- Définir une courbe de rendement et de coût à partir du retour sur investissement souhaité à chaque stade.
- Déduire niveaux maximaux et prérequis du parcours de progression. Ne pas remplacer seulement 30 par 29.
- Donner un rôle distinct aux bâtiments économiques, militaires et administratifs ; tester une spécialisation limitée des villages avant d’en généraliser la mécanique.
- Remplacer la table copiée des marchands par une capacité logistique issue d’une formule conçue pour Adarma ; fixer séparément disponibilité, vitesse et coût éventuel.

### Armée et combat

- Partir d’un ensemble réduit de rôles lisibles : tenue de position, assaut, mobilité, reconnaissance et siège.
- Déterminer coût, population, durée et efficacité par rôle et contre-rôle. Éviter une copie proportionnelle des statistiques actuelles.
- Reconcevoir les pertes et le rôle des fortifications autour de ces choix ; conserver des calculs déterministes ou un aléa limité seulement si les tests le justifient.
- Concevoir une protection des débutants compréhensible plutôt que reconduire la formule exacte de morale.
- Définir l’espionnage selon des objectifs d’information propres au jeu, sans reconduire automatiquement les seuils de survivants.

Livrables : spécification, tableaux obtenus, simulateur et journal des arbitrages. Mesurer production cumulative, coût d’expansion, efficacité militaire par ressource et population, effet des soutiens, efficacité du pillage et stratégies dominantes. Un équilibrage n’est pas validé seulement parce que les chiffres diffèrent.

## Lot 4 — Une conquête propre, puis une victoire propre

Proposition : occupation après victoire militaire, nécessitant une garnison et une durée publique avant transfert de propriété. Le défenseur et ses alliés peuvent interrompre l’occupation. La capacité d’administrer de nouveaux villages progresse selon un système conçu pour Adarma, sans pièces triangulaires ni noble consommé.

Avant implementation, préciser : conditions de début, délais, ressources, sorties de garnison, attaques multiples, changement de propriétaire, abandon, déconnexion, frontière de monde et traitement des files. Étudier les risques de blocage permanent, de capture instantanée en chaîne et de domination des comptes très actifs.

Fichiers concernés : `NobleService`, `CommandService`, modèles de village/commande et migrations, rapports, carte, notifications, tutoriel et bots. Ajouter un état d’occupation explicite plutôt que déguiser une simple réduction de loyauté.

Victoire proposée : objectifs territoriaux annoncés dès l’ouverture de campagne, score acquis dans le temps et durée maximale définie. Étudier la concentration géographique et le rattrapage des alliances ; éviter de reconstituer exactement les villages de rune avec un autre nom.

Acceptation : scénarios de capture, libération, soutiens, arrivées simultanées et fin de monde reproduits de manière déterministe. Les joueurs comprennent quand et pourquoi un village peut changer de propriétaire.

## Lot 5 — Recentrer les modules et les écrans

Pour la première campagne Adarma, différer ou désactiver les modules fortement repris qui ne sont pas nécessaires : paladin et arbre d’objets/compétences, collecte à quatre options, sceaux, foi et runes. Examiner les données existantes avant désactivation. Développer ensuite chaque module selon un objectif propre ; pas de simple renommage drapeaux → sceaux.

Conserver les expéditions comme concept si utile, mais prototyper des missions avec destination, durée et choix logistique propres. Réserver les différences de factions à un mode ultérieur testé : elles sont aujourd’hui surtout des équipes et apparences.

Organiser les écrans autour des tâches Adarma : cité et développement ; opérations et occupations ; territoire et objectifs ; alliance et coopération. Réutiliser tableaux, filtres, forums et composants accessibles. Les repères usuels restent utiles. Comparer visuellement les écrans principaux pour identifier les compositions effectivement proches : l’audit de commentaires ne remplace pas cette comparaison.

Acceptation : parcours complet sur ordinateur et mobile, lecture claire des règles nouvelles, absence de références commerciales inutiles au concurrent.

## Ordre et validation

1. Inventaire/provenance et décisions de produit.
2. Identité, équité et versionnement des règles.
3. Simulation de l’économie et du combat ; validation du prototype.
4. Nouvelle conquête et victoire, avec leurs écrans.
5. Campagne fermée utilisant des données Adarma ; ajustements et audit final.

Ne pas lancer tous les modes en parallèle. Le mode initial doit intégrer l’équilibrage propre et la conquête retenue ; un mode identique ancien ne doit pas rester le produit principal sous prétexte que de futurs modes sont différents.

Tests à adapter : `formulas`, `combat`, `build-queue`, `commands`, `nobles`, `victory`, `private-servers`, `bots`, `farm`, `account-manager` et tests HTTP des droits. Conserver les invariants (transactions, conservation des troupes et ressources, chronologie) ; remplacer les assertions spécifiques aux anciennes valeurs par des scénarios de règles Adarma. Vérifier interface et communication sur la version réellement livrée.

Avant ouverture publique : vérifier les sources, comparer la version finale, examiner les CGU éventuellement acceptées et les modalités de collecte avec un avocat. Un nom disponible et une communication indépendante ne règlent pas à eux seuls les droits sur les contenus ou le parasitisme.

## Sources juridiques de cadrage

- CGU directement liées par Guerre Tribale, version affichée du 10 juin 2025 : https://legal.innogames.com/staemme/fr_FR/agb
- Règles du jeu : https://www.guerretribale.fr/page/rules
- Politique de contenus de fans, ne couvrant pas un jeu concurrent : https://www.innogames.com/support/fan-content-guideline/
- CJUE, SAS Institute, C-406/10, fonctionnalités et expression du logiciel : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX%3A62010CJ0406
- Cour de cassation, 26 juin 2024, n° 23-13.535, reprise de concepts et critères du parasitisme : https://www.courdecassation.fr/decision/667baef8eee23a0a3f11d248

Ces sources fournissent un cadre ; aucune n’évalue Adarma ni n’établit un seuil de différenciation suffisant.
