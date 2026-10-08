# Adarma

Jeu de stratégie par navigateur et par mondes, inspiré de Guerre Tribale.
Stack : Node.js, Express, Sequelize sur MySQL / MariaDB (SQLite en mémoire pour les tests), vues EJS, Tailwind CSS v4.

```bash
npm install
npm run dev        # http://localhost:3000 : serveur + Tailwind en mode watch
npm start          # compile le CSS puis lance le serveur
npm test
npm run migrate    # applique les migrations (obligatoire en production)
npm run migrate -- status | down | create nom-de-la-migration
npm run snapshot -- data/snapshot             # HTML figé de ~40 pages d'une partie de test (avant une refactorisation)
npm run snapshot -- --compare data/snapshot   # après : liste les pages dont l'affichage a changé
npm run populate   # monde « speed » : 1000 joueurs fictifs, tribus, barbares (-- <monde> <nombre> [--reset])
node scripts/seed-tribes.js [monde] [nombre]   # range les joueurs sans tribu dans des tribus de test (speed, 12)
node scripts/seed-market.js [monde] [joueur]   # anime le marché autour d'un joueur : offres, acceptations, livraisons
npm run db:import-sqlite -- [game.sqlite]       # recopie une ancienne base SQLite dans une base MySQL vide
```

Base de données : copier `.env.example` en `.env`, puis renseigner `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` et
`DB_PASSWORD`. La base (MySQL 8 ou MariaDB 10.6 minimum) se crée une fois, vide :
`CREATE DATABASE adarma CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`. Les migrations créent les tables.
Sans `DB_DIALECT=mysql`, le jeu retombe sur SQLite (`SQLITE_STORAGE`) ; les tests forcent SQLite en mémoire.

En production, renseigner `SITE_URL` avec l’origine publique du site (par exemple `https://adarma.example`).
Cette valeur sert aux URL canoniques, aux aperçus de partage et à `/sitemap.xml` ; sans elle, ces éléments
qui exigent une URL absolue ne sont pas publiés. Les pages de compte et de jeu portent `noindex`.
Le favicon est découpé dans le logo PNG et décliné en PNG et ICO ; `python3 scripts/generate-favicon.py` régénère ces fichiers.

## Mise en production (PM2)

[ecosystem.config.js](ecosystem.config.js) lance deux applications PM2 : `adarma-loop` (boucle de jeu seule, `HTTP=0`)
et `adarma-web` (pages en cluster, `GAME_LOOP=0`, `WEB_INSTANCES` processus, 2 par défaut). PM2 les relance après un
plantage (attente croissante si le processus replante aussitôt) ou au-delà de `PM2_MAX_MEMORY` (1G).

```bash
npm install -g pm2
pm2 install pm2-logrotate          # rotation des journaux (~/.pm2/logs)
./scripts/deploy.sh                # git pull, npm ci, CSS, migrations, puis start ou reload sans coupure
pm2 startup                        # une fois : affiche la commande sudo qui relance PM2 au démarrage de la machine
pm2 save                           # mémorise les processus à relancer (deploy.sh le fait aussi)
pm2 status / pm2 logs / pm2 monit
```

`WEB_INSTANCES` et `PM2_MAX_MEMORY` se règlent dans `.env` (pris en compte au prochain `deploy.sh`). Le site se place derrière un proxy HTTPS (nginx…) vers `PORT`.

Le style est uniquement en Tailwind, sans CSS maison : [src/styles/app.css](src/styles/app.css) ne contient que
la configuration (`@theme` : palette et polices de la maquette `maquettes/Adarma.html`), et les
composants (panneaux, boutons, onglets, médaillons…) sont des chaînes de classes dans [src/web/ui.js](src/web/ui.js).
Menus latéraux (rapports, messagerie, marché, classements, modèles de troupes) : `sideNav()` ; compteur d'en-tête
(`ui.headCount`), liste vide (`ui.empty`), note de bas de panneau (`ui.panelNote`) ; bandeau premium :
`partials/premium-banner`.
Le CSS compilé (`public/css/app.css`) n'est pas versionné : `npm start` le recompile (Tailwind est en
devDependencies, installer donc aussi les dépendances de développement pour construire).

