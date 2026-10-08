'use strict';

// Matchup : parties compétitives courtes (1v1 à 5v5, une vingtaine de minutes) sur un petit monde très rapide créé pour
// la partie, avec un elo par classement (duel pour le 1v1, équipe pour le 2v2 à 5v5) et des ligues.
// Règles pures (sans base) : formats, réglages du monde, placement, score, elo et ligues. Voir services/MatchService.js.

/** Formats : taille d'une équipe. */
const FORMATS = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4, '5v5': 5 };
const isFormat = (f) => Object.hasOwn(FORMATS, f);

/** Classements : le duel (1v1) à part, les parties en équipe (2v2 à 5v5) ensemble. */
const LADDERS = { duel: 'Duel', team: 'Équipe' };
const ladderOf = (format) => (FORMATS[format] === 1 ? 'duel' : 'team');

// Durée maximale d'une partie : la conquête l'arrête souvent avant ; sinon l'équipe qui a le plus de points gagne.
const MATCH_MINUTES = 25;
// Les deux équipes : tribus créées pour la partie (attaque interdite entre coéquipiers).
const TEAMS = [
  { n: 1, name: 'Équipe bleue', tag: 'BLEU', short: 'Bleus' },
  { n: 2, name: 'Équipe rouge', tag: 'ROUGE', short: 'Rouges' },
];

/**
 * Réglages du monde d'une partie : tout va vite. Vitesse ×600 pour l'économie comme pour les troupes (un bélier
 * traverse la carte en 50 s environ, une hache en 30 s), villages de départ développés (académie construite, mines 22)
 * et petite armée : on attaque dès la première seconde. Nobles moins chers et loyauté qui tombe plus vite : deux nobles
 * prennent un village. Sans archers, archers montés ni paladin ; les équipes sont les seules tribus (pas d'autre
 * tribu à créer, voir TribeService.assertTeamsOpen). Rien à gagner pour le compte hors de l'elo : ni quêtes,
 * ni récompenses de construction, ni succès, ni sceaux (SealService.canEarn), ni succès quotidiens.
 */
function worldConfig() {
  return {
    speed: 600,
    unitSpeed: 1,
    mapSize: 100,
    newbieDays: 0,
    moral: false,
    luck: 0.15,
    tech: 'none',
    features: { archer: false, knight: false, church: false, militia: false, seals: false },
    freeFinishSeconds: 5,
    commandCancelSeconds: 30,
    buildRewards: { active: false },
    tutorial: { active: false },
    achievements: { active: false },
    scavenging: { active: false },
    sitter: { allow: false },
    bots: { count: 0 },
    placement: { emptyVillages: 0 },
    barbarian: { growthPerDay: 0, troops: false },
    tribe: { memberLimit: 5, noHarm: true, supportOnlyTribe: true },
    victory: { type: 'none' },
    startBuildings: {
      main: 20, barracks: 20, stable: 15, garage: 5, snob: 1, smith: 20, place: 1, market: 10,
      wood: 22, stone: 22, iron: 22, farm: 25, storage: 25, hide: 3, wall: 10,
    },
    startResources: { wood: 40000, stone: 40000, iron: 40000 },
    snob: { coin: { wood: 8000, stone: 9000, iron: 7000 }, loyaltyLossMin: 40, loyaltyLossMax: 60 },
  };
}

/** Armée de départ de chaque joueur. */
const START_UNITS = { spear: 600, sword: 400, axe: 600, spy: 20, light: 250, ram: 20 };

/**
 * Emplacements des villages de départ et des barbares, au centre `c` d'une carte : les bleus à l'ouest, les rouges à
 * l'est (16 cases entre les deux lignes), coéquipiers espacés de 4 cases ; deux barbares par joueur entre les lignes.
 */
function layout(teamSize, c) {
  const spots = []; const barbs = [];
  for (const team of [1, 2]) {
    const side = team === 1 ? -1 : 1;
    for (let i = 0; i < teamSize; i++) {
      const y = c + Math.round((i - (teamSize - 1) / 2) * 4);
      spots.push({ team, slot: i, x: c + side * 8, y });
      barbs.push({ x: c + side * 4, y }, { x: c + side * 2, y: y + 1 });
    }
  }
  return { spots, barbs };
}

/** Score d'une équipe à la fin du temps : points des joueurs (villages, bâtiments) et adversaires vaincus. */
const teamScore = (players) => players.reduce((s, p) => s + p.points + p.killsAttacker + p.killsDefender + p.killsSupporter, 0);

// ------------------------------------------------------------------------------------------------------------- Elo

const START_ELO = 1000;
// Premières parties (placement) : l'elo bouge davantage, le temps de trouver son niveau.
const PLACEMENT_GAMES = 5;
const K_PLACEMENT = 48;
const K_NEW = 32;
const K = 24;

/** Résultat attendu (0 à 1) d'une équipe d'elo moyen `a` contre une équipe d'elo moyen `b`. */
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
const kFactor = (games) => (games < PLACEMENT_GAMES ? K_PLACEMENT : games < 30 ? K_NEW : K);
const average = (list) => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : START_ELO);

/**
 * Variation d'elo d'un joueur : son équipe (elo moyen `mine`) contre l'autre (`theirs`), `result` 1 (victoire),
 * 0,5 (égalité) ou 0 (défaite), selon le nombre de parties déjà jouées dans ce classement.
 */
