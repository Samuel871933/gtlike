'use strict';

// Paladin à compétences (système de 2016, wiki DS « Paladin-skills »).
// 12 compétences × 4 paliers ; chaque palier coûte un livre (1 livre par niveau, 30 au maximum)
// et demande un niveau de paladin : 1, 8, 16, 24.

const TIER_LEVELS = [1, 8, 16, 24];
const MAX_LEVEL = 30;

// Nombre de paladins autorisés selon le nombre de villages.
const KNIGHT_SLOTS = [[100, 10], [80, 9], [65, 8], [50, 7], [35, 6], [20, 5], [10, 4], [5, 3], [3, 2], [1, 1]];

const P30 = [0.05, 0.1, 0.15, 0.3];
const P15 = [0.03, 0.06, 0.09, 0.15];

// scope : attack (le paladin accompagne l'attaque), village (stationné chez lui), defense (dans le village attaqué).
const SKILLS = [
  { id: 'assault', name: 'Assaut', branch: 'Offensif', scope: 'attack', effect: { attack: 'axe' }, values: P30, text: 'Force des guerriers à la hache' },
  { id: 'cavalry', name: 'Cavalerie', branch: 'Offensif', scope: 'attack', effect: { attack: 'light' }, values: P30, text: 'Force de la cavalerie légère' },
  { id: 'destruction', name: 'Destruction', branch: 'Offensif', scope: 'attack', effect: { siege: 'catapult' }, values: P30, text: 'Dégâts des catapultes' },
  { id: 'ramming', name: 'Bélier', branch: 'Offensif', scope: 'attack', effect: { siege: 'ram' }, values: P30, text: 'Dégâts des béliers' },
  { id: 'motivation', name: 'Motivation', branch: 'Village', scope: 'village', effect: { production: true }, values: P15, text: 'Production de ressources' },
  { id: 'architecture', name: 'Architecture', branch: 'Village', scope: 'village', effect: { buildSpeed: true }, values: P15, text: 'Vitesse de construction' },
  { id: 'instruction', name: 'Instruction', branch: 'Village', scope: 'village', effect: { recruitSpeed: true }, values: P15, text: 'Vitesse de recrutement' },
  { id: 'persuasion', name: 'Persuasion', branch: 'Village', scope: 'village', effect: { loyalty: true }, values: [2, 4, 6, 10], flat: true, text: 'Perte de loyauté infligée par les nobles partis du village' },
  { id: 'swordsmanship', name: 'Escrime', branch: 'Défensif', scope: 'defense', effect: { defense: 'sword' }, values: P30, text: 'Défense des porte-épées' },
  { id: 'phalanx', name: 'Phalange', branch: 'Défensif', scope: 'defense', effect: { defense: 'spear' }, values: P30, text: 'Défense des lanciers' },
  { id: 'fortification', name: 'Fortification', branch: 'Défensif', scope: 'defense', effect: { siegeReduction: true }, values: [0.1, 0.2, 0.3, 0.5], text: 'Résistance des bâtiments aux engins de siège' },
  { id: 'boilingOil', name: 'Huile bouillante', branch: 'Défensif', scope: 'defense', effect: { wall: true }, values: P15, text: 'Efficacité de la muraille' },
];
const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

/** Expérience totale nécessaire pour atteindre le niveau `level` (non publiée : estimation). */
function xpForLevel(level) {
  return 1000 * (level - 1) ** 2;
}

function levelForXp(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

function maxKnights(villageCount) {
  const row = KNIGHT_SLOTS.find(([villages]) => villageCount >= villages);
  return row ? row[1] : 0;
}

function booksSpent(skills) {
  return Object.values(skills || {}).reduce((n, t) => n + t, 0);
}

/** Pourquoi le paladin ne peut pas apprendre le palier suivant de `skillId` (null s'il peut). */
function learnBlocker(knight, skillId) {
  const skill = BY_ID.get(skillId);
  if (!skill) return 'Compétence inconnue.';
  const tier = (knight.skills[skillId] || 0) + 1;
  if (tier > 4) return 'Palier maximal atteint.';
  if (knight.level < TIER_LEVELS[tier - 1]) return `Niveau ${TIER_LEVELS[tier - 1]} requis.`;
  if (knight.level - booksSpent(knight.skills) < 1) return 'Aucun livre de compétence disponible.';
  return null;
}

/**
 * Bonus d'un ensemble de paladins pour un usage donné. Plusieurs paladins avec la même
 * compétence ne s'additionnent pas : seul le meilleur palier compte (wiki).
 * @returns {{ attack, defense, siege, siegeReduction, wall, production, buildSpeed, recruitSpeed, loyalty }}
 */
function bonuses(knights, scope) {
  const best = {};
  for (const k of knights) {
    for (const [id, tier] of Object.entries(k.skills || {})) {
      const skill = BY_ID.get(id);
      if (!skill || skill.scope !== scope || !tier) continue;
      best[id] = Math.max(best[id] || 0, skill.values[tier - 1]);
    }
  }
  const out = { attack: {}, defense: {}, siege: { ram: 0, catapult: 0 }, siegeReduction: 0, wall: 0, production: 0, buildSpeed: 0, recruitSpeed: 0, loyalty: 0 };
  for (const [id, value] of Object.entries(best)) {
    const e = BY_ID.get(id).effect;
    if (e.attack) out.attack[e.attack] = value;
    if (e.defense) out.defense[e.defense] = value;
    if (e.siege) out.siege[e.siege] = value;
    if (e.siegeReduction) out.siegeReduction = value;
    if (e.wall) out.wall = value;
    if (e.production) out.production = value;
    if (e.buildSpeed) out.buildSpeed = value;
    if (e.recruitSpeed) out.recruitSpeed = value;
    if (e.loyalty) out.loyalty = value;
  }
  return out;
}

module.exports = { SKILLS, TIER_LEVELS, MAX_LEVEL, xpForLevel, levelForXp, maxKnights, booksSpent, learnBlocker, bonuses };
