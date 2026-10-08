'use strict';

// Récompenses de construction (réglages `buildRewards` du monde, comme sur Guerre Tribale) : un niveau de bâtiment
// construit pour la première fois par un joueur sur le monde rend `percent` de son coût, au moins `min` et au plus
// `max` de chaque ressource. Seulement pendant les `days` premiers jours du monde (0 : toute la partie).

const registry = require('./registry');

const DAY = 86400000;

/** Le monde donne-t-il encore des récompenses à cette date ? */
function active(cfg, world, at = new Date()) {
  const r = cfg.buildRewards;
  if (!r || !r.active) return false;
  return !r.days || new Date(at) - new Date(world.createdAt) < r.days * DAY;
}

/** Fin de la période des récompenses (null si elles durent toute la partie). */
function endsAt(cfg, world) {
  const r = cfg.buildRewards;
  return r && r.days ? new Date(new Date(world.createdAt).getTime() + r.days * DAY) : null;
}

/** Récompense d'un niveau : { wood, stone, iron }. */
function amount(building, level, cfg) {
  const { percent, min, max } = cfg.buildRewards;
  const cost = registry.building(building).costFor(level);
  const out = {};
  for (const r of ['wood', 'stone', 'iron']) out[r] = Math.min(max, Math.max(min, Math.round(cost[r] * percent)));
  return out;
}

module.exports = { active, endsAt, amount };
