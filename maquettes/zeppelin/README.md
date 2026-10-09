# Zeppelin — prototype L’Audacieux

Ouvrir `../zeppelin.html`, directement dans un navigateur ou via un serveur statique à la racine du dépôt. Aucun service, compte, police distante ou accès à la base de données nécessaire.

Prototype isolé du jeu : sélection des huit modules, inspection, pont vide et amélioration instantanée simulée avec déduction des ressources. Recharger réinitialise la simulation. Les durées et productions affichées sont illustratives ; aucun timer ni revenu automatique. Un seul visuel par module, quel que soit son niveau.

## Adaptation du jeu

| Jeu actuel | Zeppelin | Rôle |
| --- | --- | --- |
| Village | Vaisseau | Base mobile |
| Quartier général | Poste de pilotage | Commandement et construction |
| Entrepôt | Cale | Stockage des trois ressources |
| Bûcheron | Salle des machines | Récupération et refonte d’alliage |
| Carrière d’argile | Condenseur | Production de condensat |
| Mine de fer | Raffinerie d’éther | Production d’éther |
| Forge + atelier | Atelier mécanique | Recherche et armement |
| Ferme + caserne | Quartier d’équipage | Capacité et recrutement à bord |
| Écurie | Hangar d’escadrille | Recrutement aérien |
| Place de rassemblement | Commandes du poste de pilotage | Expéditions |
| Marché | Échanges par la cale | Convois |
| Muraille | Blindage de coque, futur équipement | Défense |
| Cachette | Compartiments secrets, future amélioration de cale | Protection des ressources |
| Académie | Bureau des navigateurs, future recherche | Capture de vaisseaux |
| Église, statue | Omission pour ce premier prototype | Simplification |

| Ressource actuelle | Nouvelle ressource |
| --- | --- |
| Bois | Alliage |
| Argile | Condensat |
| Fer | Éther |
| Population | Équipage |

| Unité actuelle | Proposition |
| --- | --- |
| Lancier / porteur d’épée | Fusilier de pont / garde de coque |
| Guerrier à la hache | Voltigeur d’abordage |
| Archer | Tireur d’éther |
| Éclaireur | Éclaireur aérien |
| Cavalerie légère / lourde | Chasseur / intercepteur blindé |
| Bélier / catapulte | Brise-coque / bombardier |
| Noble | Navigateur de prise |

Ces correspondances sont conceptuelles : le registre et l’équilibrage du jeu actuel ne sont pas modifiés.

## Illustrations — version corrigée

Générées et éditées avec l’outil intégré imagegen. Les prompts de cette version sont dans `prompts-v2.json` ; les premiers essais sont documentés dans `prompts.json`.

Direction : peinture stylisée 2D/3D inspirée d’Arcane, laiton et métal pétrole, lumière dorée, cité verticale dans la brume. Pont proche, proue en bas à gauche, ballon hors champ ; câbles de suspension ancrés aux bords de la coque et remontant hors cadre.

Pour corriger la perspective des premiers sprites, cette maquette utilise désormais une scène assemblée : `assets/pont-modules-v2.webp`. Les bâtiments ont été générés directement sur les emplacements du fond avec une caméra, une lumière et des ombres communes. Leurs silhouettes sont distinctes : cockpit vitré, cale ouverte, atelier avec établi, condenseur cyan, raffinerie violette, dortoir avec linge, hangar avec avion et turbine arrière.

Les huit boutons HTML transparents assurent la sélection et les libellés. Le mode pont vide affiche `assets/pont-v2.webp`. Les images `*-detail-v2.webp` sont des extraits de la même scène pour le panneau d’inspection. Les modules de cette version ne sont donc pas des sprites indépendants déplaçables ; les anciens sprites transparents sont conservés comme premier essai et ne sont plus utilisés.

