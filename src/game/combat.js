'use strict';

// Résolution d'un combat, sans base de données.
//
// Formules vérifiées (wiki officiel TW / DS) :
//  - défense de base du village : 20 + 50 × muraille, puis tout ×1.037^muraille
//  - défense pondérée selon la part d'attaque infanterie / cavalerie / archers
//  - pertes : le perdant perd tout, le gagnant perd (force perdant / force gagnant)^1.5
//  - chance ±25 % sur l'attaque, morale = 3 × pts défenseur / pts attaquant + 0.3 (30 à 100 %)
//  - bonus de nuit : défense × facteur (pas contre les barbares)
//  - éclaireurs : infos selon la part de survivants (1 → troupes, 50 % → ressources, 70 % → bâtiments)
//
// Approximations à calibrer (formules exactes non publiées) : constantes RAM_DIVISOR et
// CATAPULT_DIVISOR, pertes des éclaireurs.

const registry = require('./registry');

const RAM_DIVISOR = 4; // béliers : niveaux = n × 2 / (4 × 1.09^niveau) ; ≈ 22 béliers par niveau avant combat au mur 20
const CATAPULT_DIVISOR = 200; // catapultes : niveaux = n × 100 / (200 × 1.09^niveau)
const UNDESTROYABLE = new Set(['hide']);
const MIN_LEVEL_ONE = new Set(['main', 'farm', 'storage']);

function sumBy(units, fn) {
  let total = 0;
  for (const [id, n] of Object.entries(units)) if (n > 0) total += fn(registry.unit(id)) * n;
  return total;
}

function scale(units, ratio) {
  const out = {};
  for (const [id, n] of Object.entries(units)) if (n > 0) out[id] = Math.round(n * ratio);
  return out;
}

/** Morale de l'attaquant (1 = 100 %). Les villages barbares donnent toujours 100 %. */
function morale(attackerPoints, defenderPoints, enabled = true) {
  if (!enabled || defenderPoints == null || attackerPoints <= 0) return 1;
  return Math.min(1, Math.max(0.3, (3 * defenderPoints) / attackerPoints + 0.3));
}

/** Niveaux qu'un groupe d'engins de siège peut abattre sur un bâtiment de niveau `level`. */
function siegeLevels(count, unitId, level, divisor) {
  if (count <= 0) return 0;
  return (count * registry.unit(unitId).attack) / (divisor * Math.pow(1.09, level));
}

/**
 * @param {object} p
 * @param {Object<string, number>} p.attackers unités attaquantes
 * @param {Object<string, number>} p.defenders toutes les unités présentes (village + soutiens)
 * @param {number} p.wall niveau de la muraille
 * @param {number} [p.morale=1]
 * @param {number} [p.luck=0] entre -0.25 et 0.25
 * @param {number} [p.nightFactor=1]
 * @param {{ building: string, level: number } | null} [p.catapultTarget]
 */
/** Bonus cumulés des armes de paladin présentes (une même arme ne compte qu'une fois). */
function itemBonuses(itemIds = []) {
  const bonus = { attack: {}, defense: {}, siege: { ram: 0, catapult: 0 } };
  for (const id of new Set(itemIds)) {
    const item = registry.ITEMS.get(id);
    if (!item) continue;
    if (item.unit) {
      bonus.attack[item.unit] = (bonus.attack[item.unit] || 0) + item.attack;
      bonus.defense[item.unit] = (bonus.defense[item.unit] || 0) + item.defense;
    }
    if (item.siege) for (const [k, v] of Object.entries(item.siege)) bonus.siege[k] += v;
  }
  return bonus;
}

/** Ajoute des bonus de compétences de paladin (knightSkills.bonuses) à des bonus d'armes. */
function mergeBonuses(base, extra) {
  if (!extra) return base;
  const out = { attack: { ...base.attack }, defense: { ...base.defense }, siege: { ...base.siege }, siegeReduction: extra.siegeReduction || 0, wall: extra.wall || 0 };
  for (const [u, v] of Object.entries(extra.attack || {})) out.attack[u] = (out.attack[u] || 0) + v;
  for (const [u, v] of Object.entries(extra.defense || {})) out.defense[u] = (out.defense[u] || 0) + v;
  for (const [k, v] of Object.entries(extra.siege || {})) out.siege[k] = (out.siege[k] || 0) + v;
  return out;
}

