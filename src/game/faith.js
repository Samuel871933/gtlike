'use strict';

// Foi (mondes avec église, comme sur Guerre Tribale) : un village est « croyant » s'il est dans la zone d'influence
// d'une église de son propriétaire (les églises de la tribu ou des alliés ne comptent pas). Hors de toute zone, ses
// troupes se battent avec cfg.church.faithless de leur force : en attaque depuis ce village, en défense de ce village
// (soutiens compris). Villages barbares : toujours à pleine force.

/** Rayon d'influence (cases) des églises d'un village (niveaux de bâtiments), 0 sans église. */
function radiusOf(buildings, cfg) {
  if (!cfg.hasFeature('church') || !buildings) return 0;
  const level = Math.min(buildings.church || 0, cfg.church.radius.length - 1);
  return Math.max(cfg.church.radius[level] || 0, buildings.church_f ? cfg.church.firstRadius : 0);
}

/** Églises d'une liste de villages : [{ x, y, radius }] (villages sans église exclus). */
function churchesOf(villages, cfg) {
  return villages.map((v) => ({ x: v.x, y: v.y, radius: radiusOf(v.buildings, cfg) })).filter((c) => c.radius > 0);
}

/** Le point (x, y) est-il dans la zone d'une de ces églises ? (distance à vol d'oiseau, comme les cercles de la carte) */
function covered(x, y, churches) {
  return churches.some((c) => Math.hypot(c.x - x, c.y - y) <= c.radius);
}

/**
 * Facteur de force des troupes d'un village : 1, ou cfg.church.faithless hors zone. `churches` : églises de son
 * propriétaire ; `village` : { x, y, playerId }.
 */
function factorFor(village, churches, cfg) {
  if (!cfg.hasFeature('church') || !village.playerId) return 1;
  return covered(village.x, village.y, churches) ? 1 : cfg.church.faithless;
}

module.exports = { radiusOf, churchesOf, covered, factorFor };
