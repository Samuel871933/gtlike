'use strict';

// Décisions d'un bot (voir services/BotService) : fonctions pures, sans base de données. Le bot joue comme un joueur
// prudent qui démarre : mines d'abord, caserne et forge, puis écurie pour la cavalerie légère, et il pille les
// villages barbares proches avec ce qu'il a. Toutes les actions passent ensuite par les services du jeu (mêmes
// règles, mêmes coûts et mêmes durées que pour un joueur).

// Ordre de construction du début de partie (bâtiment, niveau visé), dans le respect des prérequis.
const OPENING = [
  ['wood', 1], ['stone', 1], ['iron', 1], ['wood', 2], ['stone', 2], ['main', 2], ['wood', 3], ['stone', 3], ['main', 3],
  ['barracks', 1], ['iron', 2], ['storage', 2], ['farm', 2], ['wood', 4], ['stone', 4], ['iron', 3], ['main', 4],
  ['wood', 5], ['stone', 5], ['storage', 3], ['main', 5], ['smith', 1], ['iron', 4], ['farm', 3], ['wood', 6],
  ['stone', 6], ['barracks', 2], ['smith', 2], ['wood', 7], ['stone', 7], ['iron', 5], ['storage', 4], ['main', 6],
  ['farm', 4], ['wood', 8], ['stone', 8], ['iron', 6], ['barracks', 3], ['main', 7], ['storage', 5], ['wall', 1],
  ['wood', 9], ['stone', 9], ['iron', 7], ['main', 8], ['farm', 5], ['barracks', 4], ['barracks', 5], ['smith', 3],
  ['smith', 4], ['smith', 5], ['main', 9], ['main', 10], ['stable', 1], ['stable', 2], ['stable', 3], ['wood', 10],
  ['stone', 10], ['iron', 8], ['storage', 6], ['wall', 3],
];

// Suite : mines en tête, le reste suit à quelques niveaux d'écart, puis tout monte jusqu'au maximum.
function continuation() {
  const max = { snob: 1, church: 1, main: 30, barracks: 25, stable: 20, garage: 15, smith: 20, wall: 20, market: 25, hide: 10, storage: 30, farm: 30 };
  const out = [];
  for (let l = 11; l <= 40; l += 1) {
    out.push(['wood', l], ['stone', l], ['iron', l - 2], ['storage', l - 4], ['farm', l - 5], ['main', l - 2], ['barracks', l - 5],
      ['stable', l - 7], ['smith', l - 3], ['wall', l - 5], ['market', l - 9], ['hide', l - 12], ['garage', l - 15]);
    // Académie (nobles) dès que ses prérequis sont là : QG 20, forge 20, marché 10.
    if (l === 23) out.push(['snob', 1]);
    // Église (mondes avec église) : une fois la ferme assez grande pour ses 5 000 habitants.
    if (l === 30) out.push(['church', 1]);
  }
  return out.filter(([id, l]) => l >= 1 && l <= (max[id] ?? 30));
}

const PLAN = [...OPENING, ...continuation()];

/**
 * Prochain bâtiment à lancer : la ferme ou l'entrepôt s'ils bloquent (population presque pleine, ressources près du
 * plafond), sinon la première étape du plan pas encore atteinte. `level(id)` : niveau atteint, file comprise.
 * `has(id)` : le bâtiment existe sur ce monde.
 */
function nextBuilding({ level, has = () => true, popRatio, storageRatio }) {
  if (popRatio >= 0.85 && level('farm') < 30) return 'farm';
  if (storageRatio >= 0.9 && level('storage') < 30) return 'storage';
  const step = PLAN.find(([id, l]) => has(id) && level(id) < l);
  return step ? step[0] : null;
}

// Niveaux de difficulté (config.bots.difficulty). `offense` : part de la population en troupes offensives ;
// `strikeHours` : délai entre deux attaques d'un village sur des joueurs (heures de jeu, divisées par la vitesse) ;
// `minNuke` : population offensive minimale pour attaquer un joueur ; `radius` : portée des attaques (cases) ;
// `noble` : cibles des nobles (aucune, villages barbares, ou aussi les joueurs).
const PROFILES = {
  peaceful: { offense: 0.5, strikeHours: null, minNuke: 0, radius: 0, noble: 'none' },
  normal: { offense: 0.5, strikeHours: 12, minNuke: 400, radius: 15, noble: 'barbarians' },
  aggressive: { offense: 0.65, strikeHours: 3, minNuke: 300, radius: 25, noble: 'all' },
};
const profile = (difficulty) => PROFILES[difficulty] || PROFILES.normal;