Deux mondes sont créés au premier lancement (voir [scripts/seed.js](scripts/seed.js)) : `w1` (vitesse 1, classique)
et `speed` (vitesse 100, tous les modules, pour tester vite), plus `lotr1` (« LOTR 1 », vitesse 1, monde à factions).
`npm run populate` remplit un monde de test comme une vraie partie ([scripts/populate.js](scripts/populate.js)) :
joueurs de 1 à ~40 villages (bâtiments, troupes et ressources cohérents), ~65 % en tribu avec diplomatie, villages barbares.
Comptes fictifs : `<nom>@bots.adarma.local`, mot de passe `motdepasse` (connexion avec le nom du joueur).

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
src/web/routes/village/  Pages d'un village, un routeur par thème (bâtiments, ralliement, marché, tribu, rapports…)
src/views/partials/<page>/  Un partial par onglet ou panneau des grandes pages (marché, tribu, recrutement, ralliement,
                     compte, mondes, rapport, aperçu) ; le fichier parent garde l'en-tête et ses helpers
src/views/           Pages EJS
public/              JS client (game.js : ressources, comptes à rebours… ; map.js : carte ; minimap.js : rendu commun des mini-cartes), images (accueil, fonds de village par style)
maquettes/           Maquette de référence de l'interface (bundle HTML autonome)
```

## Interface

Organisation reprise de Guerre Tribale, habillage de la maquette `maquettes/Adarma.html` (style « BD » : encre
noire, rouge sang et bronze, aplats et ombres portées, polices Marcellus (titres), Cinzel (logo) et Barlow Semi Condensed ; casse normale et graisses moyennes, capitales réservées aux tags). En-tête collant :
menu principal (Aperçu, Carte, Rapports, Messages, Tribu, Classement, Profil ; joueur et rang, compte,
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
(envoyer des troupes, profil, message, favoris, ressources, et au centre l'aperçu du village ; menu pour ses propres villages), gommette de la dernière attaque sur chaque village attaqué (vert : aucune perte, jaune : pertes partielles, rouge : pertes totales, bleu : espionnage ; détail et butin dans l'infobulle et l'aperçu du village). Aperçu d'un village (`/villages/:id`, comme sur GT) : fiche avec mini-carte centrée, actions (centrer, envoyer des troupes avec un modèle d'armée, ressources, message, favoris, marquages), carnet de notes (icône sur la case de la carte, texte dans l'infobulle ; partage avec la tribu dans le compte, « Réglages tribu » : partager mes notes, afficher celles de la tribu), propres ordres en cours vers ce village (icône de l'unité la plus lente), durées de trajet et rapports sur ce village (sélection, suppression), calques (marquages, influence de la tribu, zones ennemies,
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
Réponses. Sondages : 2 à 10 réponses, un vote par membre, modifiable. Les modérateurs (ducs, barons, droit « Modérateur du forum ») gèrent les sous-forums (« Réglages du
forum »), épinglent, verrouillent et suppriment n'importe quel message. Les sujets non lus alimentent la pastille de
l'onglet Tribu. Un joueur qui quitte le monde laisse ses messages ; la dissolution de la tribu efface son forum.

Mot de passe oublié : lien à usage unique valable une heure (seul le haché du jeton est stocké). Aucun serveur
d'envoi n'est configuré : [src/services/Mailer.js](src/services/Mailer.js) écrit les e-mails dans les logs du
serveur ; brancher un vrai transport avant la production. Le classement et la fin du monde restent dans l'interface du jeu.

Thèmes de jeu : l'intérieur du jeu (pas la page d'accueil) change d'habillage selon le thème choisi dans
Compte → Thème de jeu (médiéval par défaut : clair, aux couleurs de Guerre Tribale ; romain, viking ; gratuits).
Style de jeu (Compte → Style de jeu, `src/web/gameLayouts.js`) : minimaliste par défaut (encarts serrés, en-têtes fins, à plat
à la Guerre Tribale, contenu limité à 1120 px), ou normal (interface aérée d'origine), quel que soit le thème. En minimaliste, `<html data-game-layout="minimal">`
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
- Page du marché comme sur GT (sans centre d'échange premium) : menu Échange, Créer des offres, Créer des offres en
  masse, Envoyer des ressources, Transports, Statut des marchands, Toutes tes propres offres, Demande ; en-tête
  Marchands, Quantité de transport maximale, Arrivant, Sortant.
- Échange : Je veux / J'offre, durée de voyage maximale, filtre (tout, acceptables maintenant, ma tribu), ratio,
  disponibilité, acceptation avec maximum, offres par page (réglage du joueur).
- Créer une offre : préremplie de la ressource la plus abondante vers la plus rare ; limites durée maximale du voyage
  et commerce de tribu uniquement (offre cachée et refusée à qui ne les respecte pas). Offres en masse : la même offre
  depuis plusieurs villages. Demande : tes autres villages envoient des ressources au village courant.
- Les livraisons et les mouvements de troupes sont traités dans un seul ordre chronologique.

## Milice

Module `features.militia` du monde (désactivé par défaut, actif sur `speed`), réglages `militia` : comme sur GT,
depuis la ferme, un joueur qui a au plus `maxVillages` (2) villages appelle `perFarmLevel` (20) miliciens par niveau
de ferme, jusqu'au niveau `maxFarmLevel` (15), soit 300 au plus. Ils restent `hours` (6) heures puis disparaissent ;
la production des ressources est multipliée par `productionFactor` (0,5) pendant ce temps. Unité de get_unit_info :
attaque 0, défense 15 / 45 cavalerie / 25 archers, population 0 ; elle ne quitte jamais le village (ni envoi, ni
modèle, ni renvoi) et disparaît si le village est conquis. Points « adversaires vaincus » : ceux du lancier
(aucune source officielle). [src/services/MilitiaService.js](src/services/MilitiaService.js)

## Tribus

- Fondation (nom et tag uniques par monde), invitations, dissolution au départ du dernier membre.
- Titres et pouvoirs de GT ([src/game/tribeRights.js](src/game/tribeRights.js), tableau « Droits » de l'onglet Membres) :
  duc (tous les droits, seul à nommer ducs et barons ; plusieurs ducs possibles, le dernier ne part qu'après en avoir
  nommé un autre), baron (droits des membres, renvois, tous les autres droits), et pour les membres des droits à cocher :
  inviter, diplomatie (description et relations), courrier circulaire, modérateur du forum (sous-forums, messages).
  Les forums cachés et pour membres de confiance de GT ne sont pas repris.
- Limite de membres `tribe.memberLimit` (25). `tribe.noHarm` (par défaut) : pas d'attaque entre membres.
  `tribe.supportOnlyTribe` : soutien réservé à ses villages, à sa tribu et aux tribus alliées.
- Diplomatie à sens unique (allié, PNA, ennemi), visible sur la carte et le profil de la tribu.
- Aperçu comme sur GT : fil des événements (anoblissements, diplomatie, membres, divers ; filtres, pagination) et
  annonces internes (ducs et barons) ; onglet Propriétés pour la description publique. Pas de mur : les discussions
  passent par le forum de tribu. Classement des tribus, export public `/worlds/:slug/map/ally.txt`.

## Mondes à factions

Réglage `factions.active` du monde (groupe « Factions » à la création d'un serveur), désactivé par défaut. Quatre
factions ([src/game/factions.js](src/game/factions.js)) : elfes, nains, orques, humains. Elles ne changent rien aux
bâtiments ni aux unités : seulement les tribus et la fin du monde.

- Entrée dans un monde (tous les mondes) : page dédiée `/worlds/:slug/join` ([src/views/join.ejs](src/views/join.ejs)),
  une étape par choix avant d'ouvrir le village : faction (mondes à factions, première inscription), puis position de
  départ. Les choix passent d'une étape à l'autre dans l'adresse ; la dernière envoie l'inscription. Illustrations
  des factions : déposer `public/img/factions/<id>.webp` (portrait 3:4 ; `elf`, `dwarf`, `orc`, `human`), sinon blason de repli.
- Chaque joueur choisit sa faction en rejoignant le monde (`Players.faction`) ; elle est définitive : après la perte
  de tous ses villages, on recommence dans la même. Les bots prennent la faction la moins peuplée.
- Les tribus existent toujours : une tribu prend la faction de son fondateur (`Tribes.faction`) et n'invite ni
  n'accueille que des joueurs de cette faction.
- Victoire : les mêmes conditions (`victory`) se calculent par faction au lieu de tribu (`VictoryService.teamScope`) :
  les villages de tous les joueurs d'une faction, en tribu ou non, comptent ensemble. Toute la faction gagne
  (`Worlds.winnerFaction`, succès « Vainqueur du monde » pour chacun de ses joueurs).
- `factions.noHarm` : attaque interdite entre joueurs d'une même faction (indépendant de `tribe.noHarm`, qui reste
  le réglage « Attaque interdite entre membres d'une tribu »).
- Designs de village des factions (`humains`, `elfes`, `nains`, `orques`, champ `design` de game/factions.js) : sur un
  monde à factions, celui de sa faction est offert (`ShopService.factionKeys`, ajouté aux droits de ce monde) et remplace
  Beige comme design par défaut (bots compris) ; un design acheté et choisi reste prioritaire. Ailleurs, ils
  s'achètent à la boutique comme les autres designs.
- Monde officiel : `lotr1` (« LOTR 1 »). `npm run populate -- lotr1` répartit les joueurs fictifs entre les factions
  (tribus d'une seule faction) ; `scripts/seed-tribes.js` ne met dans une tribu que des joueurs de la faction du duc.
- Carte : calque « Influence de ta faction » (zones bleues autour des villages des autres joueurs de sa faction ; la
  zone de sa tribu reste prioritaire quand les deux calques sont affichés).
- Faction affichée sur la fiche du monde, les infos du monde, le profil des joueurs et des tribus, et dans la fin du
  monde (« Top des factions par dominance », « Votre faction »).

## Sceaux

Les « drapeaux » de Guerre Tribale, sous le nom de sceaux : module de monde `features.seals` (case « Sceaux » à la
création d'un serveur, actif sur `speed`). Règles et bonus : [src/game/seals.js](src/game/seals.js) ; service :
[src/services/SealService.js](src/services/SealService.js) ; page `/village/:id/seals`.

- 8 types sur 9 niveaux, valeurs du wiki GT : production (+4 → +18 %), recrutement (+6 → +20 % de vitesse), attaque
  et défense (+2 → +10 %), chance (ramenée de 6 → 20 points vers 0, attaques du village), population de la ferme
  (+2 → +10 %), coût des pièces d'or (−10 → −24 %), charge du butin (+2 → +10 %).
- Les sceaux appartiennent au **compte** (table `Seals`) et servent sur tous les mondes où le module est actif. Un sceau
  posé reste au compte : il est seulement indisponible tant qu'il est posé sur un village d'un monde en cours ; il
  redevient libre si le village est conquis, abandonné, ou si le monde se termine. On ne perd jamais un sceau.
- Un sceau par village (`Villages.sealType`, `sealLevel`, `sealAt`), retiré ou remplacé `seals.lockHours` (24) heures
  après sa pose au plus tôt ; le sceau de population ne se retire pas si la ferme déborderait. Le remplaçant ne peut
  rien changer.
- Gains comme sur GT (type au hasard, niveau fixé), **seulement sur les mondes officiels** avec le module : succès
  (niveau du palier, 1 à 4), succès quotidien (3), noble formé (1 chacun), paliers d'unités ennemies vaincues (2 ;
  100, 150, 225… × 1,5). Rien sur un serveur privé, et les sceaux ne sont pas vendus à la boutique.
- Fusion : 3 sceaux libres identiques → 1 sceau du niveau supérieur, même type (`SealService.merge`).
- Échange 1 contre 1, au même niveau, avec un membre de sa tribu (mondes officiels, `SealTrades`).
- Tests : `node scripts/seals.js <pseudo> <type> <niveau> [nombre]`, ou `node scripts/seals.js <pseudo> --kit` (pour
  chaque type, 3 sceaux de niveau 1 et un de niveau 3, 6 et 9).
- Les sceaux d'attaque et de défense figurent dans les rapports de combat et dans le simulateur ; historique des gains
  (`SealEvents`). Visuel provisoire en SVG ([src/web/sealSvg.js](src/web/sealSvg.js)) : cachet de cire à la couleur
  du niveau (gris, bronze, rouge, or, vert, bleu, turquoise, pourpre, noir), icône du type au centre.

## Villages barbares, messagerie, profils

- À chaque inscription, `placement.emptyVillages` % de villages barbares apparaissent autour du nouveau joueur
  (comme `coord.empty_villages` de GT : 170 = 1 barbare + 70 % de chances d'un 2ᵉ ; 100 par défaut, réglable par monde).
- Les villages barbares gagnent `barbarian.growthPerDay × vitesse` points par jour (40 par défaut),
  en montant surtout leurs mines, jusqu'à `barbarian.maxPoints` (1 500). La croissance est calculée
  au rafraîchissement du village ; la boucle de jeu les rafraîchit toutes les 10 minutes.
- Renommer un village depuis son aperçu.
- Messagerie agencée comme sur GT : menu Messages / Mail circulaire / Écrire un message, recherche (objet et texte).
  Boîte de réception paginée (messages par page réglables, 12 par défaut) : Objet (nombre de messages) · Joueur (autre
  participant, « Chat de groupe » ou groupe du mail circulaire) · Dernier message, sélection et effacement groupé.
  Écrire : jusqu'à 10 pseudos, ou le menu « Tribu » du champ À : Tribu entière (mail circulaire, droit requis), Duc,
  Baron, Diplomatie. « Mail circulaire » liste les mails circulaires envoyés.
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
- MySQL (`src/db.js`) : dates en `DATETIME(3)` (échéances à la milliseconde), isolation `READ COMMITTED` avec
  verrous `FOR UPDATE` sur les lignes dépensées, et `ANSI_QUOTES` pour que le SQL écrit à la main (`"createdAt"`)
  reste valable sous SQLite comme sous MySQL. MySQL n'accepte pas de valeur par défaut sur les colonnes JSON / TEXT :
  une migration qui en ajoute une, obligatoire, à une table déjà remplie doit d'abord remplir les lignes existantes.

## Montée en charge

- Déploiement conseillé dès quelques centaines de joueurs connectés : **la boucle de jeu dans son propre processus**
  (`HTTP=0 node src/server.js`) et **plusieurs processus web** derrière le même port
  (`GAME_LOOP=0`, par exemple `pm2 start src/server.js -i 4` avec `NODE_APP_INSTANCE` ≥ 1, ou un proxy vers plusieurs
  ports). Le processus `NODE_APP_INSTANCE=0` (ou sans cette variable) applique les migrations (en dev) et crée les
  mondes. Dans un seul processus, la boucle partage le fil et les connexions des pages : sous forte charge elle prend du
  retard sur les arrivées. Chaque processus ouvre jusqu'à `DB_POOL_MAX` connexions (30) : rester sous
  `max_connections` de MySQL.
- Mesures (`scripts/loadtest.js`, 2 000 joueurs peuplés, 300 joueurs connectés qui ouvrent une page par seconde,
  3 000 attaques en 60 s, une seule machine avec MariaDB) : un processus seul plafonne vers 60 à 90 pages/s (le fil
  Node est saturé) ; boucle à part + 4 processus web : toute la charge servie (≈ 260 pages/s), médiane 35 à 125 ms
  selon la page, 99 % sous 1,5 s. La résolution des combats d'un monde reste séquentielle (ordre chronologique) :
  ≈ 50 combats par seconde et par monde, les mondes en parallèle.
- Boucle de jeu (toutes les 10 min) : succès évalués monde par monde en une passe (rangs et continents calculés une
  fois, `AchievementService.evaluateWorld`), barbares lus d'un coup et réécrits par lots seulement s'ils montent un
  bâtiment (`VillageService.growBarbarians`). Après un combat ou un échange, les succès de rang ne sont pas recalculés.
- Arrivées (`EventService.processDue`) : monde par monde, dans l'ordre chronologique de chaque monde, les mondes en
  parallèle. Une file par monde (FIFO dans le processus, verrou nommé `GET_LOCK` entre processus), par tranches de 50.
  Une page ne traite des arrivées que si l'une concerne les villages du joueur et que personne ne traite déjà ce monde :
  en surcharge, elle s'affiche avec l'état connu au lieu d'attendre derrière l'arriéré, que la boucle résorbe.
- Classements : liste complète recalculée au plus une fois par minute ; exports `/worlds/:slug/map/*.txt` au plus
  toutes les 5 minutes, avec `Cache-Control` (`src/web/memo.js`, mémoire du processus).
- Aperçu des villages et statut des marchands : lectures groupées pour tous les villages du joueur ; seuls les villages
  qui ont une échéance passée sont rafraîchis un par un (`VillagesOverviewService`).
- Affichage d'une page (GET) : sans échéance passée dans le village (construction, recrue, recherche, collecte,
  déblocage, formation, fin de milice), `VillageService.peek` calcule l'état en mémoire, sans transaction, verrou ni
  écriture ; sinon rafraîchissement complet comme avant (`test/village-peek.test.js` vérifie que les deux concordent).
  Compteurs de l'en-tête lus en parallèle.
- Rapports : comme sur Guerre Tribale, la boîte de chaque joueur garde 100 rapports + 10 par village ; la boucle de jeu
  supprime les plus anciens au-delà (`ReportService.pruneAll`, toutes les 10 minutes). Archives (premium) : dossiers
  du joueur (`ReportFolders`, 20 au plus), hors de cette limite, supprimés après `Players.reportArchiveMonths` mois
  (3 par défaut, 24 au plus). Sans premium, on peut encore lire ses dossiers et en ressortir des rapports.
- Sessions : la prolongation d'une session inchangée est écrite au plus une fois par heure (`src/app.js`).
- CSS et JS : `asset('/css/app.css')` dans les vues ajoute la date du fichier à l'adresse ; ces adresses sont gardées
  un an par le navigateur (`src/web/assets.js`), plus de revalidation à chaque page.

## Compte : rapports, sommeil, vacances, paladin

- Rapports : filtres (attaques, défenses, soutiens, commerce), pagination par 50, sélection multiple
  (marquer lus / non lus, supprimer), « tout marquer comme lu », suppression depuis un rapport, flèches vers le
  rapport plus récent / plus ancien. Hors combats, en-tête Objet / Envoyé comme sur GT ; offre acceptée (Vendeur /
  Acheteur avec leurs villages, « a vendu » / « a payé » par lots, heure d'arrivée du paiement, « Re-créer l'offre »
  qui préremplit le marché), livraison (De / À, ressources livrées), succès (objectif atteint, palier suivant, palier
  à droite, lien vers les succès du profil).
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
l'extérieur, offres, rapports et invitations sont supprimés ; le titre de duc passe à un baron, sinon au meilleur membre (ou la tribu est dissoute).
Les messages déjà envoyés restent visibles, signés « Joueur supprimé ».

## Collecte

Quatre options (Collecteurs paresseux, modestes, astucieux, Grands collecteurs) qui rapportent 10 / 25 / 50 / 75 %
de la capacité de transport des troupes envoyées, réparti entre bois, argile et fer. Durée (formule de la communauté) :
`((capacité² × 100 × taux²)^0.45 + 1800) × vitesse^-0.55` secondes. La première option est ouverte, les autres se
débloquent dans l'ordre contre ressources et temps (valeurs estimées, `scavenging.options`). Une expédition par option,
sans éclaireurs, béliers, catapultes ni nobles, sans annulation ; butin plafonné par l'entrepôt au retour, rapport.
Un menu « Modèle » remplit la sélection avec un modèle d'armée du point de ralliement (au plus les troupes présentes ;
les unités exclues de la collecte sont ignorées).

## Conditions de victoire (`victory.type`)

- `dominance` (par défaut, seule active sur les mondes) : part des villages de joueurs d'une tribu ; avertissement,
  puis fin de partie quand le seuil et l'âge minimal du monde sont atteints, à tenir `holdDays` jours.
- `pointsVillages` : une tribu ou un joueur atteint des points et des villages et les tient `holdHours` heures.
- `runes` (Guerres runiques de GT, proposées à la création d'un serveur) : au bout de `spawnAfterDays` jours,
  `villagesPerContinent` villages de rune gardés par des barbares apparaissent, répartis dans chaque continent qui a au
  moins `minPlayerVillages` villages de joueurs (la carte grandit depuis le centre : ce sont les continents habités qui
  comptent, pas `mapSize`). Victoire : `winPercent` % des villages de rune de **chaque** continent, tenus `holdDays` jours.
  Conquis, un village de rune se défend avec `defenseFactor` de sa force, soutiens compris (0,5 = −50 %, réglable) ;
  `disableMorale` retire la morale des attaques contre eux ([src/game/runes.js](src/game/runes.js)). Rune violette sur la
  carte, tableau par continent dans la fin du monde ; les bots ne s'en approchent pas.
- `siege` : des quartiers apparaissent au centre ; chacun rapporte de l'influence par jour ; l'objectif baisse de
  `reductionPercent` % tous les `reductionEveryDays` jours (au plus `maxReductionPercent` %).

Fin de partie annulée si la condition n'est plus remplie. Victoire : monde en paix (plus d'attaques), inscriptions
fermées, succès « Vainqueur du monde », rapports à tous les joueurs. La fin du monde est une entrée du menu des
classements (`?type=victory`), nommée selon la condition (« Dominance du monde »…) : explication chiffrée, top des
tribus, « Liste des conditions de fin de monde » en barres (âge, meneur, compte à rebours, votre tribu, votre
contribution). Les seuils sont des paramètres du monde (`config.victory`, voir [scripts/seed.js](scripts/seed.js)),
affichés dans « Réglages du monde ».

## Assistant de pillage

Page `/village/:id/farm` (premium) et raccourcis de la carte : envoi d'un modèle d'armée favori en un clic
(`POST /farm/send`). Anti-script comme sur Guerre Tribale : au plus 5 attaques par seconde et par joueur
([src/web/rateLimit.js](src/web/rateLimit.js), compté par processus) ; au-delà, refus 429 et message « Trop rapide ».

## Gestionnaire de compte

Page `/village/:id/manager` (premium, onglet « Gestionnaire » des aperçus), sur le modèle de celui de Guerre Tribale
mais **sans minimum de villages** et inclus dans le premium ([src/services/AccountManagerService.js](src/services/AccountManagerService.js)) :

- **Gestionnaire de villages** : modèles de construction (listes ordonnées « bâtiment → niveau », 3 modèles système tirés des forums de GT — défensif 9 716 points, offensif 9 735, ressources 9 269 —
  dans [src/game/managerTemplates.js](src/game/managerTemplates.js), modèles du joueur dans `ManagerTemplates`) appliqués
  aux villages (`ManagerVillages`), pause et reprise. Seules les places de file au prix normal sont utilisées ; entrepôt,
  ferme et bâtiments requis manquants passent d'abord ; démolition en option. Pas de limite de 50 ordres comme sur GT.
- **Gestionnaire de forge** : modèles de recherche (« Toutes les recherches », système, valable sur tous les mondes ;
  modèles du joueur, une case par unité du monde, enregistrée aussitôt). Une recherche à la fois, dans l'ordre de la
  forge : celles dont les bâtiments requis manquent attendent, les suivantes passent. Passe après la prochaine
  construction (ses ressources mises de côté) et avant les troupes (qui laissent celles de la recherche attendue).
- **Gestionnaire de troupes** : troupes voulues au total (modèles système : nukes, défenses fixe et mobile, éclaireurs, variantes à archers selon le monde ; modèles du joueur ; ou saisie), tampons de population et de ressources ; les
  unités en manque avancent ensemble ; la prochaine construction du gestionnaire de villages garde ses ressources.
- **Gestionnaire de marché** : routes commerciales hebdomadaires (`TradeRoutes`) et réserve (équilibrage toutes les 8 h
  entre seuils de manque et d'excédent, en % de l'entrepôt ou en valeur fixe ; rôle de chaque village).
- **Notifications d'attaque** par e-mail (première attaque, toutes les N attaques ou toutes les N heures, « seulement si
  je ne suis pas connecté » d'après `Players.lastSeenAt`, regroupement par attaquant ou par cible).

La boucle de jeu lance `AccountManagerService.runDue` toutes les minutes ; chaque village géré a sa prochaine
vérification (`checkAt`, 1 à 15 minutes). Sans premium, rien ne tourne et l'aperçu le signale.

## E-mails

[src/services/Mailer.js](src/services/Mailer.js) : réinitialisation du mot de passe et notifications d'attaque du
gestionnaire de compte. Envoi SMTP (nodemailer) dès que `SMTP_HOST` est renseigné (voir `.env.example` : `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`) ; sans lui, les messages sont écrits dans les logs. `SITE_URL`
sert aux liens des messages (bouton « Voir les attaques en approche »).

Gabarit commun : [src/views/mail/layout.ejs](src/views/mail/layout.ejs) (`Mailer.sendTemplate`), HTML pour messageries
et version texte. Les images (logo, en-têtes tirés des rapports : `public/img/mail/attack.jpg`, `account.jpg`) sont
jointes au message, elles s'affichent sans site public.

## Hors périmètre

Pas de tour de guet, pas d'accélération payante ni d'échange premium.

## Boutique

Le jeu est gratuit ; une boutique facultative (`/shop`) vend des articles contre des **Adartons**, la monnaie du jeu (solde sur le compte, historique dans `AdartonTransactions`). Le paiement n'est pas encore branché : acheter des Adartons mène à une page « En construction » ; `node scripts/adartons.js <pseudo> <montant>` crédite un compte (tests, support).

- Catalogue : `src/game/shopCatalog.js` (premium, pack « Tous les cosmétiques », un article par thème de jeu et par design de village ; Adarma et Beige restent gratuits).
- Portées d'une offre : un monde (son joueur), tout le compte (tous les mondes), tout un serveur privé (acheté par son créateur, pour tous ses joueurs). Durée en jours, ou sans fin / jusqu'à la fin du monde.
- Droits acquis : table `Entitlements`, lus par `ShopService.rightsFor(userId, worldId)`. Le premium donne `premium.buildQueueBonus` emplacements de file de construction en plus ; un thème ou un design ne s'applique que là où il est possédé.
- Les comptes qui utilisaient un thème ou un design avant l'ouverture de la boutique le gardent (droit acquis, migration `20261001040000-shop`).
- Pages légales : `/mentions-legales`, `/cgu`, `/cgv`, `/confidentialite`, `/cookies` (modèles à faire relire, champs entre crochets à compléter).

L'église est un module de monde (`features.church`, case « Église » à la création d'un serveur) : église (niveaux 1 à 3, zone de 4, 6 puis 8 cases) et première église (6 cases, une par joueur, déjà construite dans le premier village, indestructible par les catapultes). Hors de la zone de ses églises, un village se bat à 50 % : en attaque depuis ce village, en défense de ce village (soutiens compris). L'église disparaît quand le village est conquis. Voir `src/game/faith.js`.

## Pas encore fait

Succès quotidien de la collecte.

Données sources et analyse des mondes FR : [research/ANALYSE_GUERRE_TRIBALE.md](research/ANALYSE_GUERRE_TRIBALE.md).
# adarma
