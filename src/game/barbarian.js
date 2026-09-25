'use strict';

// Croissance des villages barbares : ils gagnent des points au rythme de
// `barbarian.growthPerDay × vitesse du monde`, en montant des bâtiments au hasard
// (les mines plus souvent), jusqu'à `barbarian.maxPoints`.

const registry = require('./registry');

// Poids de tirage : les barbares développent surtout leurs mines, comme sur Guerre Tribale.
const WEIGHTS = { wood: 4, stone: 4, iron: 4, storage: 2, farm: 2, main: 2, wall: 1, hide: 1, barracks: 1 };
const LEVEL_CAP = 20;

function candidates(state) {
  const out = [];
  for (const [id, weight] of Object.entries(WEIGHTS)) {
    const type = registry.building(id);
    const level = state.level(id);
    if (level >= Math.min(type.maxLevel, LEVEL_CAP)) continue;
    if (type.missingRequirements(state.buildings).length) continue;
    out.push({ type, weight, points: type.pointsAt(level + 1) - type.pointsAt(level) });
  }
  return out;
}

function pick(list, rng) {
  const total = list.reduce((n, c) => n + c.weight, 0);
  let r = rng() * total;
  for (const c of list) {
    r -= c.weight;
    if (r < 0) return c;
  }
  return list[list.length - 1];
}

/**
 * Fait grandir un village barbare entre `from` et `to`.
 * Les points non dépensés restent « en réserve » : la date renvoyée n'avance que
 * du temps réellement consommé, pour que les petites périodes finissent par compter.
 * @returns {Date} nouvelle date de référence de la croissance
 */
function grow(state, from, to, world, rng = Math.random) {
  const { growthPerDay, maxPoints } = world.barbarian;
  const perMs = (growthPerDay * world.speed) / 86400000;
  if (perMs <= 0) return to;
  let budget = (to - from) * perMs;
  let spent = 0;
  for (;;) {
    const points = state.points();
    if (points >= maxPoints) return to; // plafond atteint : rien à mettre en réserve
    const list = candidates(state).filter((c) => c.points <= budget && points + c.points <= maxPoints);
    if (!list.length) break;
    const c = pick(list, rng);
    state.buildings[c.type.id] = state.level(c.type.id) + 1;
    budget -= c.points;
    spent += c.points;
  }
  return new Date(from.getTime() + spent / perMs);
}

module.exports = { grow, WEIGHTS };
