'use strict';

// Modèles de construction du gestionnaire de compte (voir services/AccountManagerService).
//
// Une liste de construction est une suite d'étapes { building, level } : « monter `building` jusqu'au niveau
// `level` ». Le gestionnaire prend toujours la première étape pas encore atteinte (niveau du village ou de sa file),
// dans l'ordre exact de la liste, comme sur Guerre Tribale : 20 niveaux de caserne d'un coup se font à la suite ;
// 2 de caserne puis 2 de forge, répétés, font monter les deux ensemble.
//
// Les trois modèles système de GT (Ressources, Défensif, Offensif) ne se modifient pas et ne se suppriment pas ; on
// peut les copier dans un modèle à soi.

/** Suite d'étapes depuis [[bâtiment, niveau], …] (niveaux visés). */
const seq = (list) => list.map(([building, level]) => ({ building, level }));

// Modèles finis d'après les forums de Guerre Tribale (fr, net, us, co.uk) : le village « complet » classique, autour
// de 9 700 points et 20 700 places de ferme pour les troupes (QG 20, caserne 25, écurie 20, forge 20, ressources,
// ferme et entrepôt 30, muraille 20, marché 20). Les formules d'Adarma étant celles de GT, on retrouve les mêmes
// chiffres : défensif 9 716 points / 20 732 places, offensif 9 735 / 20 724, ressources 9 269 / 20 436.
// L'ordre suit les conseils de départ des forums : économie d'abord (ressources, entrepôt, ferme, QG), puis les
// bâtiments militaires du type de village, et les niveaux 25 à 30 des ressources à la fin.

// Départ commun (jusqu'à environ 1 500 points) : mines, QG, caserne et forge pour les premières troupes.
const OPENING = [
  ['wood', 1], ['stone', 1], ['iron', 1], ['wood', 2], ['stone', 2], ['main', 2], ['wood', 3], ['stone', 3], ['iron', 2],
  ['main', 3], ['barracks', 1], ['farm', 2], ['storage', 2], ['wood', 5], ['stone', 5], ['iron', 4], ['storage', 4],
  ['farm', 4], ['main', 5], ['market', 1], ['smith', 1], ['wood', 8], ['stone', 8], ['iron', 6], ['storage', 8],
  ['farm', 7], ['main', 8], ['wood', 12], ['stone', 12], ['iron', 10], ['storage', 11], ['farm', 10], ['main', 10],
];

// Défensif (9 716 points) : caserne et muraille tôt, écurie pour la cavalerie lourde, cachette 10, atelier 2.
const DEFENSIVE = seq([
  ...OPENING,
  ['barracks', 5], ['smith', 5], ['wall', 5], ['wood', 15], ['stone', 15], ['iron', 13], ['storage', 14], ['farm', 13],
  ['main', 15], ['barracks', 10], ['smith', 10], ['wall', 10], ['stable', 3], ['market', 5], ['hide', 5],
  ['wood', 20], ['stone', 20], ['iron', 18], ['storage', 18], ['farm', 17], ['barracks', 15], ['wall', 15],
  ['stable', 10], ['smith', 15], ['main', 20], ['wood', 25], ['stone', 25], ['iron', 23], ['storage', 22], ['farm', 22],
  ['barracks', 20], ['wall', 20], ['stable', 15], ['smith', 20], ['market', 10], ['garage', 2], ['hide', 10],
  ['wood', 28], ['stone', 28], ['iron', 27], ['storage', 26], ['farm', 26], ['barracks', 23], ['stable', 18], ['market', 15],
  ['wood', 30], ['stone', 30], ['iron', 30], ['storage', 30], ['farm', 30], ['barracks', 25], ['stable', 20], ['market', 20],
  ['snob', 1],
]);

// Offensif (9 735 points) : écurie et atelier plus tôt, académie et statue, sans cachette, atelier 5 (nukes à béliers).
const OFFENSIVE = seq([
  ...OPENING,
  ['barracks', 5], ['smith', 5], ['wood', 15], ['stone', 15], ['iron', 15], ['storage', 14], ['farm', 13], ['stable', 3],
  ['barracks', 10], ['smith', 10], ['stable', 8], ['garage', 1], ['market', 5], ['wall', 5], ['main', 15],
  ['wood', 20], ['stone', 20], ['iron', 20], ['storage', 18], ['farm', 17], ['barracks', 15], ['stable', 12], ['smith', 15],
  ['main', 20], ['garage', 3], ['statue', 1], ['wall', 10], ['wood', 25], ['stone', 25], ['iron', 25], ['storage', 22],
  ['farm', 22], ['barracks', 20], ['stable', 16], ['smith', 20], ['market', 10], ['snob', 1], ['garage', 5], ['wall', 15],
  ['wood', 28], ['stone', 28], ['iron', 28], ['storage', 26], ['farm', 26], ['barracks', 23], ['stable', 18], ['market', 15],
  ['wall', 20], ['wood', 30], ['stone', 30], ['iron', 30], ['storage', 30], ['farm', 30], ['barracks', 25], ['stable', 20],
  ['market', 20],
]);