// Recherches : hache et cavalerie légère pour piller, bélier pour attaquer les joueurs (murailles).
const research = (p) => (p.strikeHours ? ['axe', 'light', 'ram'] : ['axe', 'light']);

// Pilleurs, du meilleur au moins bon, et taille d'une vague (butin d'environ 400 ressources).
const RAIDERS = [{ unit: 'light', group: 5 }, { unit: 'axe', group: 20 }, { unit: 'spear', group: 15 }];
// Troupes offensives, envoyées ensemble contre un joueur.
const OFFENSE = ['axe', 'light', 'marcher', 'ram', 'catapult'];

/**
 * Vagues de pillage possibles avec les troupes présentes : on envoie l'unité de pillage la plus forte disponible ;
 * les lanciers ne partent que s'il n'y a rien d'autre, et la moitié seulement (l'autre défend le village).
 * `keep` : unités gardées au village (les haches d'un bot qui attaque les joueurs, dès qu'il a de la cavalerie).
 * @returns {Array<object>} unités de chaque vague, au plus `max`
 */
function raidWaves(units, max, keep = []) {
  for (const { unit, group } of RAIDERS) {
    if (keep.includes(unit)) continue;
    const available = unit === 'spear' ? Math.floor((units.spear || 0) / 2) : units[unit] || 0;
    const n = Math.min(max, Math.floor(available / group));
    if (n > 0) return Array.from({ length: n }, () => ({ [unit]: group }));
  }
  return [];
}

/**
 * Escortes de `nobles` nobles (une par noble : 100 haches, sinon 25 cavaliers légers, sinon 100 lanciers), prises
 * dans `units` ; s'il n'y en a pas pour tous, seuls les premiers nobles sont escortés (les autres attendent).
 */
function escorts(units, nobles) {
  const left = { ...units };
  const out = [];
  for (let i = 0; i < (nobles || 0); i += 1) {
    const pick = [['axe', 100], ['light', 25], ['spear', 100]].find(([id, n]) => (left[id] || 0) >= n);
    if (!pick) break;
    left[pick[0]] -= pick[1];
    out.push({ [pick[0]]: pick[1] });
  }
  return out;
}

/** Armée offensive présente au village et sa population. */
function nuke(units, pop) {
  const out = {};
  let total = 0;
  for (const id of OFFENSE) {
    if (units[id] > 0) {
      out[id] = units[id];
      total += units[id] * (pop[id] || 1);
    }
  }
  return { units: out, pop: total };
}

/**
 * Unité à recruter selon la part offensive du profil ; un bot qui attaque les joueurs ajoute des béliers (environ
 * 8 % de sa population offensive). `canRecruit(id)` : l'unité est recrutable dans ce village (bâtiment,
 * recherche). `army` : unités du village, présentes, en route et en formation.
 */
function nextRecruit({ canRecruit, army, pop, offense = 0.5, rams = false }) {
  const raider = ['light', 'axe', 'spear'].find(canRecruit);
  const defender = ['sword', 'spear'].find(canRecruit);
  if (!raider && !defender) return null;
  const sum = (ids) => ids.reduce((n, id) => n + (army[id] || 0) * (pop[id] || 1), 0);
  const attackers = sum(['light', 'axe', 'marcher', 'ram']);
  const defenders = sum(['spear', 'sword', 'archer', 'heavy']);
  if (rams && canRecruit('ram') && sum(['ram']) < 0.08 * attackers) return 'ram';
  if (raider && (attackers <= (offense / (1 - offense)) * defenders || !defender)) {
    // Les bots offensifs alternent haches et cavalerie : les haches font le gros de l'armée.
    if (rams && raider === 'light' && canRecruit('axe') && sum(['axe']) < sum(['light'])) return 'axe';
    return raider;
  }
  return defender;
}

/**
 * Cible d'une attaque sur les joueurs : le village le plus proche, en préférant ceux qui ne sont pas beaucoup plus
 * gros que l'attaquant (au-delà de 1,5 fois ses points, il passe après les autres). `targets` : { id, x, y, points }.
 */
function strikeTarget(from, targets, ownPoints) {
  const d = (v) => Math.hypot(v.x - from.x, v.y - from.y);
  const big = (v) => v.points > ownPoints * 1.5;
  return [...targets].sort((a, b) => big(a) - big(b) || d(a) - d(b))[0] || null;
}

module.exports = { PLAN, PROFILES, profile, research, nextBuilding, raidWaves, nuke, escorts, nextRecruit, strikeTarget, OFFENSE };
