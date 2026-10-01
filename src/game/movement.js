'use strict';

const registry = require('./registry');

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unité la plus lente d'un groupe (elle fixe la vitesse de tout le groupe). */
function slowestUnit(units) {
  let slowest = null;
  for (const [id, n] of Object.entries(units)) {
    if (n > 0 && (!slowest || registry.unit(id).speed > slowest.speed)) slowest = registry.unit(id);
  }
  return slowest;
}

/**
 * Durée du trajet en secondes : distance × minutes par case de l'unité la plus lente.
 * Un soutien (ou son retour) qui accompagne le paladin avance à la vitesse du paladin.
 */
function travelSeconds(units, from, to, world, { withKnightSpeed = false } = {}) {
  const pace = withKnightSpeed && units.knight > 0 ? registry.unit('knight') : slowestUnit(units);
  if (!pace) return 0;
  return Math.round(distance(from, to) * pace.minutesPerField(world) * 60);
}

/**
 * Heure d'arrivée des troupes et des marchands (`ms` : instant exact, en millisecondes) arrondie à la précision du monde
 * (`arrivalStepMs`), à la tranche supérieure : à 100 ms, une arrivée à 12:00:00:926 tombe à 12:00:01:000.
 * 1 : à la milliseconde près, comme sur Guerre Tribale.
 */
function arrivalAt(ms, world) {
  const step = Math.max(1, world.arrivalStepMs || 1);
  return new Date(Math.ceil(ms / step) * step);
}

module.exports = { distance, slowestUnit, travelSeconds, arrivalAt };
