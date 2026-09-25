# Analyse des données publiques de Guerre Tribale (FR)

Collecte faite le 2026-09-24 sur les 6 mondes FR ouverts (liste : `https://www.guerretribale.fr/backend/get_servers.php`).
Les fichiers bruts et le script de comparaison sont dans [raw/](raw/).

## 1. Sources publiques exploitables

| Endpoint | Contenu |
|---|---|
| `/interface.php?func=get_config` | Config complète du monde (~200 paramètres) |
| `/interface.php?func=get_unit_info` | Stats des unités (temps déjà divisés par la vitesse du monde) |
| `/interface.php?func=get_building_info` | Coût de base, facteurs de croissance, niveau max, pop |
| `/map/village.txt.gz` | `id,nom,x,y,joueur_id,points,bonus_id` |
| `/map/player.txt.gz` | `id,nom,tribu_id,nb_villages,points,rang` |
| `/map/ally.txt.gz` | `id,nom,tag,membres,villages,points_top40,points_total,rang` |
| `/map/conquer.txt.gz` | `village_id,timestamp,nouveau_proprio,ancien_proprio` |
| `/map/kill_att.txt.gz`, `kill_def.txt.gz`… | Classements ODA/ODD (pas encore récupérés) |

Les dumps sont régénérés toutes les heures. Il vaut la peine de proposer la même API publique dans notre jeu : c'est ce qui fait vivre les outils communautaires (TWStats, scripts de carte, etc.).

## 2. Les 6 mondes FR comparés

| Monde | Type | Vitesse | Vit. unités | Chevalier | Archers | Églises | Nuit | Morale | Tribu max | Remarque |
|---|---|---|---|---|---|---|---|---|---|---|
| fr105 | Classique | 1 | 1 | non | non | oui | 23h-9h ×6 | oui | 25 | Monde « old school », tour de guet |
| fr104 | Classique | 1.5 | 0.7 | oui | oui | oui | 23h-7h ×2 | oui | 20 | Forge à niveaux (`tech=0`) |
| frp13 | Casual | 1 | 1 | oui | oui | non | 0h-8h ×2 | oui | 20 | Blocage d'attaque ×2 points, pas de noble sur plus petit |
| frc1 | Speed/Classic | 4 | 1 | oui | oui | non | 0h-8h ×3 | non | 12 | 2 villages de départ, production ×2 |
| frc3 | Speed | 4 | 1 | oui (v1) | non | non | 0h-8h ×3 | non | 500 | Bâtiments pré-montés, pas de cachette, pas de premium |
| frs1 | Sprint | 350 | 0.6 | non | non | non | non | non | 5 | Carte 100×100, dure quelques heures |

Constat : **un seul moteur, et tout le gameplay varie par la config**. C'est l'architecture à reproduire : une table `world_config` par serveur, lue partout dans le code.

### Paramètres qui changent vraiment d'un monde à l'autre
- `speed` (vitesse du jeu) et `unit_speed` (vitesse des déplacements), indépendants
- `game.knight`, `game.archer`, `game.church`, `game.watchtower`, `game.stronghold`, `game.scavenging` (activation des modules)
- `game.tech` : 0 = forge à niveaux simples, 2 = recherche simple (débloquer une unité)
- `game.base_production` : 30 (normal), 60, 75
- `game.barbarian_rise` / `barbarian_max_points` : vitesse de croissance des villages barbares
- `snob.gold` : 1 = pièces d'or (coût 28k/30k/25k) ; `snob.max_dist` 50-1000 cases ; `snob.factor` réduit le coût
- `coord.*` : taille de carte, `func` (algorithme de placement), % de villages barbares / bonus, sélection de la direction de départ
- `night.*` : bonus de défense nocturne (×2 à ×6)
- `moral` : morale selon le rapport de points attaquant/défenseur
- `newbie.days` : protection débutant (3-5 jours)
- `ally.limit`, `no_harm`, `no_other_support` : règles de tribu (limite de membres, soutien hors tribu interdit)
- `commands.attack_gap` / `support_gap` : écart minimal en ms entre deux ordres (anti-snipe)
- Conditions de victoire : `dominance_win`, `runes_win`, `siege_win`, `points_villages_win`

## 3. Bâtiments (identique sur tous les mondes, hors temps)

Coût du niveau N : `base × facteur^(N-1)` pour bois, argile, fer et population.
Temps : `build_time` de base (vitesse 1) × `build_time_factor^(N-1)`, réduit par le niveau du QG (formule v2, voir §6).

