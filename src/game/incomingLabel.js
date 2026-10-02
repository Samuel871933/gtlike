'use strict';

// Attaques entrantes : unité la plus lente probable d'après le temps de trajet, et noms générés par le bouton
// « Étiqueter » de l'aperçu Arrivant, comme sur Guerre Tribale.
//
// Le défenseur ne voit ni les troupes ni l'heure de départ : seulement l'origine, la cible et l'heure d'arrivée.
// L'étiquette suppose, comme sur GT, que l'ordre vient d'être lancé (temps restant = durée du trajet) : on retient
// l'unité la plus rapide dont le trajet dure au moins le temps restant. Étiqueter tard donne donc une unité trop rapide
// (le temps restant a fondu : 800 cavaliers légers étiquetés à mi-chemin passent pour des éclaireurs).

const registry = require('./registry');

const DEFAULT_FORMAT = '%unit% (%coords%)';
const MAX_NAME = 64;
const VARIABLES = ['unit', 'sent', 'duration', 'distance', 'origin', 'coords', 'player', 'arrival', 'return', 'destination'];

// Unité qui nomme un groupe d'unités de même vitesse (lanciers, haches et archers vont aussi vite) : la plus
// probable en attaque, et en soutien.
const PRIORITY = {
  attack: ['snob', 'ram', 'catapult', 'sword', 'axe', 'spear', 'archer', 'heavy', 'light', 'marcher', 'knight', 'spy'],
  support: ['snob', 'ram', 'catapult', 'sword', 'spear', 'archer', 'axe', 'heavy', 'knight', 'light', 'marcher', 'spy'],
};

// Mots reconnus dans un nom d'ordre pour afficher l'icône de l'unité (renommer en « Noble » montre le noble).
// Les plus longs d'abord : « archer monté » avant « archer ».
const ALIASES = [
  ['archer monte', 'marcher'], ['cavalerie legere', 'light'], ['cavalerie lourde', 'heavy'], ['cav legere', 'light'],
  ['cav lourde', 'heavy'], ['porteur d\'epee', 'sword'], ['guerrier a la hache', 'axe'], ['noble', 'snob'],
  ['belier', 'ram'], ['catapulte', 'catapult'], ['catas', 'catapult'], ['eclaireur', 'spy'], ['scout', 'spy'],
  ['paladin', 'knight'], ['epee', 'sword'], ['hache', 'axe'], ['lancier', 'spear'], ['lance', 'spear'],
  ['archer', 'archer'], ['cl', 'light'], ['cv', 'heavy'], ['ram', 'ram'], ['snob', 'snob'],
];

const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/’/g, '\'');

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Trajet de chaque groupe d'unités de même vitesse entre `from` et `to`, du plus court au plus long :
 * [{ unit (celle qui nomme le groupe), units (ids), seconds, reachable }]. `reachable` est faux pour le noble
 * au-delà de sa portée.
 */
function travelTable(from, to, cfg, type = 'attack') {
  const dist = distance(from, to);
  const groups = new Map();
  for (const u of registry.unitsFor(cfg)) {
    if (!(u.speed > 0)) continue;
    const seconds = Math.round(dist * u.minutesPerField(cfg) * 60);
    if (!groups.has(seconds)) groups.set(seconds, []);
    groups.get(seconds).push(u.id);
  }
  const order = PRIORITY[type] || PRIORITY.attack;
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...groups.entries()]
    .map(([seconds, units]) => {
      units.sort((a, b) => rank(a) - rank(b));
      const reachable = !(units.length === 1 && units[0] === 'snob' && cfg.snob && dist > cfg.snob.maxDistance);
      return { unit: units[0], units, seconds, reachable };
    })
    .sort((a, b) => a.seconds - b.seconds);
}

/**
 * Groupe d'unités le plus probable d'un ordre qui arrive dans `remaining` secondes : le plus rapide dont le trajet
 * dure au moins ce temps (à la précision des arrivées près). Faute de mieux (monde dont la vitesse a changé), le plus lent.
 */
function estimate(table, remaining, cfg) {
  const slack = 1 + (cfg.arrivalStepMs || 1) / 1000;
  const usable = table.filter((g) => g.reachable);
  return usable.find((g) => g.seconds + slack >= remaining) || usable[usable.length - 1] || null;
}

const pad = (n) => String(n).padStart(2, '0');
function clock(date, now) {
  const d = new Date(date);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return sameDay ? time : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}
function hms(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * Nom donné par « Étiqueter » à un ordre entrant (`cmd` avec origin, target et origin.Player), d'après le format
 * du joueur. Variables : %unit% %sent% %duration% %distance% %origin% %coords% %player% %arrival% %return% %destination%.
 */
function label(cmd, cfg, { now = new Date(), format } = {}) {
  const table = travelTable(cmd.origin, cmd.target, cfg, cmd.type);
  const remaining = (new Date(cmd.arrivesAt) - now) / 1000;
  const g = estimate(table, remaining, cfg);
  const arrives = new Date(cmd.arrivesAt).getTime();
  const seconds = g ? g.seconds : remaining;
  const vars = {
    unit: g ? registry.unit(g.unit).name : '?',
    sent: clock(arrives - seconds * 1000, now),
    duration: hms(seconds),
    distance: distance(cmd.origin, cmd.target).toFixed(1).replace('.', ','),
    origin: cmd.origin.name,
    coords: `${cmd.origin.x}|${cmd.origin.y}`,
    player: cmd.origin.Player ? cmd.origin.Player.name : 'Barbares',
    arrival: clock(arrives, now),
    return: clock(arrives + seconds * 1000, now),
    destination: cmd.target.name,
  };
  const text = String(format || DEFAULT_FORMAT).replace(/%([a-z]+)%/g, (m, k) => (k in vars ? vars[k] : m)).trim();
  return text.slice(0, MAX_NAME) || vars.unit;
}

/**
 * Unité nommée dans le nom d'un ordre (« Noble 2/4 » → 'snob'), pour afficher son icône ; null sinon. Un mot d'au
 * moins 4 lettres peut être collé à la suite (format « %unit%%origin% » : « BélierBastion 01 ») ; les abréviations
 * courtes (cl, cv, ram) doivent être des mots entiers.
 */
function unitFromName(name, cfg) {
  if (!name) return null;
  const words = ` ${fold(name).replace(/[^a-z0-9']+/g, ' ')} `;
  for (const [alias, id] of ALIASES) {
    if (!words.includes(alias.length >= 4 ? ` ${alias}` : ` ${alias} `)) continue;
    const u = registry.UNITS.get(id);
    if (u && (!cfg || u.isAvailableIn(cfg))) return id;
  }
  return null;
}

module.exports = { DEFAULT_FORMAT, MAX_NAME, VARIABLES, distance, travelTable, estimate, label, unitFromName };
