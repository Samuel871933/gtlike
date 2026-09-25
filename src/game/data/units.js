'use strict';

// Définitions des unités, valeurs d'un monde à vitesse 1 (source : get_unit_info + coûts relevés en jeu).
// `buildTime` en secondes au niveau 0 du bâtiment de recrutement ; `speed` en minutes par case.
// `requires` : prérequis de bâtiments.
// `research` : coût de la recherche à la forge (système de recherche simple, wiki officiel) ; absent = pas de recherche.
// `researchRequires` : prérequis supplémentaires quand la recherche est active (ex. hache : forge 2).
// `kills` : points « adversaires vaincus » (wiki DS) : `att` pour l'attaquant qui tue l'unité,
// `def` pour le défenseur qui la tue.

module.exports = [
  {
    id: 'spear', name: 'Lancier', building: 'barracks',
    cost: { wood: 50, stone: 30, iron: 10 }, pop: 1, buildTime: 1020, speed: 18, carry: 25,
    attack: 10, defense: 15, defenseCavalry: 45, defenseArcher: 20, type: 'infantry', kills: { att: 4, def: 1 },
    requires: { barracks: 1 },
  },
  {
    id: 'sword', name: "Porteur d'épée", building: 'barracks',
    cost: { wood: 30, stone: 30, iron: 70 }, pop: 1, buildTime: 1500, speed: 22, carry: 15,
    attack: 25, defense: 50, defenseCavalry: 25, defenseArcher: 40, type: 'infantry', kills: { att: 5, def: 2 },
    requires: { barracks: 1, smith: 1 },
  },
  {
    id: 'axe', name: 'Guerrier à la hache', building: 'barracks',
    cost: { wood: 60, stone: 30, iron: 40 }, pop: 1, buildTime: 1320, speed: 18, carry: 10,
    attack: 40, defense: 10, defenseCavalry: 5, defenseArcher: 10, type: 'infantry', kills: { att: 1, def: 4 },
    requires: { barracks: 1 },
    research: { wood: 700, stone: 840, iron: 820 }, researchRequires: { smith: 2 },
  },
  {
    id: 'archer', name: 'Archer', building: 'barracks', feature: 'archer',
    cost: { wood: 100, stone: 30, iron: 60 }, pop: 1, buildTime: 1800, speed: 18, carry: 10,
    attack: 15, defense: 50, defenseCavalry: 40, defenseArcher: 5, type: 'archer', kills: { att: 5, def: 2 },
    requires: { barracks: 5, smith: 5 },
    research: { wood: 640, stone: 560, iron: 740 },
  },
  {
    id: 'spy', name: 'Éclaireur', building: 'stable',
    cost: { wood: 50, stone: 50, iron: 20 }, pop: 2, buildTime: 900, speed: 9, carry: 0,
    attack: 0, defense: 2, defenseCavalry: 1, defenseArcher: 2, type: 'cavalry', kills: { att: 1, def: 2 },
    requires: { stable: 1 },
    research: { wood: 560, stone: 480, iron: 480 },
  },
  {
    id: 'light', name: 'Cavalerie légère', building: 'stable',
    cost: { wood: 125, stone: 100, iron: 250 }, pop: 4, buildTime: 1800, speed: 10, carry: 80,
    attack: 130, defense: 30, defenseCavalry: 40, defenseArcher: 30, type: 'cavalry', kills: { att: 5, def: 13 },
    requires: { stable: 3 },
    research: { wood: 2200, stone: 2400, iron: 2000 },
  },
  {
    id: 'marcher', name: 'Archer monté', building: 'stable', feature: 'archer',
    cost: { wood: 250, stone: 100, iron: 150 }, pop: 5, buildTime: 2700, speed: 10, carry: 50,
    attack: 120, defense: 40, defenseCavalry: 30, defenseArcher: 50, type: 'archer', kills: { att: 6, def: 12 },
    requires: { stable: 5 },
    research: { wood: 3000, stone: 2400, iron: 2000 },
  },
  {
    id: 'heavy', name: 'Cavalerie lourde', building: 'stable',
    cost: { wood: 200, stone: 150, iron: 600 }, pop: 6, buildTime: 3600, speed: 11, carry: 50,
    attack: 150, defense: 200, defenseCavalry: 80, defenseArcher: 180, type: 'cavalry', kills: { att: 23, def: 15 },
    requires: { stable: 10, smith: 15 },
    research: { wood: 3000, stone: 2400, iron: 2000 },
  },
  {
    id: 'ram', name: 'Bélier', building: 'garage',
    cost: { wood: 300, stone: 200, iron: 200 }, pop: 5, buildTime: 4800, speed: 30, carry: 0,
    attack: 2, defense: 20, defenseCavalry: 50, defenseArcher: 20, type: 'infantry', kills: { att: 4, def: 8 },
    requires: { garage: 1 },
    research: { wood: 1200, stone: 1600, iron: 800 },
  },
  {
    id: 'catapult', name: 'Catapulte', building: 'garage',
    cost: { wood: 320, stone: 400, iron: 100 }, pop: 8, buildTime: 7200, speed: 30, carry: 0,
    attack: 100, defense: 100, defenseCavalry: 50, defenseArcher: 100, type: 'infantry', kills: { att: 12, def: 10 },
    requires: { garage: 2, smith: 12 },
    research: { wood: 1600, stone: 2000, iron: 1200 },
  },
  {
    id: 'knight', name: 'Paladin', building: 'statue', feature: 'knight',
    cost: { wood: 20, stone: 20, iron: 40 }, pop: 10, buildTime: 21600, speed: 10, carry: 100,
    attack: 150, defense: 250, defenseCavalry: 400, defenseArcher: 150, type: 'infantry', kills: { att: 40, def: 20 },
    requires: { statue: 1 },
  },
  {
    id: 'snob', name: 'Noble', building: 'snob',
    cost: { wood: 40000, stone: 50000, iron: 50000 }, pop: 100, buildTime: 18000, speed: 35, carry: 0,
    attack: 30, defense: 100, defenseCavalry: 50, defenseArcher: 100, type: 'infantry', kills: { att: 200, def: 200 },
    requires: { snob: 1 },
  },
];
