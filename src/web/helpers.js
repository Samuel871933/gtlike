'use strict';

const registry = require('../game/registry');
const { ui, esc } = require('./ui');
const { continent } = require('../game/MapPlacer');

const pad = (n) => String(n).padStart(2, '0');

/** 3725 → "1:02:05" */
function duration(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "aujourd'hui à 14:55:19", "demain à 03:00:00" ou "le 26/09 à 10:00:00" */
function when(date, now = new Date()) {
  const d = new Date(date);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return `aujourd'hui à ${time}`;
  if (diff === 1) return `demain à ${time}`;
  return `le ${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${time}`;
}

/** Version courte de when() : "Auj. 14:55:19", "Dem. 03:00:00", "26/09 10:00:00". */
function whenShort(date, now = new Date()) {
  return when(date, now).replace("aujourd'hui à ", 'Auj. ').replace('demain à ', 'Dem. ').replace(/^le (\S+) à /, '$1 ');
}

// Ressources : libellé, couleur (classes Tailwind de la charte) et icône.
const RESOURCES = [
  { id: 'wood', label: 'Bois', dot: 'bg-wood', text: 'text-wood', bar: 'from-wood', icon: 'wood' },
  { id: 'stone', label: 'Argile', dot: 'bg-clay', text: 'text-clay', bar: 'from-clay', icon: 'stone' },
  { id: 'iron', label: 'Fer', dot: 'bg-iron', text: 'text-iron', bar: 'from-iron', icon: 'iron' },
];

// Icônes au trait (grille 24 × 24) de la maquette, en ligne pour éviter toute dépendance.
const ICONS = {
  // Navigation
  overview: '<path d="M3 9l9-5 9 5z"/><path d="M5 20h14M6 17h12M7 17V10M11 17V10M13 17V10M17 17V10"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  reports: '<path d="M6 4h11a2 2 0 012 2v12a2 2 0 01-2 2H8"/><path d="M6 4a2 2 0 00-2 2v2h4V6a2 2 0 00-2-2zM8 20a2 2 0 01-2-2V8"/><path d="M11 9h5M11 13h5"/>',
  messages: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  tribe: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  ranking: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  logout: '<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  victory: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  // Flèches et actions
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  center: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  edit: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/><path d="M11 13l9-9"/>',
  expand: '<path d="M4 20L10 14M14 4h6v6M20 4l-7 7M4 14v6h6"/>',
  // Mouvements
  attack: '<path d="M5 19L17 7M14 4h6v6M4 16l4 4"/>',
  return: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  support: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 9v6M9 12h6"/>',
  relocate: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  sword: '<path d="M5 19L17 7M14 4h6v6M4 16l4 4"/>',
  // Ressources et village
  wood: '<rect x="3" y="6" width="18" height="5" rx="2.5"/><rect x="3" y="13" width="18" height="5" rx="2.5"/><circle cx="18.5" cy="8.5" r="1"/><circle cx="18.5" cy="15.5" r="1"/>',
  stone: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 12h18M9 5v7M15 12v7"/>',
  iron: '<path d="M6 10h12l3 8H3z"/><path d="M8 10l1.5-4h5L16 10"/>',
  storage: '<path d="M9 3h6M10 3v3c-3 1-5 4-5 8s3 7 7 7 7-3 7-7-2-7-5-8V3"/>',
  pop: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 15c3 0 5.5 1.5 5.5 4.5"/>',
  farm: '<path d="M12 21V8"/><path d="M12 9c-3 0-4-3-4-5 3 0 4 2 4 5zM12 9c3 0 4-3 4-5-3 0-4 2-4 5zM12 15c-3 0-4-3-4-5 3 0 4 2 4 5zM12 15c3 0 4-3 4-5-3 0-4 2-4 5z"/>',
  wall: '<path d="M3 21V9h3v3h3V9h3v3h3V9h3v3h3v9z"/>',
  academy: '<path d="M4 5h11a3 3 0 013 3v11H7a3 3 0 01-3-3z"/><path d="M8 9h6M8 13h6"/>',
  smith: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11.5 9.5L4 17l3 3 7.5-7.5"/>',
  flag: '<path d="M6 21V3"/><path d="M6 4h11l-3 4 3 4H6"/>',
  market: '<path d="M12 4v16M7 20h10M5 8h14"/><path d="M5 8l-3 6h6zM19 8l-3 6h6z"/>',
  horse: '<path d="M7 21v-6L4 12l5-7 2 2 5-1 4 5-2 2-2-1v9"/>',
  workshop: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/><path d="M10 17h4M5 14l10-9M13 5h4v4"/>',
  statue: '<circle cx="12" cy="5" r="2"/><path d="M12 7v7M9 10h6M10 21v-3h4v3M7 21h10"/>',
  hide: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 13h16M6 9V7a2 2 0 012-2h8a2 2 0 012 2v2M12 12v3"/>',
  coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bolt: '<path d="M4 14L14 2l-2 8h8L10 22l2-8z"/>',
  moon: '<path d="M20 14A8 8 0 1110 4a6 6 0 0010 10z"/>',
  // Unités
  spear: '<path d="M4 20L18 6M14 4h6v6"/>',
  axe: '<path d="M5 20L15 10"/><path d="M13 5c4-1 7 2 6 6l-6-1z"/>',
  bow: '<path d="M6 3c6 3 6 15 0 18"/><path d="M6 3v18M3 12h16M16 9l3 3-3 3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  heavy: '<path d="M7 21v-6L4 12l5-7 2 2 5-1 4 5-2 2-2-1v9"/><path d="M9 12h5"/>',
  ram: '<path d="M3 14h14l4-3M5 14v3M15 14v3"/><circle cx="5" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>',
  catapult: '<path d="M4 20h16M7 20l5-9 5 9M12 11l6-7"/><circle cx="18" cy="4" r="1.5"/>',
  helm: '<path d="M6 11a6 6 0 0112 0v8H6z"/><path d="M6 14h12M12 5V2"/>',
  crown: '<path d="M4 18h16l1-10-5 4-4-7-4 7-5-4z"/>',
};

// Icône de chaque bâtiment et de chaque unité.
const BUILDING_ICONS = {
  main: 'overview', barracks: 'tribe', stable: 'horse', garage: 'workshop', snob: 'academy', smith: 'smith', place: 'flag',
  statue: 'statue', market: 'market', wood: 'wood', stone: 'stone', iron: 'iron', farm: 'farm', storage: 'storage', hide: 'hide', wall: 'wall',
};
const UNIT_ICONS = {
  spear: 'spear', sword: 'sword', axe: 'axe', archer: 'bow', spy: 'eye', light: 'horse', marcher: 'bow', heavy: 'heavy',
  ram: 'ram', catapult: 'catapult', knight: 'helm', snob: 'crown', militia: 'pop',
};

// Ordre de la barre d'accès rapide (comme sur Guerre Tribale).
const QUICKBAR = ['main', 'barracks', 'stable', 'garage', 'snob', 'smith', 'place', 'statue', 'market'];

// Groupes d'unités du point de ralliement.
const UNIT_GROUPS = [
  ['Infanterie', ['spear', 'sword', 'axe', 'archer']],
  ['Cavalerie', ['spy', 'light', 'marcher', 'heavy']],
  ['Engins de siège', ['ram', 'catapult']],
  ['Autres', ['knight', 'snob']],
];

/** Statistique principale d'un bâtiment à un niveau (affichée dans l'en-tête et le tableau des niveaux). */
function buildingStat(id, level, world) {
  const formulas = require('../game/formulas');
  const pct = (x) => `${Math.round(x * 100)} %`;
  switch (id) {
    case 'main': return { label: 'Durée des constructions', value: pct(Math.pow(1.05, -level)) };
    case 'barracks': case 'stable': case 'garage': return { label: 'Durée de recrutement', value: pct(Math.pow(1.06, -level)) };
    case 'smith': return { label: 'Durée des recherches', value: pct(Math.pow(1.1, -level)) };
    case 'wood': case 'stone': case 'iron': return { label: 'Production', value: `${num(formulas.production(level, world))} / h` };
    case 'farm': return { label: 'Population maximale', value: num(formulas.farmCapacity(Math.max(1, level))) };
    case 'storage': return { label: 'Capacité par ressource', value: num(formulas.storageCapacity(Math.max(1, level))) };
    case 'hide': return { label: 'Ressources cachées', value: num(formulas.hideCapacity(level)) };
    case 'wall': return { label: 'Bonus de défense', value: `+${pct(Math.pow(1.037, level) - 1)} · base ${num(20 + 50 * level)}` };
    case 'market': return { label: 'Marchands', value: num(formulas.merchantCount(level)) };
    default: return null;
  }
}

/** Chemin (relatif au village) de la page d'un bâtiment. */
function buildingPath(id, world) {
  if (id === 'main' || id === 'place' || id === 'market') return id;
  if (registry.RECRUIT_BUILDINGS.includes(id)) return `recruit/${id}`;
  if (id === 'smith' && world && world.tech === 'simple') return 'smith';
  return `building/${id}`;
}

function icon(name, cls = 'size-4', strokeWidth = 1.8) {
  return `<svg class="${cls} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.flag}</svg>`;
}

const buildingIcon = (id, cls, strokeWidth) => icon(BUILDING_ICONS[id] || 'flag', cls, strokeWidth);
const unitIcon = (id, cls, strokeWidth) => icon(UNIT_ICONS[id] || 'spear', cls, strokeWidth);

/** Lauriers du logo. */
function laurel(cls = 'size-[30px]') {
  return `<svg class="${cls} shrink-0" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M11 27C5 22 4 14 8 6"/><path d="M21 27c6-5 7-13 3-21"/><path d="M7.5 10c-2.5-.2-3.6-2-3.6-2s2-1.4 3.9-.4M6.5 15c-2.6.3-4-1.3-4-1.3s1.7-1.8 3.8-1.1M7.4 20c-2.4.8-4.1-.5-4.1-.5s1.3-2 3.6-1.8M24.5 10c2.5-.2 3.6-2 3.6-2s-2-1.4-3.9-.4M25.5 15c2.6.3 4-1.3 4-1.3s-1.7-1.8-3.8-1.1M24.6 20c2.4.8 4.1-.5 4.1-.5s-1.3-2-3.6-1.8"/><path d="M13 27h6"/></svg>`;
}

/** Blason (écu) de village ; `fill` est une classe de couleur (fill-rel-own…) ; emblème : 'cross' (le sien), 'star' (spécial) ou rien. */
function shield(fill, { cls = 'w-4', emblem = '', glow = false } = {}) {
  const e = emblem === 'cross' ? '<path class="stroke-shield-mark" d="M6 9h8M10 6v8" stroke-width="1.8" stroke-linecap="round"/>'
    : emblem === 'star' ? '<path class="fill-shield-mark" d="M10 5.5l1.3 2.7 3 .4-2.2 2 .5 3L10 12.2 7.4 13.6l.5-3-2.2-2 3-.4z"/>' : '';
  const f = glow ? 'drop-shadow-[0_0_6px_var(--color-gold-200)]' : 'drop-shadow-[0_2px_1px_rgba(0,0,0,0.7)]';
  return `<svg class="${cls} ${f} shrink-0" viewBox="0 0 20 22" aria-hidden="true"><path class="${fill} stroke-shield-edge" d="M2 2h16v8c0 5.5-4 8.5-8 10C6 18.5 2 15.5 2 10z" stroke-width="1.6" stroke-linejoin="round"/><path d="M4.5 4h11" stroke="#fff" stroke-opacity="0.35" stroke-width="1.2" stroke-linecap="round"/>${e}</svg>`;
}

/**
 * Nom d'un joueur, avec lien vers son profil quand on est en jeu (`vid` : village courant ; sans village,
 * texte simple, les profils n'existant que dans le jeu). `p` nul : texte de remplacement (`none`).
 */
function playerLink(vid, p, { cls = ui.linkPlain, none = 'Barbares' } = {}) {
  if (!p) return `<span class="text-parchment-500">${esc(none)}</span>`;
  return vid ? `<a href="/village/${vid}/players/${p.id}" class="${cls}">${esc(p.name)}</a>` : `<span>${esc(p.name)}</span>`;
}

/** Tribu : tag (et nom si `name`), avec lien vers sa page publique en jeu. */
function tribeLink(vid, tr, { name = false, tagCls = ui.tagMuted, cls = ui.linkPlain } = {}) {
  if (!tr) return '<span class="text-parchment-700">—</span>';
  const inner = `<span class="${tagCls}">${esc(tr.tag)}</span>${name ? `<span class="truncate">${esc(tr.name)}</span>` : ''}`;
  return vid
    ? `<a href="/village/${vid}/tribes/${tr.id}" class="${cls} inline-flex min-w-0 items-center gap-2 font-bold whitespace-nowrap">${inner}</a>`
    : `<span class="inline-flex min-w-0 items-center gap-2 whitespace-nowrap">${inner}</span>`;
}

function num(n) {
  return Math.floor(n).toLocaleString('fr-FR');
}

module.exports = {
  ...require('./ui'),
  GAME_STYLES: require('./gameStyles').GAME_STYLES,
  RESOURCES,
  BUILDING_ICONS,
  UNIT_ICONS,
  buildingIcon,
  unitIcon,
  laurel,
  shield,
  QUICKBAR,
  UNIT_GROUPS,
  buildingPath,
  buildingStat,
  icon,
  duration,
  when,
  whenShort,
  num,
  playerLink,
  tribeLink,
  continent,
  buildingName: (id) => registry.building(id).name,
  unitName: (id) => registry.unit(id).name,
  registry,
};