| Code | Nom FR | Niv. max | Bois | Argile | Fer | Pop | Facteur bois / argile / fer | Temps base (vit.1) |
|---|---|---|---|---|---|---|---|---|
| main | Quartier général | 30 (min 1) | 90 | 80 | 70 | 5 | 1.26 / 1.275 / 1.26 | 900 s |
| barracks | Caserne | 25 | 200 | 170 | 90 | 7 | 1.26 / 1.28 / 1.26 | 1800 s |
| stable | Écurie | 20 | 270 | 240 | 260 | 8 | 1.26 / 1.28 / 1.26 | 6000 s |
| garage | Atelier | 15 | 300 | 240 | 260 | 8 | 1.26 / 1.28 / 1.26 | 6000 s |
| church | Église | 3 | 16000 | 20000 | 5000 | 5000 | 1.26 / 1.28 / 1.26 (pop 1.55) | 184980 s |
| church_f | Première église | 1 | 160 | 200 | 50 | 5 | — | 8160 s |
| watchtower | Tour de guet | 20 | 12000 | 14000 | 10000 | 500 | 1.17 / 1.17 / 1.18 | 13200 s |
| snob | Académie | 1 | 15000 | 25000 | 10000 | 80 | ×2 | 586800 s |
| smith | Forge | 20 | 220 | 180 | 240 | 20 | 1.26 / 1.275 / 1.26 | 6000 s |
| place | Point de ralliement | 1 | 10 | 40 | 30 | 0 | — | 10860 s |
| statue | Statue (chevalier) | 1 | 220 | 220 | 220 | 10 | — | 1500 s |
| market | Marché | 25 | 100 | 100 | 100 | 20 | 1.26 / 1.275 / 1.26 | 2700 s |
| wood | Camp de bois | 30 | 50 | 60 | 40 | 5 | 1.25 / 1.275 / 1.245 | 900 s |
| stone | Carrière d'argile | 30 | 65 | 50 | 40 | 10 | 1.27 / 1.265 / 1.24 | 900 s |
| iron | Mine de fer | 30 | 75 | 65 | 70 | 10 | 1.252 / 1.275 / 1.24 | 1080 s |
| farm | Ferme | 30 (min 1) | 45 | 40 | 30 | 0 | 1.3 / 1.32 / 1.29 | 1200 s |
| storage | Entrepôt | 30 (min 1) | 60 | 50 | 40 | 0 | 1.265 / 1.27 / 1.245 | 1020 s |
| hide | Cachette | 10 | 50 | 60 | 50 | 2 | 1.25 | 1800 s |
| wall | Muraille | 20 | 50 | 100 | 20 | 5 | 1.26 / 1.275 / 1.26 | 3600 s |

Le monde peut aussi imposer des niveaux de départ (`buildings.custom_*`) : frc3 démarre avec QG 6, ferme 10, mines 15.

## 4. Unités

