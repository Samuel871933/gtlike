'use strict';

const { MODES, modeIdOf } = require('../modes/catalog');

// Libellés d'un monde, communs à l'accueil (views/worlds.ejs) et à la liste des serveurs (views/servers.ejs) :
// type et accès, modules, sous-titre, ancienneté.

const VICTORY_NAMES = { dominance: 'Domination', pointsVillages: 'Points et villages', runes: 'Guerres runiques', siege: 'Grand Siège', none: 'aucune' };
// Position de départ sur la carte (MapPlacer.DIRECTIONS).
const DIRECTION_NAMES = { random: 'Aléatoire', nw: 'Nord-Ouest', ne: 'Nord-Est', sw: 'Sud-Ouest', se: 'Sud-Est' };
const FEATURE_NAMES = { knight: 'paladin', archer: 'archers', militia: 'milice', church: 'église', seals: 'sceaux' };

/** Modules actifs d'un monde (paladin, archers, milice, église, factions). */
const worldModules = (cfg) => [
  ...Object.entries(cfg.features).filter(([, on]) => on).map(([k]) => FEATURE_NAMES[k] || k),
  ...(cfg.factions.active ? ['factions'] : []),
];

/** « Vitesse ×100 · paladin, archers » ou « Vitesse ×1 · classique ». */
function worldSubtitle(world) {
  const cfg = world.getConfig();
  const m = worldModules(cfg);
  const mode = modeIdOf(cfg);
  return `${mode === 'classic' ? '' : `${MODES[mode].name} · `}Vitesse ×${cfg.speed} · ${m.length ? m.join(', ') : 'classique'}`;
}

/** Type d'un monde : officiel, ou serveur privé ouvert / sur code. */
const worldType = (world) => (world.access === 'code' ? 'Privé, sur code' : world.access ? 'Privé, ouvert' : 'Officiel');

/** Ancienneté : « créé à l'instant », « depuis 5 h », « depuis 3 jours ». */
function worldAge(world, now = new Date()) {
  const h = Math.floor((now - new Date(world.createdAt)) / 3600000);
  if (h < 1) return 'créé à l’instant';
  if (h < 24) return `depuis ${h} h`;
  const d = Math.floor(h / 24);
  return `depuis ${d} jour${d > 1 ? 's' : ''}`;
}

module.exports = { VICTORY_NAMES, DIRECTION_NAMES, worldModules, worldSubtitle, worldType, worldAge };
