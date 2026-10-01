'use strict';

// Définitions des bâtiments, valeurs d'un monde à vitesse 1 (source : get_building_info de fr105).
// Coût du niveau N : base × facteur^(N-1). Pop totale au niveau N : pop × popFactor^(N-1).
// `points` : points du niveau 1 ; au niveau n, le bâtiment vaut `points × 1.2^(n-1)` au total (village complet : 12 154).
// `requires` : niveaux minimum d'autres bâtiments.
// `feature` : module du monde qui doit être activé pour que le bâtiment existe.

module.exports = [
  {
    id: 'main', name: 'Quartier général', minLevel: 1, maxLevel: 30,
    cost: { wood: 90, stone: 80, iron: 70 }, factor: { wood: 1.26, stone: 1.275, iron: 1.26 },
    pop: 5, popFactor: 1.17, buildTime: 900, buildTimeFactor: 1.2, points: 10,
    requires: {},
    description: 'Plus le niveau est élevé, plus les constructions sont rapides.',
  },
  {
    id: 'barracks', name: 'Caserne', minLevel: 0, maxLevel: 25,
    cost: { wood: 200, stone: 170, iron: 90 }, factor: { wood: 1.26, stone: 1.28, iron: 1.26 },
    pop: 7, popFactor: 1.17, buildTime: 1800, buildTimeFactor: 1.2, points: 16,
    requires: { main: 3 },
    description: "Recrutement de l'infanterie.",
  },
  {
    id: 'stable', name: 'Écurie', minLevel: 0, maxLevel: 20,
    cost: { wood: 270, stone: 240, iron: 260 }, factor: { wood: 1.26, stone: 1.28, iron: 1.26 },
    pop: 8, popFactor: 1.17, buildTime: 6000, buildTimeFactor: 1.2, points: 20,
    requires: { main: 10, barracks: 5, smith: 5 },
    description: 'Recrutement de la cavalerie.',
  },
  {
    id: 'garage', name: 'Atelier', minLevel: 0, maxLevel: 15,
    cost: { wood: 300, stone: 240, iron: 260 }, factor: { wood: 1.26, stone: 1.28, iron: 1.26 },
    pop: 8, popFactor: 1.17, buildTime: 6000, buildTimeFactor: 1.2, points: 24,
    requires: { main: 10, smith: 10 },
    description: "Construction des armes de siège.",
  },
  {
    id: 'snob', name: 'Académie', minLevel: 0, maxLevel: 1,
    cost: { wood: 15000, stone: 25000, iron: 10000 }, factor: { wood: 2, stone: 2, iron: 2 },
    pop: 80, popFactor: 1.17, buildTime: 586800, buildTimeFactor: 1.2, points: 512,
    requires: { main: 20, smith: 20, market: 10 },
    description: 'Formation des nobles.',
  },
  {
    id: 'smith', name: 'Forge', minLevel: 0, maxLevel: 20,
    cost: { wood: 220, stone: 180, iron: 240 }, factor: { wood: 1.26, stone: 1.275, iron: 1.26 },
    pop: 20, popFactor: 1.17, buildTime: 6000, buildTimeFactor: 1.2, points: 19,
    requires: { main: 5, barracks: 1 },
    description: 'Recherche de nouvelles unités.',
  },
  {
    id: 'place', name: 'Point de ralliement', minLevel: 0, maxLevel: 1,
    cost: { wood: 10, stone: 40, iron: 30 }, factor: { wood: 1.26, stone: 1.275, iron: 1.26 },
    pop: 0, popFactor: 1.17, buildTime: 10860, buildTimeFactor: 1.2, points: 0,
    requires: {},
    description: 'Envoi des troupes.',
  },
  {
    id: 'statue', name: 'Statue', minLevel: 0, maxLevel: 1, feature: 'knight',
    cost: { wood: 220, stone: 220, iron: 220 }, factor: { wood: 1.26, stone: 1.275, iron: 1.26 },
    pop: 10, popFactor: 1.17, buildTime: 1500, buildTimeFactor: 1.2, points: 24,
    requires: {},
    description: 'Recrutement du paladin.',
  },
  // Église (module `church`) : zone d'influence de 4, 6 puis 8 cases ; hors de toute zone de ses églises, un village se
  // bat à 50 %. Une église par village, détruite quand le village est conquis (voir game/faith.js).
  {
    id: 'church', name: 'Église', minLevel: 0, maxLevel: 3, feature: 'church',
    cost: { wood: 16000, stone: 20000, iron: 5000 }, factor: { wood: 1.26, stone: 1.28, iron: 1.26 },
    pop: 5000, popFactor: 1.55, buildTime: 123320, buildTimeFactor: 1.2, points: 10,
    requires: { main: 5, farm: 5 },
    description: 'Lieu de foi des villages alentour : hors de la zone d’influence de vos églises, vos troupes ne se battent qu’à moitié de leur force.',
  },
  // Première église : déjà construite dans le premier village ; une seule par joueur, rayon de 6 cases, niveau 1 seulement,
  // indestructible par les catapultes. Perdue avec son village, elle peut être reconstruite ailleurs à petit prix.
  {
    id: 'church_f', name: 'Première église', minLevel: 0, maxLevel: 1, feature: 'church',
    cost: { wood: 160, stone: 200, iron: 50 }, factor: { wood: 1.26, stone: 1.28, iron: 1.26 },
    pop: 5, popFactor: 1.55, buildTime: 5440, buildTimeFactor: 1.2, points: 10,
    requires: {},
    description: 'Église de votre premier village : une zone d’influence plus grande (6 cases), mais qui ne s’agrandit pas. Une seule par joueur.',
  },
  {
    id: 'market', name: 'Marché', minLevel: 0, maxLevel: 25,
    cost: { wood: 100, stone: 100, iron: 100 }, factor: { wood: 1.26, stone: 1.275, iron: 1.26 },
    pop: 20, popFactor: 1.17, buildTime: 2700, buildTimeFactor: 1.2, points: 10,
    requires: { main: 3, storage: 2 },
    description: 'Échange de ressources avec les autres joueurs.',
  },
  {
    id: 'wood', name: 'Camp de bois', minLevel: 0, maxLevel: 30, produces: 'wood',
    cost: { wood: 50, stone: 60, iron: 40 }, factor: { wood: 1.25, stone: 1.275, iron: 1.245 },
    pop: 5, popFactor: 1.155, buildTime: 900, buildTimeFactor: 1.2, points: 6,
    requires: {},
    description: 'Production de bois.',
  },
  {
    id: 'stone', name: "Carrière d'argile", minLevel: 0, maxLevel: 30, produces: 'stone',
    cost: { wood: 65, stone: 50, iron: 40 }, factor: { wood: 1.27, stone: 1.265, iron: 1.24 },
    pop: 10, popFactor: 1.14, buildTime: 900, buildTimeFactor: 1.2, points: 6,
    requires: {},
    description: "Production d'argile.",
  },
  {
    id: 'iron', name: 'Mine de fer', minLevel: 0, maxLevel: 30, produces: 'iron',
    cost: { wood: 75, stone: 65, iron: 70 }, factor: { wood: 1.252, stone: 1.275, iron: 1.24 },
    pop: 10, popFactor: 1.17, buildTime: 1080, buildTimeFactor: 1.2, points: 6,
    requires: {},
    description: 'Production de fer.',
  },
  {
    id: 'farm', name: 'Ferme', minLevel: 1, maxLevel: 30,
    cost: { wood: 45, stone: 40, iron: 30 }, factor: { wood: 1.3, stone: 1.32, iron: 1.29 },
    pop: 0, popFactor: 1, buildTime: 1200, buildTimeFactor: 1.2, points: 5,
    requires: {},
    description: 'Nourrit la population (bâtiments et troupes).',
  },
  {
    id: 'storage', name: 'Entrepôt', minLevel: 1, maxLevel: 30,
    cost: { wood: 60, stone: 50, iron: 40 }, factor: { wood: 1.265, stone: 1.27, iron: 1.245 },
    pop: 0, popFactor: 1.15, buildTime: 1020, buildTimeFactor: 1.2, points: 6,
    requires: {},
    description: 'Capacité de stockage des ressources.',
  },
  {
    id: 'hide', name: 'Cachette', minLevel: 0, maxLevel: 10,
    cost: { wood: 50, stone: 60, iron: 50 }, factor: { wood: 1.25, stone: 1.25, iron: 1.25 },
    pop: 2, popFactor: 1.17, buildTime: 1800, buildTimeFactor: 1.2, points: 5,
    requires: {},
    description: 'Protège une partie des ressources du pillage.',
  },
  {
    id: 'wall', name: 'Muraille', minLevel: 0, maxLevel: 20,
    cost: { wood: 50, stone: 100, iron: 20 }, factor: { wood: 1.26, stone: 1.275, iron: 1.26 },
    pop: 5, popFactor: 1.17, buildTime: 3600, buildTimeFactor: 1.2, points: 8,
    requires: { barracks: 1 },
    description: 'Augmente la défense du village.',
  },
];