function resolve({
  attackers, defenders, wall = 0, morale: mor = 1, luck = 0, nightFactor = 1, catapultTarget = null,
  attackerItems = [], defenderItems = [], attackerSkills = null, defenderSkills = null,
}) {
  const attBonus = mergeBonuses(itemBonuses(attackerItems), attackerSkills);
  const defBonus = mergeBonuses(itemBonuses(defenderItems), defenderSkills);
  const siegeFactor = 1 - (defBonus.siegeReduction || 0);
  const wallBoost = 1 + (defBonus.wall || 0);
  const attSpies = attackers.spy || 0;
  const defSpies = defenders.spy || 0;
  const army = { ...attackers };
  delete army.spy;

  // Éclaireurs : combat séparé, les éclaireurs du défenseur ne meurent pas.
  const spyLossRatio = attSpies > 0 ? Math.min(1, Math.pow(defSpies / attSpies, 1.5)) : 0;
  const spiesLost = Math.round(attSpies * spyLossRatio);

  const attackOf = (u) => u.attack * (1 + (attBonus.attack[u.id] || 0));
  const attByType = {
    infantry: sumBy(army, (u) => (u.type === 'infantry' ? attackOf(u) : 0)),
    cavalry: sumBy(army, (u) => (u.type === 'cavalry' ? attackOf(u) : 0)),
    archer: sumBy(army, (u) => (u.type === 'archer' ? attackOf(u) : 0)),
  };
  const rawAttack = attByType.infantry + attByType.cavalry + attByType.archer;
  const hasArmy = Object.values(army).some((n) => n > 0);

  // Béliers avant le combat : au plus la moitié de leur potentiel, et au plus la moitié du mur.
  const rams = army.ram || 0;
  const ramPotential = siegeLevels(rams, 'ram', wall, RAM_DIVISOR) * (1 + attBonus.siege.ram) * siegeFactor;
  const wallFight = wall - Math.round(Math.min(ramPotential / 2, wall / 2));

  const result = {
    hasBattle: hasArmy,
    attackerWins: false,
    attackStrength: 0,
    defenseStrength: 0,
    attackerLossRatio: 0,
    defenderLossRatio: 0,
    attackerLosses: {},
    defenderLosses: {},
    wallBefore: wall,
    wallFight,
    wallAfter: wall,
    catapult: null,
    spies: { sent: attSpies, lost: spiesLost, survivedRatio: attSpies ? (attSpies - spiesLost) / attSpies : 0 },
    luck,
    morale: mor,
    nightFactor,
  };
  if (attSpies) result.attackerLosses.spy = spiesLost;
  if (!hasArmy) {
    result.attackerWins = attSpies > spiesLost;
    return result;
  }

  const attack = rawAttack * mor * (1 + luck);
  const share = (type) => (rawAttack > 0 ? attByType[type] / rawAttack : 1 / 3);
  const weights = rawAttack > 0 ? { infantry: share('infantry'), cavalry: share('cavalry'), archer: share('archer') } : { infantry: 1, cavalry: 0, archer: 0 };
  const unitDefense = sumBy(defenders, (u) => (u.defense * weights.infantry + u.defenseCavalry * weights.cavalry + u.defenseArcher * weights.archer)
    * (1 + (defBonus.defense[u.id] || 0)));
  // Huile bouillante : la part apportée par la muraille (défense de base et multiplicateur) est renforcée.
  const wallMultiplier = 1 + (Math.pow(1.037, wallFight) - 1) * wallBoost;
  const defense = (unitDefense + 20 + 50 * wallFight * wallBoost) * wallMultiplier * nightFactor;

  result.attackStrength = attack;
  result.defenseStrength = defense;
  result.attackerWins = attack > defense;
  if (result.attackerWins) {
    result.attackerLossRatio = Math.pow(defense / attack, 1.5);
    result.defenderLossRatio = 1;
  } else {
    result.attackerLossRatio = 1;
    result.defenderLossRatio = attack > 0 ? Math.pow(attack / defense, 1.5) : 0;
  }
  Object.assign(result.attackerLosses, scale(army, result.attackerLossRatio));
  result.defenderLosses = scale(defenders, result.defenderLossRatio);

  // Béliers après le combat, selon l'issue.
  const siegeEffect = result.attackerWins ? 1 - result.attackerLossRatio / 2 : result.defenderLossRatio / 2;
  if (rams > 0) {
    result.wallAfter = Math.max(0, Math.min(wallFight, wall - Math.round(ramPotential * siegeEffect)));
  }

  // Catapultes : uniquement après le combat, sur le bâtiment visé.
  const cats = army.catapult || 0;
  if (cats > 0 && catapultTarget && !UNDESTROYABLE.has(catapultTarget.building)) {
    const before = catapultTarget.building === 'wall' ? result.wallAfter : catapultTarget.level;
    const min = MIN_LEVEL_ONE.has(catapultTarget.building) ? 1 : 0;
    const levels = Math.round(siegeLevels(cats, 'catapult', before, CATAPULT_DIVISOR) * (1 + attBonus.siege.catapult) * siegeFactor * siegeEffect);
    const after = Math.max(min, before - levels);
    result.catapult = { building: catapultTarget.building, before, after };
    if (catapultTarget.building === 'wall') result.wallAfter = after;
  }
  return result;
}

/**
 * Pillage : répartit la capacité de transport le plus équitablement possible entre
 * les ressources pillables (au-delà de la cachette).
 */
function loot(resources, hideCapacity, carry) {
  const keys = ['wood', 'stone', 'iron'];
  const available = Object.fromEntries(keys.map((r) => [r, Math.max(0, Math.floor(resources[r] - hideCapacity))]));
  const taken = { wood: 0, stone: 0, iron: 0 };
  let remaining = Math.floor(carry);
  const order = keys.filter((r) => available[r] > 0).sort((a, b) => available[a] - available[b]);
  order.forEach((r, i) => {
    const share = Math.floor(remaining / (order.length - i));
    taken[r] = Math.min(available[r], share);
    remaining -= taken[r];
  });
  return taken;
}

/**
 * Points « adversaires vaincus » pour des unités tuées.
 * @param {'att'|'def'} side 'att' : tuées par un attaquant ; 'def' : tuées par un défenseur.
 */
function killPoints(losses, side) {
  return sumBy(losses, (u) => u.kills[side]);
}

function carryCapacity(units) {
  return sumBy(units, (u) => u.carry);
}

module.exports = { resolve, itemBonuses, loot, morale, carryCapacity, killPoints, siegeLevels, RAM_DIVISOR, CATAPULT_DIVISOR, UNDESTROYABLE };