// Ressources (9 269 points) : mines, entrepôt et ferme au niveau 30 d'abord, marché 25 pour approvisionner les autres
// villages, puis caserne 25, forge 20 et écurie 15 pour remplir la ferme de défense.
const RESOURCES = seq([
  ...OPENING,
  ['wood', 15], ['stone', 15], ['iron', 15], ['storage', 15], ['farm', 13], ['market', 5], ['main', 15],
  ['wood', 20], ['stone', 20], ['iron', 20], ['storage', 20], ['farm', 18], ['market', 10], ['wall', 5], ['barracks', 5],
  ['smith', 5], ['hide', 10], ['wood', 25], ['stone', 25], ['iron', 25], ['storage', 25], ['farm', 23], ['main', 20],
  ['market', 15], ['wall', 10], ['wood', 30], ['stone', 30], ['iron', 30], ['storage', 30], ['farm', 30], ['market', 25],
  ['wall', 20], ['barracks', 15], ['smith', 15], ['stable', 5], ['barracks', 25], ['smith', 20], ['stable', 15],
]);

const SYSTEM = [
  { key: 'sys:resources', name: 'Ressources', description: 'Mines, entrepôt et ferme au niveau 30 d’abord, marché 25 pour ravitailler tes autres villages, puis de quoi recruter de la défense. 9 269 points une fois fini.', steps: RESOURCES },
  { key: 'sys:defensive', name: 'Défensif', description: 'Le village défensif complet des forums : caserne 25, écurie 20, muraille 20, cachette 10. 9 716 points et 20 732 places pour les troupes une fois fini.', steps: DEFENSIVE },
  { key: 'sys:offensive', name: 'Offensif', description: 'Le village offensif complet des forums : caserne 25, écurie 20, atelier 5, académie et statue. 9 735 points et 20 724 places pour les troupes une fois fini.', steps: OFFENSIVE },
].map((t) => Object.freeze({ ...t, system: true, demolish: false }));

// Gestionnaire de troupes : coût d'un lot par bâtiment (ressources), par défaut le prix de 50 lanciers.
const BATCH_COST = 4500;
const BATCH_COST_MIN = 100;
const BATCH_COST_MAX = 10000000;

/** Coût d'un lot d'un modèle de troupes (ressources) ; anciens modèles réglés en lanciers (`batch`) : 90 par lancier. */
function batchCostOf(troops) {
  const raw = troops && troops.batchCost ? troops.batchCost : troops && troops.batch ? troops.batch * 90 : BATCH_COST;
  return Math.max(BATCH_COST_MIN, Math.min(BATCH_COST_MAX, Math.round(raw)));
}

/**
 * Découpe d'un lot d'un bâtiment (gestionnaire de troupes et aperçu du modèle) : `items` [{ key, need, price }] (ce qui
 * manque, prix d'une unité en ressources) ; renvoie Map key → nombre. Le lot coûte au plus `budget`, partagé à
 * proportion de ce qui manque, chaque nombre arrondi à la dizaine supérieure sauf pour finir (`need`) ; une dizaine
 * de l'unité qui manque le plus si tout s'arrondit à zéro.
 */
function splitBatch(items, budget) {
  const out = new Map(items.map((i) => [i.key, i.need]));
  const total = items.reduce((n, i) => n + i.need * i.price, 0);
  if (total <= budget || !items.length) return out;
  const k = budget / total;
  for (const i of items) out.set(i.key, Math.min(i.need, Math.ceil(Math.floor(i.need * k) / 10) * 10));
  if (![...out.values()].some((n) => n > 0)) {
    const most = items.reduce((x, y) => (y.need > x.need ? y : x), items[0]);
    out.set(most.key, Math.min(most.need, 10));
  }
  return out;
}

// Modèles de troupes système (forums de GT) : des armées complètes pour une ferme 30 avec les bâtiments ci-dessus
// (environ 20 700 places). Ceux qui demandent une unité absente du monde (archers) ne sont pas proposés.
const TROOPS = [
  { key: 'sys:nuke', name: 'Offensif (nuke)', description: 'Haches, cavalerie légère et béliers : la nuke classique.', units: { axe: 6500, light: 3000, ram: 300, spy: 100 } },
  { key: 'sys:nuke-archers', name: 'Offensif avec archers montés', description: 'Nuke des mondes à archers.', units: { axe: 6000, light: 2300, marcher: 750, ram: 220, spy: 100 } },
  { key: 'sys:def', name: 'Défensif fixe', description: 'Lanciers et porteurs d’épée : la meilleure défense générale pour un village qui ne bouge pas.', units: { spear: 8900, sword: 10700, spy: 500, ram: 20 } },
  { key: 'sys:def-mobile', name: 'Défensif mobile', description: 'Lanciers et cavalerie lourde : plus rapide à produire et à déplacer en soutien.', units: { spear: 9000, heavy: 1900, spy: 100 } },
  { key: 'sys:def-archers', name: 'Défensif avec archers', description: 'Défense des mondes à archers.', units: { spear: 5700, archer: 2850, heavy: 2000, spy: 25, ram: 10, catapult: 10 } },
  { key: 'sys:scouts', name: 'Éclaireurs', description: 'Village d’espionnage : 10 000 éclaireurs.', units: { spy: 10000 } },
].map((t) => Object.freeze({ ...t, system: true, popBuffer: 0, resBuffer: 0, batchCost: BATCH_COST }));
const TROOPS_BY_KEY = new Map(TROOPS.map((t) => [t.key, t]));