function eloDelta(mine, theirs, result, games) {
  return Math.round(kFactor(games) * (result - expected(mine, theirs)));
}

// ----------------------------------------------------------------------------------------------------------- Ligues

// Ligues à l'univers du jeu, de 200 points d'elo chacune, en 4 divisions (IV → I) de 50 points ; la dernière n'a pas
// de division (le classement départage).
const LEAGUES = [
  { id: 'wood', name: 'Bois', min: 0, color: '#8a6a45' },
  { id: 'bronze', name: 'Bronze', min: 900, color: '#b07a45' },
  { id: 'iron', name: 'Fer', min: 1100, color: '#8d96a0' },
  { id: 'silver', name: 'Argent', min: 1300, color: '#c9d1d9' },
  { id: 'gold', name: 'Or', min: 1500, color: '#e3b23c' },
  { id: 'mithril', name: 'Mithril', min: 1700, color: '#7fc4d8' },
  { id: 'legend', name: 'Légende', min: 1900, color: '#c45ad6' },
];
const DIVISIONS = ['IV', 'III', 'II', 'I'];

/**
 * Ligue d'un elo : { league, division, label }. En placement (moins de PLACEMENT_GAMES parties) : `placement` avec le
 * nombre de parties jouées. Bois : divisions de 900 vers le bas (IV sous 750).
 */
function leagueOf(elo, games = PLACEMENT_GAMES) {
  if (games < PLACEMENT_GAMES) return { league: null, division: null, placement: games, label: `Placement ${games}/${PLACEMENT_GAMES}` };
  const index = LEAGUES.reduce((found, l, i) => (elo >= l.min ? i : found), 0);
  const league = LEAGUES[index];
  if (league.id === 'legend') return { league, division: null, label: league.name };
  const top = LEAGUES[index + 1].min;
  const step = league.id === 'wood' ? 50 : (top - league.min) / DIVISIONS.length;
  const fromTop = Math.floor((top - 1 - elo) / step);
  const division = DIVISIONS[Math.max(0, DIVISIONS.length - 1 - fromTop)];
  return { league, division, label: `${league.name} ${division}` };
}

// ------------------------------------------------------------------------------------------------------ Matchmaking

/** Écart d'elo accepté avec la plus ancienne entrée de la file : s'élargit avec l'attente (tout le monde finit par jouer). */
const eloWindow = (waitedMs) => Math.min(1000, 100 + Math.floor(waitedMs / 1000) * 5);

/**
 * Forme une partie à partir des entrées de la file d'un format (groupes ou joueurs seuls, triées de la plus ancienne à
 * la plus récente) : { teams: [entrées équipe 1, entrées équipe 2] } ou null. La plus ancienne entrée est toujours
 * prise ; les autres doivent être dans sa fenêtre d'elo. Parmi les combinaisons (dans l'ordre de la file), la première
 * qui se partage en deux équipes complètes, avec l'écart d'elo moyen le plus faible.
 * Entrée : { id, size, rating, queuedAt }.
 */
function formMatch(entries, teamSize, now = new Date()) {
  if (!entries.length) return null;
  const [anchor] = entries;
  const window = eloWindow(now - new Date(anchor.queuedAt));
  const pool = entries.filter((e) => e.size <= teamSize && Math.abs(e.rating - anchor.rating) <= window).slice(0, 14);
  if (pool[0] !== anchor) return null;
  const need = teamSize * 2;

  // Combinaisons qui contiennent l'ancre et totalisent 2 × teamSize joueurs, dans l'ordre de la file.
  const pick = (start, chosen, total) => {
    if (total === need) return split(chosen, teamSize);
    for (let i = start; i < pool.length; i++) {
      if (total + pool[i].size > need) continue;
      const found = pick(i + 1, [...chosen, pool[i]], total + pool[i].size);
      if (found) return found;
    }
    return null;
  };
  return pick(1, [anchor], anchor.size);
}

/** Partage des entrées en deux équipes de `teamSize` joueurs, à l'écart d'elo moyen le plus faible (null si impossible). */
function split(chosen, teamSize) {
  let best = null;
  const n = chosen.length;
  // L'ancre (indice 0) est toujours dans l'équipe 1 : chaque partage n'est compté qu'une fois.
  for (let mask = 1; mask < 1 << n; mask += 2) {
    const a = chosen.filter((_, i) => mask & (1 << i));
    const b = chosen.filter((_, i) => !(mask & (1 << i)));
    if (a.reduce((s, e) => s + e.size, 0) !== teamSize) continue;
    const avg = (team) => team.reduce((s, e) => s + e.rating * e.size, 0) / teamSize;
    const gap = Math.abs(avg(a) - avg(b));
    if (!best || gap < best.gap) best = { teams: [a, b], gap };
  }
  return best ? { teams: best.teams } : null;
}

module.exports = {
  FORMATS, isFormat, LADDERS, ladderOf, MATCH_MINUTES, TEAMS, worldConfig, START_UNITS, layout, teamScore,
  START_ELO, PLACEMENT_GAMES, expected, kFactor, average, eloDelta, LEAGUES, DIVISIONS, leagueOf, eloWindow, formMatch,
};
