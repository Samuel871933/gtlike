'use strict';

// Sceaux (les « drapeaux » de Guerre Tribale), module de monde `features.seals` : 8 types sur 9 niveaux, un sceau au
// plus par village, qui donne son bonus à ce village. Les sceaux appartiennent au compte (table Seals) et servent sur
// tous les mondes où le module est actif ; ils ne se gagnent que sur les mondes officiels (voir SealService).
// Bonus repris du wiki de Guerre Tribale (« Drapeaux »), niveau 1 à 9.

const TYPES = [
  { id: 'production', name: 'Production de ressources', short: 'Production', icon: 'wood', unit: '+', values: [4, 6, 8, 10, 12, 14, 16, 17, 18], effect: (v) => `+${v} % de production de ressources` },
  { id: 'recruit', name: 'Vitesse de recrutement', short: 'Recrutement', icon: 'clock', unit: '+', values: [6, 8, 10, 12, 14, 16, 18, 19, 20], effect: (v) => `+${v} % de vitesse de recrutement` },
  { id: 'attack', name: 'Force d’attaque', short: 'Attaque', icon: 'sword', unit: '+', values: [2, 3, 4, 5, 6, 7, 8, 9, 10], effect: (v) => `+${v} % de force d’attaque des troupes parties de ce village` },
  { id: 'defense', name: 'Force défensive', short: 'Défense', icon: 'wall', unit: '+', values: [2, 3, 4, 5, 6, 7, 8, 9, 10], effect: (v) => `+${v} % de défense du village, soutiens compris` },
  { id: 'luck', name: 'Chance', short: 'Chance', icon: 'star', unit: '', values: [6, 8, 10, 12, 14, 16, 18, 19, 20], effect: (v) => `Chance des attaques de ce village ramenée de ${v} points vers 0` },
  { id: 'population', name: 'Capacité de population', short: 'Population', icon: 'pop', unit: '+', values: [2, 3, 4, 5, 6, 7, 8, 9, 10], effect: (v) => `+${v} % de population à la ferme` },
  { id: 'coin', name: 'Coût réduit des pièces', short: 'Pièces d’or', icon: 'coin', unit: '−', values: [10, 12, 14, 16, 18, 20, 22, 23, 24], effect: (v) => `−${v} % sur le coût des pièces d’or` },
  { id: 'haul', name: 'Capacité de charge', short: 'Charge', icon: 'market', unit: '+', values: [2, 3, 4, 5, 6, 7, 8, 9, 10], effect: (v) => `+${v} % de butin pour les attaques de ce village` },
];
const MAX_LEVEL = 9;
// Couleur de chaque niveau (cire du sceau), du gris au noir comme les drapeaux de GT.
const LEVEL_COLORS = ['#8b9097', '#9b6b3c', '#a3322b', '#c9a33a', '#3f8a3c', '#2f5fa6', '#2a8c8c', '#7a4bb0', '#2b2b33'];
const LEVEL_NAMES = ['gris', 'bronze', 'rouge', 'or', 'vert', 'bleu', 'turquoise', 'pourpre', 'noir'];

const BY_ID = new Map(TYPES.map((t) => [t.id, t]));
const isType = (id) => BY_ID.has(id);
const type = (id) => BY_ID.get(id) || null;
const isLevel = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL;

/** Valeur (en %) d'un sceau. */
const value = (typeId, level) => (BY_ID.get(typeId) && isLevel(level) ? BY_ID.get(typeId).values[level - 1] : 0);

/** Sceau actif d'un village { type, level } (nul si le module est éteint ou s'il n'y en a pas). */
function of(village, cfg) {
  if (!cfg || !cfg.features || !cfg.features.seals || !village || !isType(village.sealType) || !isLevel(village.sealLevel)) return null;
  return { type: village.sealType, level: village.sealLevel };
}

/** Bonus (fraction) d'un type donné si le sceau est de ce type, sinon 0. */
const bonus = (seal, typeId) => (seal && seal.type === typeId ? value(typeId, seal.level) / 100 : 0);

/** Chance ramenée vers 0 de `points` (6 % au niveau 1) : ±20 % avec un sceau de 6 → ±14 %. */
function reduceLuck(luck, seal) {
  const cut = bonus(seal, 'luck');
  if (!cut) return luck;
  return Math.sign(luck) * Math.max(0, Math.abs(luck) - cut);
}

/** Libellé court « Production 3 ». */
const label = (seal) => (seal ? `${type(seal.type).short} ${seal.level}` : '');

module.exports = { TYPES, MAX_LEVEL, LEVEL_COLORS, LEVEL_NAMES, isType, type, isLevel, value, of, bonus, reduceLuck, label };
