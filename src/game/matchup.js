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
 * Réglages du monde d'une partie : ceux d'un monde normal (WorldConfig), dont seuls les facteurs de croissance changent.
 * - Économie ×5000 à partir d'un village neuf : l'académie peut être construite vers la 10e minute.
 * - Troupes ×0,12, soit des trajets à ×600 : une hache traverse 15 cases en 30 s environ, on voit venir une attaque.
 * - Barbares : environ 200 points par minute, jusqu'à 9 000 points (ils valent la peine d'être pillés puis anoblis) ;
 *   deux par joueur, placés autour de lui comme sur un monde normal (placement.emptyVillages).
 * Retiré pour le classé : archers, archers montés, paladin, église, milice, sceaux (modules), quêtes, récompenses de
 * construction et succès. Durées réelles qui n'ont pas de sens sur 25 minutes : pas de protection des débutants (elle
 * bloquerait toute la partie), pas de mode vacances (personne d'autre ne joue une partie classée). Les équipes sont
 * les seules tribus (TribeService.assertTeamsOpen).
 */
function worldConfig() {
  const speed = 5000;
  return {
    speed,
    unitSpeed: 0.12,
    newbieDays: 0,
    // Pas de fin gratuite des constructions : à ×5000, presque tout se terminerait d'un clic.
    freeFinishSeconds: 0,
    features: { archer: false, knight: false, church: false, militia: false, seals: false },
    buildRewards: { active: false },
    tutorial: { active: false },
    achievements: { active: false },
    sitter: { allow: false },
    placement: { emptyVillages: 200 },
    // Points par jour × vitesse du monde : 200 points par minute.
    barbarian: { growthPerDay: Math.round((200 * 1440) / speed), maxPoints: 9000 },
    victory: { type: 'none' },
  };
}

/** Écart minimal (cases) entre les villages de départ de deux joueurs, placés au hasard comme sur un monde normal. */
const MIN_PLAYER_DISTANCE = 12;

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
  FORMATS, isFormat, LADDERS, ladderOf, MATCH_MINUTES, TEAMS, worldConfig, MIN_PLAYER_DISTANCE, teamScore,
  START_ELO, PLACEMENT_GAMES, expected, kFactor, average, eloDelta, LEAGUES, DIVISIONS, leagueOf, eloWindow, formMatch,
};