/** Modèle de troupes système d'une clé ('sys:nuke'), ou nul. */
const troopSystem = (key) => TROOPS_BY_KEY.get(key) || null;

/** Modèles de troupes système possibles sur un monde (toutes leurs unités y existent). */
function troopsFor(cfg) {
  const registry = require('./registry');
  const ids = new Set(registry.unitsFor(cfg).map((u) => u.id));
  return TROOPS.filter((t) => Object.keys(t.units).every((id) => ids.has(id)));
}

const BY_KEY = new Map(SYSTEM.map((t) => [t.key, t]));

/** Modèle système d'une clé ('sys:resources'), ou nul. */
const system = (key) => BY_KEY.get(key) || null;

/**
 * Niveaux visés à la fin d'une liste, par bâtiment ({ main: 20, … }) : le plus haut niveau demandé pour chacun.
 * `base` : niveaux de départ (bâtiments déjà là dans un nouveau village), gardés quand la liste ne les monte pas.
 */
function targets(steps, base = {}) {
  const out = { ...base };
  for (const s of steps) out[s.building] = Math.max(out[s.building] || 0, s.level);
  return out;
}

/**
 * Étapes d'une liste avec leur nombre de niveaux (« +3 → 10 ») à partir des niveaux de départ `base` : chaque
 * étape compte depuis le niveau atteint par les précédentes. Une étape déjà couverte compte 0.
 */
function withLevels(steps, base = {}, counted = null) {
  const reached = { ...base };
  // `counted` : bâtiments existant sur le monde ; les autres n'entrent pas dans les points et la population.
  const only = (levels) => (counted ? Object.fromEntries(Object.entries(levels).filter(([id]) => counted.has(id))) : levels);
  return steps.map((s) => {
    const from = reached[s.building] || 0;
    reached[s.building] = Math.max(from, s.level);
    return { ...s, levels: Math.max(0, s.level - from), ...stats(only(reached)) };
  });
}

/**
 * Ce que donnent des niveaux de bâtiments ({ main: 20, … }) : points du village, population prise par les bâtiments,
 * capacité de la ferme (sans sceau) et place qui reste pour les troupes.
 */
function stats(levels) {
  const registry = require('./registry');
  const formulas = require('./formulas');
  let points = 0;
  let pop = 0;
  for (const [id, level] of Object.entries(levels)) {
    const type = registry.BUILDINGS.get(id);
    if (!type || !level) continue;
    points += type.pointsAt(level);
    pop += type.popAt(level);
  }
  const farm = formulas.farmCapacity(Math.max(1, levels.farm || 0));
  return { points, pop, farm, free: farm - pop };
}

/** Ce que coûtent des troupes ({ spear: 100, … }) : population prise à la ferme et ressources. */
function troopStats(units) {
  const registry = require('./registry');
  const out = { pop: 0, wood: 0, stone: 0, iron: 0 };
  for (const [id, n] of Object.entries(units || {})) {
    const type = registry.UNITS.get(id);
    if (!type || !(n > 0)) continue;
    out.pop += type.pop * n;
    for (const r of ['wood', 'stone', 'iron']) out[r] += type.cost[r] * n;
  }
  return out;
}

/**
 * Aperçu d'un lot d'un modèle de troupes sur un monde : par bâtiment de recrutement, les unités d'un lot quand le
 * village n'a encore rien. `types` : unités recrutables du monde. @returns [{ building, units: [[id, n]], cost }]
 */
function batchPreview(units, budget, types) {
  const price = (t) => t.cost.wood + t.cost.stone + t.cost.iron;
  const out = [];
  for (const building of [...new Set(types.map((t) => t.building))]) {
    const items = types.filter((t) => t.building === building && units[t.id] > 0).map((t) => ({ key: t.id, need: units[t.id], price: price(t), type: t }));
    if (!items.length) continue;
    const split = splitBatch(items, budget);
    const list = items.map((i) => [i.key, split.get(i.key)]).filter(([, n]) => n > 0);
    out.push({ building, units: list, cost: items.reduce((n, i) => n + split.get(i.key) * i.price, 0) });
  }
  return out;
}

module.exports = {
  SYSTEM, TROOPS, BATCH_COST, BATCH_COST_MIN, BATCH_COST_MAX, system, troopSystem, troopsFor, targets, withLevels, stats, troopStats,
  batchCostOf, splitBatch, batchPreview,
};
