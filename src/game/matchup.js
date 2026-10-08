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
//
// Deux notes par compte et par classement, comme sur League of Legends :
// - le MMR, caché : une note Glicko (`mmr`) et son incertitude (`rd`). Un nouveau joueur, ou un joueur absent depuis
//   longtemps, est incertain : son MMR bouge beaucoup ; plus il joue, plus il se stabilise. Le matchmaking s'en sert.
// - l'elo visible (les « LP ») : ligues et classement. Caché pendant les parties de placement, il est révélé à partir du
//   MMR à la dernière ; ensuite il bouge d'environ 20 par partie, plus si la victoire est large et si l'on a porté son
//   équipe, et il rattrape le MMR (MMR au-dessus de l'elo : on gagne plus et on perd moins, et inversement).

const START_ELO = 1000;
const PLACEMENT_GAMES = 5;
// Incertitude : au départ (et au plus), au moins (joueur régulier), et sa remontée avec l'inactivité (de 60 à 350 en
// une centaine de jours sans jouer).
const RD_START = 350;
const RD_MIN = 60;
const RD_GROWTH_PER_DAY = 34.6;
// Elo révélé à la fin du placement : le MMR, au plus REVEAL_CAP (on monte ensuite comme tout le monde).
const REVEAL_CAP = 1500;
// Elo visible : variation de base d'une partie, rattrapage du MMR (au plus ±CATCH_UP), bornes d'une partie.
const LP_BASE = 20;
const CATCH_UP = 12;
const LP_MIN = 5;
const LP_MAX = 45;

const Q = Math.log(10) / 400;
const g = (rd) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
/** Résultat attendu (0 à 1) d'une note `a` contre une note `b` d'incertitude `rdB`. */
const expected = (a, b, rdB = 0) => 1 / (1 + 10 ** ((-g(rdB) * (a - b)) / 400));
const average = (list) => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : START_ELO);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Incertitude après `days` jours sans jouer. */
const effectiveRd = (rd, days = 0) => clamp(Math.sqrt(rd * rd + RD_GROWTH_PER_DAY ** 2 * Math.max(0, days)), RD_MIN, RD_START);

/**
 * Ampleur de la victoire (×0,8 à ×1,3) : une conquête compte pleinement, une victoire aux points selon l'écart de
 * score (de justesse : ×0,8 ; moitié plus de points que l'adversaire ou davantage : ×1,3), un abandon normalement.
 */
function marginFactor(reason, scores) {
  if (reason === 'conquest') return 1.3;
  if (reason !== 'time' || !scores) return 1;
  const [a, b] = scores;
  const gap = Math.max(a, b) > 0 ? Math.abs(a - b) / Math.max(a, b) : 0;
  return 0.8 + Math.min(0.5, gap * (0.5 / 0.33));
}

/**
 * Performance dans son équipe (×0,75 à ×1,25), en équipe seulement : sa part des points et des adversaires vaincus
 * de l'équipe, rapportée à une part égale. Qui porte son équipe gagne plus en victoire et perd moins en défaite.
 */
function performanceFactor(contribution, teamContributions, result) {
  if (teamContributions.length < 2 || result === 0.5) return 1;
  const mean = average(teamContributions);
  const share = mean > 0 ? contribution / mean : 1;
  const f = clamp(0.75 + 0.25 * share, 0.75, 1.25);
  return result === 1 ? f : 2 - f;
}

/**
 * Nouvelles notes de tous les joueurs d'une partie. `players` : [{ team, mmr, rd, elo, games, contribution,
 * forfeited }] (rd déjà remonté par l'inactivité) ; `winnerTeam` 1, 2 ou null (égalité). Renvoie pour chacun
 * { mmr, rd, elo, placement } :
 * - MMR (Glicko) : son côté (moitié son MMR, moitié celui de son équipe) contre l'équipe adverse (MMR moyen,
 *   incertitude moyenne), corrigé par l'ampleur de la victoire et sa performance ; un abandon compte au pire (×1,25).
 * - elo visible : inchangé pendant le placement, révélé à la dernière partie de placement, sinon ±LP_BASE corrigé
 *   (ampleur, performance) et rattrapant le MMR ; jamais 0 pour une victoire ou une défaite.
 */
function ratingChanges(players, { winnerTeam, reason, scores }) {
  const team = (n) => players.filter((p) => p.team === n);
  const margin = winnerTeam ? marginFactor(reason, scores) : 1;
  return players.map((p) => {
    const result = winnerTeam === null ? 0.5 : p.team === winnerTeam ? 1 : 0;
    const mates = team(p.team);
    const foes = team(3 - p.team);
    const perf = p.forfeited && result === 0 ? 1.25 : performanceFactor(p.contribution, mates.map((m) => m.contribution), result);
    // Poids de la partie : ampleur de la victoire × performance (en défaite, perf < 1 pour qui a porté son équipe).
    const weight = result === 0.5 ? 1 : margin * perf;

    // MMR (Glicko-1, une partie) ; l'abandon et l'ampleur pèsent sur l'écart au résultat attendu.
    const mine = (p.mmr + average(mates.map((m) => m.mmr))) / 2;
    const foeMmr = average(foes.map((m) => m.mmr));
    const foeRd = Math.sqrt(average(foes.map((m) => m.rd * m.rd)));
    const e = expected(mine, foeMmr, foeRd);
    const gg = g(foeRd);
    const d2 = 1 / (Q * Q * gg * gg * e * (1 - e));
    const denom = 1 / (p.rd * p.rd) + 1 / d2;
    const mmr = p.mmr + (Q / denom) * gg * (result - e) * weight;
    const rd = clamp(Math.sqrt(1 / denom), RD_MIN, RD_START);

    // Elo visible.
    const games = p.games + 1;
    if (games < PLACEMENT_GAMES) return { mmr, rd, elo: p.elo, placement: true };
    if (games === PLACEMENT_GAMES) return { mmr, rd, elo: Math.round(Math.min(mmr, REVEAL_CAP)), placement: true };
    const catchUp = clamp((mmr - p.elo) / 20, -CATCH_UP, CATCH_UP);
    let lp;
    if (result === 1) lp = clamp(Math.round(LP_BASE * weight + catchUp), LP_MIN, LP_MAX);
    else if (result === 0) lp = -clamp(Math.round(LP_BASE * weight - catchUp), LP_MIN, LP_MAX);
    else lp = Math.round(clamp(catchUp / 2, -6, 6));
    return { mmr, rd, elo: Math.max(0, p.elo + lp), placement: false };
  });
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
  START_ELO, PLACEMENT_GAMES, RD_START, RD_MIN, REVEAL_CAP, expected, average, effectiveRd, marginFactor, performanceFactor, ratingChanges, LEAGUES, DIVISIONS, leagueOf, eloWindow, formMatch,
};
