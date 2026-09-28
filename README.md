# GTLike

Jeu de stratégie par navigateur et par mondes, inspiré de Guerre Tribale.
Stack : Node.js, Express, Sequelize (SQLite en dev, PostgreSQL via `DATABASE_URL`), vues EJS, Tailwind CSS v4.

```bash
npm install
npm run dev        # http://localhost:3000 : serveur + Tailwind en mode watch
npm start          # compile le CSS puis lance le serveur
npm test
npm run migrate    # applique les migrations (obligatoire en production)
npm run migrate -- status | down | create nom-de-la-migration
npm run populate   # monde « speed » : 1000 joueurs fictifs, tribus, barbares (-- <monde> <nombre> [--reset])
```

Le style est uniquement en Tailwind, sans CSS maison : [src/styles/app.css](src/styles/app.css) ne contient que
la configuration (`@theme` : palette et polices de la maquette `maquettes/GTLike.html`), et les
composants (panneaux, boutons, onglets, médaillons…) sont des chaînes de classes dans [src/web/ui.js](src/web/ui.js).
Le CSS compilé (`public/css/app.css`) n'est pas versionné : `npm start` le recompile (Tailwind est en
devDependencies, installer donc aussi les dépendances de développement pour construire).

Deux mondes sont créés au premier lancement (voir [scripts/seed.js](scripts/seed.js)) : `w1` (vitesse 1, classique)
et `speed` (vitesse 100, tous les modules, pour tester vite).
`npm run populate` remplit un monde de test comme une vraie partie ([scripts/populate.js](scripts/populate.js)) :
joueurs de 1 à ~40 villages (bâtiments, troupes et ressources cohérents), ~65 % en tribu avec diplomatie, villages barbares.
Comptes fictifs : `<nom>@bots.gtlike.local`, mot de passe `motdepasse` (connexion avec le nom du joueur).

## Organisation

```
src/game/            Règles du jeu, sans base de données
  data/buildings.js  19 bâtiments (coûts, facteurs, niveaux max, pop, prérequis)
  data/units.js      12 unités (coûts, stats, vitesse, bâtiment, prérequis)
  formulas.js        Production, entrepôt, ferme, cachette, temps de construction et de recrutement
  WorldConfig.js     Configuration d'un monde (vitesse, modules, file, placement…)
  BuildingType.js    Un type de bâtiment : coût/pop/temps/points à un niveau donné
  UnitType.js        Un type d'unité : coût, temps de recrutement, vitesse
  VillageState.js    État d'un village : ressources calculées à la lecture, application des files
  MapPlacer.js       Placement des nouveaux villages (depuis le centre, par direction)
  terrain.js         Terrain déterministe (eau, forêts, lacs, montagnes), partagé avec la carte du navigateur ;
                     pas de village sur l'eau, les lacs, les montagnes ni au cœur des forêts
  combat.js          Résolution d'un combat : muraille, béliers, catapultes, chance, morale, nuit, éclaireurs, pillage
  movement.js        Distance et durée de trajet (unité la plus lente)
  barbarian.js       Croissance des villages barbares
  scavenging.js      Collecte : capacité, durée, butin
  registry.js        Accès aux types de bâtiments et d'unités
src/models/          Modèles Sequelize : User, World, Player, Village, BuildOrder, RecruitOrder,
                     Command (troupes en mouvement), SupportStack (soutiens stationnés), Report
src/services/        Logique applicative (transactions) : Auth, Account, Sitter, World, Village, Command, Noble,
                     Trade, Tribe, Message, Report, Knight, KnightSkill, Achievement, Daily, Scavenge, Victory,
                     Event (arrivées de troupes et de marchands dans l'ordre), Map, GameLoop
src/migrator.js      Migrations Umzug (dossier migrations/, table SequelizeMeta comme sequelize-cli)
migrations/          Une migration par changement de schéma ; ne jamais modifier une migration déjà appliquée
src/styles/          Point d'entrée Tailwind (@theme) et styles de jeu (game-styles/ : romain, viking)
src/web/             Routes Express, middlewares, helpers de vue, composants (ui.js), styles de jeu (gameStyles.js)
src/views/           Pages EJS
public/              JS client (game.js : ressources, comptes à rebours… ; map.js : carte ; minimap.js : rendu commun des mini-cartes), images (accueil, fonds de village par style)
maquettes/           Maquette de référence de l'interface (bundle HTML autonome)
```

