'use strict';

// Collecte (scavenging). Formule de durée utilisée par les calculateurs de la communauté :
//   durée = ((capacité² × 100 × taux²)^0.45 + 1800) × vitesse^-0.55   (secondes)
// Butin = capacité × taux, réparti à parts égales entre bois, argile et fer.

const UNITS = ['spear', 'sword', 'axe', 'archer', 'light', 'marcher', 'heavy', 'knight'];

const registry = require('./registry');

/** Unités du monde autorisées à collecter. */
function unitsFor(world) {
  return UNITS.map((id) => registry.unit(id)).filter((u) => u.isAvailableIn(world));
}

function capacity(units) {
  return Object.entries(units).reduce((n, [id, c]) => (UNITS.includes(id) ? n + registry.unit(id).carry * c : n), 0);
}

function duration(cap, lootFactor, world) {
  return Math.round((Math.pow(cap * cap * 100 * lootFactor * lootFactor, 0.45) + 1800) * Math.pow(world.speed, -0.55));
}

function haul(cap, lootFactor) {
  const total = Math.floor(cap * lootFactor);
  const third = Math.floor(total / 3);
  return { wood: total - 2 * third, stone: third, iron: third };
}

module.exports = { UNITS, unitsFor, capacity, duration, haul };
