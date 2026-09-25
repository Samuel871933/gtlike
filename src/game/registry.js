'use strict';

const BuildingType = require('./BuildingType');
const UnitType = require('./UnitType');

const BUILDINGS = new Map(require('./data/buildings').map((d) => [d.id, new BuildingType(d)]));
const UNITS = new Map(require('./data/units').map((d) => [d.id, new UnitType(d)]));

const ITEMS = new Map(require('./data/items').map((d) => [d.id, Object.freeze({ ...d })]));

/** Armes du paladin disponibles sur ce monde (sans celles liées aux archers si le module est absent). */
function itemsFor(world) {
  return [...ITEMS.values()].filter((i) => world.hasFeature(i.feature));
}

// Bâtiments disposant d'une file de recrutement dans cette version.
const RECRUIT_BUILDINGS = ['barracks', 'stable', 'garage', 'snob', 'statue'];

function building(id) {
  const b = BUILDINGS.get(id);
  if (!b) throw new Error(`Bâtiment inconnu : ${id}`);
  return b;
}

function unit(id) {
  const u = UNITS.get(id);
  if (!u) throw new Error(`Unité inconnue : ${id}`);
  return u;
}

function buildingsFor(world) {
  return [...BUILDINGS.values()].filter((b) => b.isAvailableIn(world));
}

function unitsFor(world, recruitBuilding) {
  return [...UNITS.values()].filter(
    (u) => u.isAvailableIn(world) && (!recruitBuilding || u.building === recruitBuilding),
  );
}

module.exports = { BUILDINGS, UNITS, ITEMS, RECRUIT_BUILDINGS, building, unit, buildingsFor, unitsFor, itemsFor };