Stats identiques partout (seul l'épéiste varie : défense cavalerie 15 ou 25). Temps et vitesse ci-dessous donnés pour vitesse 1 / unit_speed 1.

| Code | Nom FR | Att | Déf inf | Déf cav | Déf arc | Butin | Pop | Min/case | Recrutement | Coût bois/argile/fer * |
|---|---|---|---|---|---|---|---|---|---|---|
| spear | Lancier | 10 | 15 | 45 | 20 | 25 | 1 | 18 | 1020 s | 50/30/10 |
| sword | Porte-épée | 25 | 50 | 15-25 | 40 | 15 | 1 | 22 | 1500 s | 30/30/70 |
| axe | Guerrier à la hache | 40 | 10 | 5 | 10 | 10 | 1 | 18 | 1320 s | 60/30/40 |
| archer | Archer | 15 | 50 | 40 | 5 | 10 | 1 | 18 | 1800 s | 100/30/60 |
| spy | Éclaireur | 0 | 2 | 1 | 2 | 0 | 2 | 9 | 900 s | 50/50/20 |
| light | Cavalerie légère | 130 | 30 | 40 | 30 | 80 | 4 | 10 | 1800 s | 125/100/250 |
| marcher | Archer monté | 120 | 40 | 30 | 50 | 50 | 5 | 10 | 2700 s | 250/100/150 |
| heavy | Cavalerie lourde | 150 | 200 | 80 | 180 | 50 | 6 | 11 | 3600 s | 200/150/600 |
| ram | Bélier | 2 | 20 | 50 | 20 | 0 | 5 | 30 | 4800 s | 300/200/200 |
| catapult | Catapulte | 100 | 100 | 50 | 100 | 0 | 8 | 30 | 7200 s | 320/400/100 |
| knight | Paladin | 150 | 250 | 400 | 150 | 100 | 10 | 10 | 21600 s | 20/20/40 |
| snob | Noble | 30 | 100 | 50 | 100 | 0 | 100 | 35 | 18000 s | 40000/50000/50000 |
| militia | Milice | 0 | 15 | 45 | 25 | 0 | 0 | — | instantanée | gratuite |

\* Les coûts des unités ne sont pas exposés par l'API ; ce sont les valeurs connues du jeu, à vérifier en jeu.

## 5. Ce que disent les cartes (état au 2026-09-24)

| Monde | Âge | Villages | % barbares | Villages bonus | Joueurs actifs | Tribus | Conquêtes | Top joueur (pts / villages) |
|---|---|---|---|---|---|---|---|---|
| fr105 | 20 j | 5 269 | 65 % | 1 087 | 1 439 | 87 | 399 | 69k / 17 |
| fr104 | 3 mois | 6 458 | 24 % | 2 302 | 718 | 93 | 7 285 | 2.5M / 253 |
| frc1 | 2 mois | 6 686 | 11 % | 4 299 | 325 | 46 | 9 557 | 4.1M / 390 |
| frc3 | 2 j | 7 953 | 80 % | 6 470 | 733 | 8 | 78 | 16k / 6 |
| frp13 | 9 mois | 24 445 | 0 % | 44 | 315 | 41 | 39 895 | 11M / 1 144 |
| frs1 | sprint | 80 | 91 % | 0 | 12 | 1 | 0 | — |

Enseignements :
- **La carte grandit depuis le centre (500|500)** : fr105 occupe x 441-559 après 20 jours, frp13 x 340-660 après 9 mois. Les nouveaux joueurs arrivent en périphérie (`coord.func`, `inner`).
- **Rétention brutale** : la médiane est à 1-2 villages sur la plupart des mondes, alors que les tops en ont des centaines. Le jeu se joue entre quelques dizaines de joueurs très actifs et leurs tribus.
- **Concentration** : sur frc1, la 1re tribu (CHPE) tient 2 693 villages sur 6 686, soit ~40 %, d'où les conditions de victoire par domination.
- **Ids de bonus** : 1 bois, 2 argile, 3 fer, 4 ferme, 5 caserne, 6 écurie, 7 atelier, 8 toutes ressources, 9 entrepôt/marchands ; 10+ = variantes spéciales (« grands » bonus).
- Les mondes vieillissants se vident de joueurs mais sont couverts de villages (frp13 : 24k villages pour 315 joueurs).

## 6. Formules du jeu (connues de la communauté, à valider)

- **Production d'une mine** : `base_production × 1.163118^(niv-1) × speed` par heure (niv 0 = 5/h). Niv 30 ≈ 2 400/h à vitesse 1.
- **Entrepôt** : `1000 × 1.2294934^(niv-1)` (niv 30 = 400 000).
- **Ferme** : `240 × 1.172103^(niv-1)` (niv 30 = 24 000 places).
- **Cachette** : `150 × 1.3335^(niv-1)`.
- **Temps de construction (formule v2)** : `build_time × build_time_factor^(niv-1) × 1.05^(-niv_QG)` à peu près, avec un plancher pour les premiers niveaux.
- **Muraille** : bonus de défense `+4 % par niveau` (composé ≈ 1.037^niv) plus une défense de base fixe `20 + 50 × niv`.
- **Combat** : attaque totale contre défense pondérée selon la part infanterie/cavalerie/archers de l'attaquant ; pertes du perdant = 100 %, pertes du gagnant = `(force_perdant / force_gagnant)^1.5`.
- **Béliers** : baissent la muraille avant le combat (partiellement) puis après selon le résultat.
- **Loyauté** : 100 au départ, chaque noble victorieux retire 20-35 (`mood.loss_min/max`), remontée de +1/h × vitesse.
- **Morale** : `3 × points_défenseur / points_attaquant + 0.3`, bornée entre 30 % et 100 %.
- **Nuit** : défense multipliée par `night.def_factor` entre `start_hour` et `end_hour`.

## 7. Recommandations pour notre jeu

1. **Moteur + config par monde** : reprendre le schéma `get_config` presque tel quel (vitesse, modules on/off, règles de tribu, carte, victoire). Ouvrir un nouveau monde = insérer une config.
2. **Monde de référence pour le MVP** : style fr105 (vitesse 1, sans chevalier ni archers, pièces d'or, nuit active, morale). C'est le socle ; chevalier, archers, église, tour de guet, ramassage et reliques viennent ensuite comme modules.
3. **Tick-free** : les ressources se calculent à la lecture (`dernière_valeur + production × Δt`), les constructions, recrutements et ordres sont des événements horodatés traités par une file (précision à la milliseconde, `millis_arrival`).
4. **Comptes globaux, joueurs par monde** : un compte unique, qui rejoint N mondes (comme guerretribale.fr → frXXX).
5. **Exposer les mêmes dumps publics** (`village.txt`, `player.txt`, `ally.txt`, `conquer.txt`) et un `interface.php` équivalent.
6. **Attention propriété intellectuelle** : les mécaniques ne sont pas protégées, mais le nom « Guerre Tribale / Die Stämme », les graphismes, les textes et les noms d'unités propres à InnoGames le sont. Il faudra un nom, des visuels et idéalement des noms d'unités/bâtiments à nous.