Poids total des dix images de la version 2 : environ 795 Ko, dont 349 Ko pour la scène principale. Un seul palier graphique par module. `optimize.cjs` prépare les WebP et les extraits depuis les originaux locaux ; la variable `ZEPPELIN_IMAGE_SOURCE` permet de fournir leur répertoire. Les WebP livrés suffisent pour afficher la maquette.

Vérification dans Chromium : rendu, chargement des images, huit modules, sélection, amélioration, déduction des ressources, pont vide et restauration.

## Interface et survol

`interface.css` définit la direction de l’interface : panneaux pétrole, filets de laiton, cartouches de niveau, ressources lumineuses et boutons gravés. Le fond reste inchangé. Un calque SVG réutilise l’illustration existante, découpée par module : au survol ou au focus clavier, seule la zone du bâtiment s’éclaircit avec un contour d’éther. Les étiquettes se soulèvent ; les animations respectent la préférence de réduction des mouvements. Aucun asset raster supplémentaire.

## Carte actuelle : quatre villes modulaires

La carte conserve les repères d’Adarma : coordonnées, sélection, mini-carte, navigation et voyages entre points. Elle affiche désormais **quatre villes et douze quartiers**, au lieu des dizaines d’îles complètes des premiers essais. Chaque ville est assemblée dans le navigateur à partir de plusieurs images indépendantes : quartiers portuaires, passerelles, place, silhouettes résidentielles et tour de transit. Il n’y a plus d’asset de cité entière dans le rendu de la carte.

DA : rétrofuturisme de laiton, pierre claire, verre teinté et moteurs suspendus, inspiré de Piltover / Arcane, demandé à imagegen en peinture 2D avec fausse profondeur 3D. Les plateformes sont des fragments architecturaux ouverts, avec poutres et tuyauteries, sans socle rocheux ovale complet. Les villes diffèrent par leurs services, leurs dispositions, leur décor et leurs cours de marché. Les six types de quartiers restent réutilisables ; ils ne sont pas générés à chaque affichage.

| Ville | Quartiers accessibles |
| --- | --- |
| Hautes-Cités | Douanes impériales, Halles des Trois-Vents, Chantier du Méridien |
| Forges de Cendre | Fonderie des Braises, Bourse du Cuivre, Poste des Sentinelles |
| Terrasses d’Azur | Condenseurs du Levant, Marché des Sources, Ateliers hydrauliques |
| Académie suspendue | Distillerie, Comptoir des Arcanistes, Chambre des Sceaux |

Chaque quartier possède **son propre quai et deux postes d’amarrage**, indépendants des autres quartiers de sa ville. Les quatre boutons de ville et la mini-carte permettent de naviguer. Le vaisseau réserve un poste libre, rejoint ce quartier, puis accède à ses services. Les ponts sont des éléments visuels ; le déplacement du joueur reste aérien.

### Ressources, commerce et entretien

- Production : collecte de trois secondes, jusqu’à 240 unités, limitée par le stock du quartier et la capacité disponible.
- Marché : achat / vente de 1 à 1 000 unités par transaction, uniquement à quai et hors voyage. Les crédits et ressources sont réellement modifiés dans la simulation.
- Prix : cours locaux différents par ville ; achat au cours de vente +2 crédits par unité. Les cours sont fixes dans cette maquette.
- Cale : 22 000 unités totales au départ, +1 000 par niveau de cale supplémentaire, et plafond de 12 000 par ressource. Les améliorations du pont utilisent les mêmes ressources.
- Douanes : scellés à 60 crédits, valables pour les deux prochains voyages.
- Chantier : réparation de coque à 40 crédits et accès aux équipements du pont.

### Interceptions simulées et autres capitaines

Quatre autres capitaines sont visibles avec leurs vaisseaux et marqueurs de relation. Ces présences sont fixes : **aucun serveur multijoueur ni vol réel entre joueurs**.