## Interface

Organisation reprise de Guerre Tribale, habillage de la maquette `maquettes/GTLike.html` (style « BD » : encre
noire, rouge sang et bronze, aplats et ombres portées, polices Marcellus (titres), Cinzel (logo) et Barlow Semi Condensed ; casse normale et graisses moyennes, capitales réservées aux tags). En-tête collant :
menu principal (Aperçu, Carte, Rapports, Messages, Tribu, Classement, Profil ; joueur et rang, fin du monde, compte,
déconnexion), puis barre du village (changement de village, attaques entrantes, barre rapide des bâtiments favoris — étoile sur le plan du village, au quartier général et sur chaque page de bâtiment ; par défaut les bâtiments construits,
ressources, entrepôt, population).
L'aperçu reprend la vue de la cité : barre de titre (coordonnées, continent, points, population, loyauté), plan vu de
dessus avec les bâtiments en blocs (niveau, nom, compte à rebours des chantiers ; QG et bâtiments militaires dans
l'enceinte, mines et ferme aux abords, muraille sur la porte sud) ou vue liste, tableau des mouvements de troupes,
et les encadrés Production, Constructions, Recrutement, Troupes et Paladin. La carte ([public/js/map.js](public/js/map.js)) a des cases de
taille fixe comme sur GT (la taille choisie agrandit vraiment la carte), charge les villages par secteurs de 20 × 20
(`/map/sector`, [src/web/mapView.js](src/web/mapView.js)) et se déplace sans rechargement (glisser, flèches, clavier,
mini-carte de 6 px par case qui suit la vue). Mini-carte, fenêtre « Carte du monde » et mini-carte du profil
sont dessinées par un seul module ([public/js/minimap.js](public/js/minimap.js)) avec les jetons `--color-mini-*` de
[src/styles/app.css](src/styles/app.css) (légendes : `bg-mini-*`) : les modifier change les trois ; décor, flèches d'attaque et légende. L'accueil (mondes, connexion, inscription)
reprend l'écran d'accueil de la maquette.

Outils de la maquette : menu « Rapports » de l'en-tête (non-lus par catégorie) ; sur le plan du village, le survol
d'un bâtiment affiche son encart (coût et durée du niveau suivant, bouton Améliorer), un clic ouvre sa page ; notifications
en haut à droite. Sur la carte : infobulle au survol (dont la durée du trajet de chaque unité), actions rapides au clic sur un village d'un autre joueur, en cercle autour de la case comme sur GT
(envoyer des troupes, profil, message, favoris, ressources ; menu pour ses propres villages), calques (marquages, influence de la tribu, zones ennemies,
barbares, quadrillage de 5 cases, frontières de continent) et tailles (carte 4×4 à 30×30, mini-carte 20×20 à 120×120) mémorisés
sur le joueur, marquages de couleur par joueur, tribu ou village (menu d'un village, profil, panneau « Marquages »), recherche (joueur, village, tribu, coordonnées), favoris
et « Ordres rapides » (modèles d'armée créés au point de ralliement, qui pré-remplissent l'envoi). Pages publiques :
règles (`/rules`), aide (`/help`), infos de chaque monde (`/worlds/:slug/info`) ; en jeu, « Inviter des joueurs ».
Morale (3 × points du défenseur ÷ points de l'attaquant + 30 %, entre 30 et 100 %) : affichée au survol et dans le
menu d'un village sur la carte, sur la page du village et avant chaque attaque.

Forum communautaire (`/forum`), commun à tous les mondes : sections (Taverne, Stratégie, Tribus, Suggestions, Bugs),
sujets et réponses paginés, lecture publique, écriture pour les comptes connectés (15 s minimum entre deux messages).
Chacun modifie ou supprime ses messages ; le premier message ne part qu'avec le sujet, tant qu'il n'a pas de réponse.
Un compte supprimé laisse ses messages, signés « Compte supprimé ». Il n'y a pas encore de rôle de modérateur.

Forum de tribu (onglet « Forum » de la page Tribu), réservé aux membres, agencé comme celui de Guerre Tribale :
rangée des sous-forums (par défaut Annonces, Attaque, Défense, Taverne, Vacances, Suggestions, créés avec la tribu),
encadré « Nouveaux messages du forum » (5 par page, forums en sourdine exclus au choix), titre du sous-forum avec
« Marquer le forum comme lu », « Marquer tous les forums comme lus » et « Ignorer le forum » (sourdine), boutons
Nouveau sujet et Créer un sondage, recherche (titres et messages), tableau Sujets · Auteur · Dernier message ·
Réponses. Sondages : 2 à 10 réponses, un vote par membre, modifiable. Les chefs gèrent les sous-forums (« Réglages du
forum »), épinglent, verrouillent et suppriment n'importe quel message. Les sujets non lus alimentent la pastille de
l'onglet Tribu. Un joueur qui quitte le monde laisse ses messages ; la dissolution de la tribu efface son forum.

Mot de passe oublié : lien à usage unique valable une heure (seul le haché du jeton est stocké). Aucun serveur
d'envoi n'est configuré : [src/services/Mailer.js](src/services/Mailer.js) écrit les e-mails dans les logs du
serveur ; brancher un vrai transport avant la production. Le classement et la fin du monde restent dans l'interface du jeu.

Thèmes de jeu : l'intérieur du jeu (pas la page d'accueil) change d'habillage selon le thème choisi dans
Compte → Thème de jeu (médiéval par défaut : clair, aux couleurs de Guerre Tribale ; romain, viking ; gratuits).
Style de jeu (Compte → Style de jeu, `src/web/gameLayouts.js`) : normal, ou minimaliste (encarts serrés et en-têtes fins
à la Guerre Tribale, contenu limité à 1120 px), quel que soit le thème. En minimaliste, `<html data-game-layout="minimal">`
réduit l'échelle d'espacement de Tailwind (`--spacing`) et active la variante `minimal:` (voir `src/styles/app.css`).
Design des villages (Compte → Design des villages) : un skin pour ses propres villages sur la carte, vu par tous les
joueurs (beige par défaut, blanc et bleu, noir ; gratuits ; les barbares restent beiges) : voir
[src/web/villageDesigns.js](src/web/villageDesigns.js). Voir [src/styles/game-styles/README.md](src/styles/game-styles/README.md).
Quartier général agencé comme sur GT : onglets Construction et Démolition, file en cours (durée, achèvement, annulation ;
« Terminer » gratuit sous `freeFinishSeconds`, 3 min), tableau des bâtiments avec leurs besoins (bois, argile, fer, durée,
population) et l'heure à laquelle les ressources seront disponibles. Démolition : un niveau à la fois, gratuite et sans
remboursement, dans la file de construction ; QG niveau `demolishMainLevel` (15) et loyauté à 100 %.
Chaque bâtiment a sa page avec un en-tête commun (statistique au niveau actuel et au suivant) ; les bâtiments
sans action propre ont une page d'information avec les niveaux suivants. Le point de ralliement est en onglets
(Commandes, Troupes, Simulateur de combat, Collecte) ; caserne, écurie et atelier ont un onglet Désaffectation.
À l'envoi de troupes, l'heure d'arrivée s'affiche en direct à côté de la cible (unité la plus lente choisie).

## Principes

- **Un moteur, une config par monde** : tout ce qui change d'un serveur à l'autre est dans `World.config`
  (lu par `WorldConfig`). Ajouter un monde = une ligne en base.
- **Pas de tick global** : les ressources sont stockées avec leur date et calculées à la lecture.
  Les constructions et recrutements sont des ordres datés ; `VillageService.refresh` les applique
  dans l'ordre chronologique (une mine terminée change la production à partir de sa fin).
  `GameLoop` traite en plus les ordres échus toutes les 5 s pour garder points et carte à jour.
- **Mouvements de troupes** : `CommandService.processDue` traite les arrivées dans l'ordre chronologique,
  avant tout affichage de page et à chaque tour de boucle. Un combat se calcule sur l'état du village
  cible à l'instant de l'arrivée. Les troupes en route ou en soutien comptent dans la ferme de leur village.
- **Tout dépend des niveaux** : temps de construction selon le QG (formule v2 : `1.18 × facteur^max(-13, n-1-14/(n-1)) × 1.05^-QG`),
  recrutement selon la caserne/écurie/atelier (`× 1.06^-niveau`), production selon la mine,
  stockage selon l'entrepôt, population selon la ferme.
- **Exports publics** comme sur GT : `/worlds/:slug/map/village.txt`, `/map/player.txt`, `/config.json`.

## Combat

Formules vérifiées sur le wiki officiel : défense de base `(20 + 50 × muraille) × 1.037^muraille`,
défense pondérée par la part infanterie/cavalerie/archers de l'attaque, pertes `(perdant / gagnant)^1.5`,
chance ±25 %, morale `3 × pts défenseur / pts attaquant + 0.3` (30 à 100 %), bonus de nuit, éclaireurs
(1 survivant : troupes, 50 % : ressources, 70 % : bâtiments), béliers avant le combat (au plus la moitié du mur).

À calibrer : `RAM_DIVISOR` et `CATAPULT_DIVISOR` dans [src/game/combat.js](src/game/combat.js),
et les pertes des éclaireurs.

## Nobles

- Académie : on frappe des pièces d'or (28 000 / 30 000 / 25 000). Le n-ième emplacement de noble coûte
  n pièces de plus (1, 3, 6, 10… au total) ; chaque village conquis garde son emplacement.
- Portée maximale : `snob.maxDistance` (70 cases par défaut).
- Chaque attaque gagnante avec un noble survivant baisse la loyauté de 20 à 35 ; elle remonte de 1/h × vitesse.
- À 0 : le village change de propriétaire (loyauté 25), le noble est consommé, les troupes restantes restent
  sur place en soutien. Les files du village, ses troupes, marchands et collecteurs à l'extérieur sont perdus.
- Une attaque qui arrive sur un village déjà conquis par l'attaquant devient un soutien (train de nobles).
- Un joueur qui a perdu tous ses villages peut recommencer depuis la page des mondes.

## Marché

- Marchands selon le niveau du marché (1 au niveau 1 … 235 au niveau 25), 1 000 ressources chacun,
  6 min/case à vitesse 1 (`market.merchantSpeed`). Ils sont occupés à l'aller et au retour.
- Envoi direct vers n'importe quel village de joueur ; à la livraison, l'excédent au-delà de l'entrepôt est perdu.
- Offres : lots « X contre Y », rapport maximal `1:market.maxRatio` (3). Ressources et marchands réservés
  à la publication, rendus au retrait. Accepter une offre envoie les marchands des deux côtés.
- Les livraisons et les mouvements de troupes sont traités dans un seul ordre chronologique.

## Tribus

- Fondation (nom et tag uniques par monde), invitations, rôles fondateur / chef / membre,
  exclusion selon le rang, passation du rôle de fondateur, dissolution au départ du dernier membre.
- Limite de membres `tribe.memberLimit` (25). `tribe.noHarm` (par défaut) : pas d'attaque entre membres.
  `tribe.supportOnlyTribe` : soutien réservé à ses villages, à sa tribu et aux tribus alliées.
- Diplomatie à sens unique (allié, PNA, ennemi), visible sur la carte et le profil de la tribu.
- Description, mur de messages interne, classement des tribus, export public `/worlds/:slug/map/ally.txt`.

## Villages barbares, messagerie, profils

- À chaque inscription, `placement.emptyVillages` % de villages barbares apparaissent autour du nouveau joueur
  (comme `coord.empty_villages` de GT : 170 = 1 barbare + 70 % de chances d'un 2ᵉ ; 100 par défaut, réglable par monde).
- Les villages barbares gagnent `barbarian.growthPerDay × vitesse` points par jour (40 par défaut),
  en montant surtout leurs mines, jusqu'à `barbarian.maxPoints` (1 500). La croissance est calculée
  au rafraîchissement du village ; la boucle de jeu les rafraîchit toutes les 10 minutes.
- Renommer un village depuis son aperçu.
- Messagerie privée : conversations jusqu'à 10 destinataires, réponses, non-lus, départ d'une conversation.
- Profil de chaque joueur, agencé comme sur Guerre Tribale : mini-carte de ses villages, fiche (points, rang,
  adversaires vaincus, tribu), actions (message, carte, invitation en tribu), villages par ordre alphabétique,
  texte personnel modifiable, succès par catégorie. Noms et tags sont cliquables partout dans le jeu.

## Recherche à la forge

Système de recherche simple (`tech: 'simple'`, par défaut) : chaque unité se recherche une fois par village,
une recherche à la fois. Coûts du wiki officiel (hache 700/840/820, cav. légère 2 200/2 400/2 000…) ;
lancier et porte-épée sans recherche ; la hache demande la forge 2. Durée divisée par 1.1^niveau de forge
(facteurs du wiki) ; la durée de base, non publiée, est estimée à 1,5 s par ressource du coût.
`tech: 'none'` rend toutes les unités disponibles sans recherche.

## Sécurité et base de données

- Protection CSRF : jeton par session, vérifié sur tous les POST (`src/web/csrf.js`), en plus des cookies `sameSite=lax`.
- Migrations : en dev elles s'appliquent au démarrage ; en production le serveur refuse de démarrer
  s'il en reste en attente. La migration initiale reprend aussi les bases créées avant les migrations.

## Compte : rapports, sommeil, vacances, paladin

- Rapports : filtres (attaques, défenses, soutiens, commerce), pagination par 50, sélection multiple
  (marquer lus / non lus, supprimer), « tout marquer comme lu », suppression depuis un rapport.
- Mode sommeil (`sleep.active`, mondes speed) : délai d'activation, durée min/max, éveil minimal entre deux
  sommeils. Les attaques qui arrivent pendant le sommeil deviennent des visites ; un joueur endormi ne peut pas attaquer.
- Mode vacances (`sitter`) : un joueur désigne un remplaçant du même monde, qui accepte puis joue ses villages
  (bandeau visible). Le remplaçant ne peut ni modifier les réglages du compte ni quitter la tribu ;
  `sitter.maxAccounts` comptes remplacés au plus, et pas pendant qu'on est soi-même remplacé.
- Paladin (module `features.knight`) : un seul par joueur, recruté à la statue ; les soutiens qu'il accompagne
  (et leur retour) avancent à sa vitesse.
- Armes du paladin (`knightItems`, 11 armes du wiki) : jauge de 3 %/jour × vitesse depuis la statue, plus
  1 % par 100 points d'adversaires vaincus ; arme au hasard à 100 % si un paladin a déjà été recruté.
  Bonus +30 % attaque / +20 % défense d'une unité, béliers ou catapultes ×2, longue-vue = éclaireur,
  sceptre = loyauté −30 minimum. L'arme agit quand le paladin accompagne l'attaque ou défend.

## Paladin à compétences (`knightSystem: 'skills'`)

Système de 2016 (wiki DS) : un paladin par village, jusqu'à 10 selon le nombre de villages (1 : 1, 3 : 2,
5 : 3, 10 : 4… 100 : 10). Niveaux 1 à 30, un livre de compétence par niveau ; 12 compétences à 4 paliers
(niveaux 1 / 8 / 16 / 24) en trois branches : offensive (hache, cavalerie légère, catapultes, béliers, quand
il accompagne l'attaque), village (production, construction, recrutement, persuasion des nobles, quand il est
chez lui), défensive (épée, lance, fortification, huile bouillante, quand il défend). Plusieurs paladins avec la
même compétence : seul le meilleur palier compte. Expérience : défenseurs tués en attaque, attaquants tués en
défense ou en soutien, constructions terminées en sa présence. Mort au combat : on le ressuscite à la statue de
son village (il garde niveau et compétences). Réinitialisation gratuite (pas de premium).
Formation (`knightTraining`) : 2 h / 8 h / 24 h ÷ vitesse contre des ressources ; le paladin quitte son village
(ni combat ni bonus, mais toujours compté dans la ferme) et revient avec l'expérience du programme.
Déménagement : vers un autre village du joueur avec statue, sans paladin et avec 10 places de ferme libres ;
il voyage à sa vitesse et change de village d'attache à l'arrivée (demi-tour si la destination n'est plus valable).
À calibrer : courbe d'expérience `1000 × (niveau − 1)²`, expérience des constructions (coût ÷ 10), programmes
de formation. Monde de test : `skills` (vitesse 100).

## Succès et classements

22 succès du wiki (points, rang, continent, pillage, conquêtes, unités tuées, béliers et catapultes, soutiens,
espionnage, marché, pièces d'or, tribu, armes du paladin…) à 4 paliers : bois 1, bronze 2, argent 3, or 4 points.
Un palier débloqué n'est jamais retiré et génère un rapport.
Succès quotidiens (pillard, attaquant, défenseur, soutien, grande puissance, brigand du jour) : attribués pour chaque
journée terminée (heure du serveur) au gagnant unique, 4 points chacun ; les unités attaquantes tuées se partagent
entre le village et ses soutiens au prorata de la population présente. Classements : joueurs, tribus, continents (points
des villages situés dans le continent), adversaires vaincus, succès ; comme sur GT, types dans un menu à gauche,
pages de 25 ouvertes sur la position du joueur (ou de sa tribu), « Aller à » un rang ou un nom, points par village.

## Adversaires vaincus

Points par unité tuée selon le wiki DS (ex. lancier 4 pour l'attaquant qui le tue, 1 pour le défenseur ;
cavalerie légère 5 / 13 ; noble 200 / 200). ODA pour l'attaquant ; les points de défense sont partagés entre
le village et ses soutiens au prorata de la population présente (ODD pour le propriétaire, ODS pour les autres).
Classement « Adversaires vaincus » et exports `/worlds/:slug/map/kill_att.txt`, `kill_def.txt`, `kill_sup.txt`, `kill_all.txt`.

## Quitter un monde, supprimer son compte

Mot de passe requis. Les villages redeviennent barbares (avec leurs troupes) ; files, troupes et marchands à
l'extérieur, offres, rapports et invitations sont supprimés ; la tribu passe au meilleur chef (ou est dissoute).
Les messages déjà envoyés restent visibles, signés « Joueur supprimé ».

## Collecte

Quatre options (Collecteurs paresseux, modestes, astucieux, Grands collecteurs) qui rapportent 10 / 25 / 50 / 75 %
de la capacité de transport des troupes envoyées, réparti entre bois, argile et fer. Durée (formule de la communauté) :
`((capacité² × 100 × taux²)^0.45 + 1800) × vitesse^-0.55` secondes. La première option est ouverte, les autres se
débloquent dans l'ordre contre ressources et temps (valeurs estimées, `scavenging.options`). Une expédition par option,
sans éclaireurs, béliers, catapultes ni nobles, sans annulation ; butin plafonné par l'entrepôt au retour, rapport.

## Conditions de victoire (`victory.type`)

- `dominance` (par défaut, seule active sur les mondes) : part des villages de joueurs d'une tribu ; avertissement,
  puis fin de partie quand le seuil et l'âge minimal du monde sont atteints, à tenir `holdDays` jours.
- `pointsVillages` : une tribu ou un joueur atteint des points et des villages et les tient `holdHours` heures.
- `runes` : des villages de rune garnis de troupes apparaissent sur chaque continent ; en détenir `winPercent` %.
- `siege` : des quartiers apparaissent au centre ; chacun rapporte de l'influence par jour ; l'objectif baisse de
  `reductionPercent` % tous les `reductionEveryDays` jours (au plus `maxReductionPercent` %).

Fin de partie annulée si la condition n'est plus remplie. Victoire : monde en paix (plus d'attaques), inscriptions
fermées, succès « Vainqueur du monde », rapports à tous les joueurs. Page « Fin du monde » par monde.

## Hors périmètre

Aucune fonctionnalité premium (ni monnaie, ni échange, ni accélération). Pas d'église ni de tour de guet.

## Pas encore fait

Pénalité de défense des villages de rune fraîchement conquis, succès quotidien de la collecte.

Données sources et analyse des mondes FR : [research/ANALYSE_GUERRE_TRIBALE.md](research/ANALYSE_GUERRE_TRIBALE.md).
# gtlike
