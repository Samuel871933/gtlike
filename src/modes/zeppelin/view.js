'use strict';

// Habillage des vues en mode Zeppelin : ces valeurs remplacent, pour les pages d'un monde Zeppelin seulement, les
// helpers de même nom (src/web/helpers.js). Le registre du moteur n'est jamais modifié : les vues reçoivent des copies
// des bâtiments et des unités (mêmes valeurs, mêmes méthodes) dont seuls le nom et la description changent.

const baseRegistry = require('../../game/registry');
const BuildingType = require('../../game/BuildingType');
const UnitType = require('../../game/UnitType');
const helpers = require('../../web/helpers');
const L = require('./labels');

const BUILDINGS = new Map([...baseRegistry.BUILDINGS].map(([id, t]) => {
  const [name, description] = L.BUILDINGS[id] || [t.name, t.description];
  return [id, new BuildingType({ ...t, name, description })];
}));
const UNITS = new Map([...baseRegistry.UNITS].map(([id, t]) => [id, new UnitType({ ...t, name: L.UNITS[id] || t.name })]));

const registry = {
  ...baseRegistry,
  BUILDINGS,
  UNITS,
  building: (id) => BUILDINGS.get(id) || baseRegistry.building(id),
  unit: (id) => UNITS.get(id) || baseRegistry.unit(id),
  buildingsFor: (world) => baseRegistry.buildingsFor(world).map((b) => BUILDINGS.get(b.id)),
  unitsFor: (...args) => baseRegistry.unitsFor(...args).map((u) => UNITS.get(u.id)),
};

// Une unité a une vitesse et une capacité de transport ; un bâtiment non (le noble et l'académie partagent leur id).
const isUnit = (t) => t && t.carry !== undefined && t.speed !== undefined;
const nameOf = (t) => (!t ? '' : isUnit(t) ? L.UNITS[t.id] || t.name : (L.BUILDINGS[t.id] || [t.name])[0]);
const descOf = (t) => (!t ? '' : isUnit(t) ? t.description : (L.BUILDINGS[t.id] || [, t.description])[1]);

const RESOURCES = helpers.RESOURCES.map((r) => ({ ...r, label: L.RESOURCES[r.id] || r.label }));

function resourceIcon(id, cls = 'size-8') {
  const glyph = L.RESOURCE_GLYPHS[id];
  if (!glyph) return helpers.resourceIcon(id, cls);
  return `<span class="zeppelin-resource zeppelin-resource--${id} ${cls} inline-flex shrink-0 items-center justify-center" aria-hidden="true">${glyph}</span>`;
}

// Visuel de chaque bâtiment : un des huit modules illustrés du pont (ceux qui n'ont pas encore leur illustration
// reprennent le module le plus proche).
const ART = {
  main: 'pilotage', wood: 'moteurs', stone: 'condenseur', iron: 'raffinerie', storage: 'cale', smith: 'atelier', farm: 'equipage', stable: 'hangar',
  barracks: 'equipage', garage: 'atelier', snob: 'pilotage', place: 'pilotage', statue: 'hangar', church: 'pilotage', church_f: 'pilotage',
  market: 'cale', hide: 'cale', wall: 'moteurs',
};
const buildingSprite = (id) => `/img/modes/zeppelin/buildings/${ART[id] || 'pilotage'}.webp`;
function buildingImg(id, level, cls = 'h-7 w-8', { alt = '', lazy = false } = {}) {
  const off = level > 0 ? '' : ' opacity-50 grayscale';
  return `<img src="${buildingSprite(id)}" alt="${helpers.esc(alt)}" width="32" height="28"${lazy ? ' loading="lazy"' : ''} class="shrink-0 object-cover${off} ${cls}"${alt ? '' : ' aria-hidden="true"'}>`;
}

// Plan du pont (même format que src/web/villagePlan.js : [x, y du pied, largeur] en % de la scène 3:2). Les huit
// modules illustrés sont posés sur leur dessin ; les autres bâtiments n'ont qu'une étiquette sur le pont.
const ILLUSTRATED = ['main', 'wood', 'stone', 'iron', 'storage', 'smith', 'farm', 'stable'];
const SPOTS = {
  main: [26, 76, 23], wood: [86, 16, 15], stone: [49, 35, 20], iron: [64, 21, 17], storage: [54, 68, 21], smith: [34, 50, 22], farm: [69, 50, 21], stable: [81, 32, 22],
  place: [44, 61, 8], barracks: [58, 44, 8], garage: [65, 60, 8], snob: [78, 58, 8], market: [45, 82, 8], hide: [62, 80, 8], statue: [17, 88, 8],
};
const VILLAGE_PLAN = { ...helpers.VILLAGE_PLAN, SPOTS, WALL_SPOT: [72, 72, 8], CHURCH_SPOT: [31, 63, 8], ILLUSTRATED };

/** Barre d'accès rapide : mêmes favoris, noms du mode. */
function favoriteEntries(player, ctx) {
  return helpers.favoriteEntries(player, ctx).map((f) => {
    if (!f.id) return f;
    const base = baseRegistry.building(f.id).name;
    const name = registry.building(f.id).name;
    return { ...f, name: f.tab ? f.name : name, title: f.title.replace(base, name) };
  });
}

module.exports = {
  registry, nameOf, descOf, RESOURCES, resourceIcon, buildingImg, buildingSprite, VILLAGE_PLAN, favoriteEntries,
  buildingName: (id) => registry.building(id).name,
  unitName: (id) => registry.unit(id).name,
};