Le bouton « Préparer une interception » arme une seule tentative pour le prochain voyage. Le couloir surveillé, activé par défaut, ajoute 1,8 seconde et empêche la tentative. Sinon, des scellés actifs la bloquent. Sans protection, la simulation retire jusqu’à 120 unités de la ressource la plus abondante et 10 points de coque. Il n’y a pas de vol aléatoire en arrière-plan. Les scellés sont consommés à chaque voyage, même surveillé et sans interception.

### Zeppelin et fichiers

Le modèle dispose de huit orientations E, SE, S, SO, O, NO, N, NE. La vue suit le cap du trajet ; propulsion et inclinaison sont animées en CSS. Les anciennes frames d’hélices et anciens assets de cités restent sur disque comme essais, mais ne sont plus consommés par la carte.

- `map.js`, `map.css` : composition, actions, navigation et économie.
- `assets/districts/` : **douze assets WebP séparés**, environ 732 Ko au total.
- `prompts-districts.json` : prompts finaux de génération imagegen.
- `optimize-districts.cjs` : conversion et extraction depuis les originaux locaux.
- `assets/map/zeppelin-angle-*.webp`, `zeppelin-directions.webp` : huit orientations et planche consultable.
- `prompts-cities.json`, `optimize-cities.cjs` : préparation du modèle directionnel.

L’état est uniquement en mémoire. Recharger ou réinitialiser efface crédits, cargaison, améliorations, stocks, coque et protection. Aucun changement aux données du jeu actuel.

### Vérification

`tests/economy.html` lance un scénario navigateur autonome : 4 villes, 12 quartiers, chargement des images séparées, autres capitaines, voyage, scellés et leur consommation, vente, achat, refus d’achat sans crédits, refus de quantité nulle, collecte +240, interception non protégée, réparation puis interception évitée par surveillance. Il se termine par PASS ou FAIL ; il nécessite environ une minute en temps réel. Ouvrir ce fichier dans un navigateur comme la maquette.

Le scénario a été exécuté avec succès dans Chromium, ainsi que la vérification du rendu sur bureau et mobile.

## Carte intégrée : ville continue et voies aériennes

La carte utilise désormais `assets/map/ville-celeste.webp` (1536 × 1024, environ 652 Ko), illustration sombre d’une ville continue avec couloirs aériens et quais en hauteur. Les anciens fragments de ville restent disponibles sur disque. Les douze escales interactives sont positionnées sur le nouveau fond ; la mini-carte utilise la même image.

`city-navigation.js` calcule les chemins les plus courts sur le réseau de voies défini dans `map.js`, puis interpole le déplacement à vitesse constante sur les segments. Le joueur et les quatre capitaines utilisent ce réseau, avec changement parmi les huit orientations existantes. Les autres capitaines réservent un poste, voyagent et attendent à quai avant de repartir. Leur circulation automatique est désactivée lorsque la réduction des animations est demandée. Les déplacements commandés par le joueur restent disponibles.

Les marchés, collectes, réparations, scellés et interceptions demeurent des simulations locales. Les quais sont réservés mais les croisements en vol n’ont pas de simulation de collision.

Vérifications navigateur : `tests/navigation.html` contrôle le chargement du fond, la circulation autonome, les trajets par embranchements, les orientations, l’amarrage et le zoom. `tests/economy.html` contrôle également le commerce et les services après les déplacements.

Le fond épuré `assets/map/ville-celeste-epuree.webp` remplace le premier fond intégré : les voies sont composées uniquement de nuages opaques, et les architectures secondaires ont été réduites. Les trois escales industrielles partagent les abords du quai principal de la fonderie.

Le fond actif est maintenant `assets/map/ville-celeste-equilibree.webp` : densité intermédiaire de quartiers autour des monuments, couloirs aériens exclusivement composés de nuages. Les quais et le réseau de navigation conservent leurs coordonnées.

Les interactions sont regroupées en six ports visibles sur la carte et la mini-carte. Les services secondaires (marché, douanes, atelier) se sélectionnent dans le panneau du port et ne nécessitent plus de voyage entre les services du même port. Les postes d’amarrage sont partagés entre ces services.
