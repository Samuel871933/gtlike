'use strict';

const registry = require('../game/registry');
const incomingLabel = require('../game/incomingLabel');
const lastAttack = require('../game/lastAttack');
const tribeRights = require('../game/tribeRights');
const { ui, esc, segMenu } = require('./ui');
const { continent } = require('../game/MapPlacer');

const pad = (n) => String(n).padStart(2, '0');

/** 3725 → "1:02:05" */
function duration(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * "aujourd'hui à 14:55:19:926", "demain à 03:00:00:000" ou "le 26/09 à 10:00:00:512" : avec les millisecondes,
 * comme sur Guerre Tribale (arrivées et combats se jouent à la milliseconde) ; `ms: false` pour s'en passer.
 */
function when(date, now = new Date(), { ms = true } = {}) {
  const d = new Date(date);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${ms ? `:${String(d.getMilliseconds()).padStart(3, '0')}` : ''}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return `aujourd'hui à ${time}`;
  if (diff === 1) return `demain à ${time}`;
  return `le ${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${time}`;
}

/** Version courte de when() : "Auj. 14:55:19:926", "Dem. 03:00:00:000", "26/09 10:00:00:512". */
function whenShort(date, now = new Date()) {
  return when(date, now).replace("aujourd'hui à ", 'Auj. ').replace('demain à ', 'Dem. ').replace(/^le (\S+) à /, '$1 ');
}

/**
 * Pourquoi `cost` n'est pas payable par le village : « Ressources disponibles aujourd'hui à 14:55:19 »,
 * « L'entrepôt est trop petit » ou « Ressources insuffisantes » (production nulle) ; null s'il l'est.
 */
function resourcesWhen(state, cost, now = new Date()) {
  if (state.canAfford(cost)) return null;
  const at = state.affordableAt(cost, now);
  if (at) {
    // La plus proche de ces heures : le pied de page la donne à game.js, qui actualise la page à ce moment.
    if (!state.nextAffordableAt || at < state.nextAffordableAt) state.nextAffordableAt = at;
    // Sans millisecondes, arrondie à la seconde suivante : à l'heure affichée, les ressources sont là.
    return `Ressources disponibles ${when(Math.ceil(at / 1000) * 1000, now, { ms: false })}`;
  }
  const cap = state.storageCapacity();
  return Object.values(cost).some((c) => c > cap) ? "L'entrepôt est trop petit" : 'Ressources insuffisantes';
}

// Illustrations des succès classiques et quotidiens, découpées dans une même planche.
const ACHIEVEMENT_IMAGES = Object.fromEntries([
  'points', 'topscorer', 'continent', 'robber', 'plunderer', 'conqueror', 'leader', 'hero', 'vandal', 'wallbreaker',
  'butcher', 'kingslayer', 'reinforcement', 'counterspy', 'warlord', 'lucky', 'unlucky', 'merchant', 'croesus',
  'brothers', 'paladin', 'worldWinner', 'phoenix', 'dailyPlunderer', 'dailyAttacker', 'dailyDefender',
  'dailyConqueror', 'dailyRobber', 'dailySupporter',
].map((key) => [key, `/img/achievements/${key}.webp`]));
const TIER_STYLES = {
  medal: 'flex shrink-0 items-center justify-center border-2 bg-night shadow-[2px_2px_0_#000]',
  border: ['border-bronze-800 text-parchment-700', 'border-wood text-wood', 'border-bronze-300 text-bronze-200', 'border-iron text-iron', 'border-gold-400 text-gold-200'],
  text: ['text-parchment-600', 'text-wood', 'text-bronze-200', 'text-iron', 'text-gold-200'],
  names: ['Bois', 'Bronze', 'Argent', 'Or'],
};

// Image d'un bâtiment du plan du village (3 paliers visuels selon le niveau) : plan et pages de bâtiment.
const BUILDING_SPRITE_TIERS = {
  main: [5, 15], barracks: [5, 20], stable: [5, 10], garage: [5, 10], smith: [10, 15],
  market: [5, 20], wood: [10, 20], stone: [10, 20], iron: [10, 20], farm: [10, 20],
  storage: [10, 20], wall: [5, 15],
};
function buildingSpriteTier(id, level) {
  const thresholds = BUILDING_SPRITE_TIERS[id];
  if (!thresholds) return 1;
  return level >= thresholds[1] ? 3 : level >= thresholds[0] ? 2 : 1;
}
// Église et première église : une seule image, sans palier.
const buildingSprite = (id, level) => (id === 'church' || id === 'church_f'
  ? '/img/village/medieval/church.png'
  : `/img/village/medieval/tier-${buildingSpriteTier(id, level)}/${id === 'storage' ? 'storage-clean' : id}.png`);
/**
 * Visuel d'un bâtiment, composant commun à toute l'interface (listes, files, en-têtes, barre rapide…) : l'image du
 * plan du village au palier de `level` (ratio 8:7), grisée quand le bâtiment n'est pas construit (niveau 0).
 * `cls` : taille et placement ; `alt` : texte alternatif (décoratif par défaut).
 */
function buildingImg(id, level, cls = 'h-7 w-8', { alt = '', lazy = false } = {}) {
  const off = level > 0 ? '' : ' opacity-50 grayscale';
  return `<img src="${buildingSprite(id, Math.max(1, level || 0))}" alt="${esc(alt)}" width="32" height="28"${lazy ? ' loading="lazy"' : ''} class="shrink-0 object-contain${off} ${cls}"${alt ? '' : ' aria-hidden="true"'}>`;
}

/** Unité qui donne la vitesse d'un ordre : la plus lente, ou le paladin qu'un soutien accompagne (icône des ordres). */
function paceUnit(units, type) {
  const list = units || {};
  if (type === 'support' && list.knight > 0) return registry.unit('knight');
  return Object.entries(list).filter(([, n]) => n > 0).map(([id]) => registry.unit(id)).reduce((a, u) => (!a || u.speed > a.speed ? u : a), null);
}

// Gommette de la dernière attaque, composant unique : aperçu du village, rapports et infobulle de la carte
// (le HTML est transmis à public/js/map.js par mapBoot.attackDots).
const ATTACK_RESULTS = {
  win: ['#4fa33a', 'Aucune perte'],
  partial: ['#e3b23c', 'Pertes partielles'],
  loss: ['#c9372c', 'Pertes totales'],
  spy: ['#3f7fd1', 'Espionnage'],
};
const attackDot = (result, cls = 'size-3.5') => {
  const [color, label] = ATTACK_RESULTS[result] || ATTACK_RESULTS.win;
  return `<span class="inline-block ${cls} shrink-0 rounded-full border border-black shadow-[1px_1px_0_#000]" style="background:${color}" title="${label}"></span>`;
};
// Défenseur : la gommette de l'attaque vue de son côté (l'attaquant sans perte, c'est une défense perdue).
const DEFENSE_RESULT = { win: 'loss', loss: 'win', partial: 'partial', spy: 'spy' };
/**
 * Résultat d'un rapport d'attaque ou de défense pour son lecteur : gommette (`result`, voir ATTACK_RESULTS), butin
 * (`haul` full | partial | null, côté attaquant) et attaque d'éclaireurs seuls (`spyOnly`) ; null pour les autres
 * rapports et les visites (mode sommeil).
 */
function reportOutcome(r) {
  if (!['attack', 'defense'].includes(r.type) || !r.data || r.data.visit || !r.data.attacker) return null;
  const o = lastAttack.outcome(r.data);
  const units = r.data.attacker.units || {};
  const spyOnly = Object.keys(units).length > 0 && Object.entries(units).every(([id, n]) => !n || id === 'spy');
  return { result: r.type === 'defense' ? DEFENSE_RESULT[o.result] : o.result, haul: r.type === 'attack' ? o.haul : null, spyOnly };
}
/**
 * Icône du butin d'une attaque : sac rempli avec les ressources du jeu (butin plein, il reste sans doute des
 * ressources à piller) ou version grisée (butin partiel, le village a été vidé). Rien sans butin.
 */
function haulIcon(haul, cls = 'size-6') {
  if (!haul) return '';
  const full = haul === 'full';
  const title = full ? 'Butin plein : il reste sans doute des ressources à piller' : 'Butin partiel : le village a été vidé';
  return `<img src="/img/reports/haul-full.png?v=1" class="${cls} shrink-0 object-contain ${full ? '' : 'opacity-45 grayscale'}" alt="${title}" title="${title}">`;
}
/** Titre d'un rapport ; les anciens rapports d'éclaireurs seuls « attaquent » : ils espionnent. */
function reportTitle(r) {
  const o = reportOutcome(r);
  return o && o.spyOnly ? r.title.replace(/ attaque /, ' espionne ') : r.title;
}
/** Gommettes et libellés de chaque résultat, pour la carte : { win: { html, label }, … }. */
const attackDots = () => Object.fromEntries(Object.entries(ATTACK_RESULTS).map(([id, [, label]]) => [id, { html: attackDot(id), label }]));

// Ressources : libellé, couleur (classes Tailwind de la charte) et icône.
const RESOURCES = [
  { id: 'wood', label: 'Bois', dot: 'bg-wood', text: 'text-wood', bar: 'from-wood', icon: 'wood' },
  { id: 'stone', label: 'Argile', dot: 'bg-clay', text: 'text-clay', bar: 'from-clay', icon: 'stone' },
  { id: 'iron', label: 'Fer', dot: 'bg-iron', text: 'text-iron', bar: 'from-iron', icon: 'iron' },
];
const RESOURCE_ICONS = Object.fromEntries(
  ['wood', 'stone', 'iron', 'storage', 'pop'].map((id) => [id, `/img/resources/${id}.png?v=1`])
);

// Icônes au trait (grille 24 × 24) de la maquette, en ligne pour éviter toute dépendance.
const ICONS = {
  // Avertissement (triangle et point d'exclamation) : surcoût de la file de construction…
  alert: '<path d="M12 3L2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
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
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  edit: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  // Pause et reprise (gestionnaire de compte).
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/><path d="M11 13l9-9"/>',
  expand: '<path d="M4 20L10 14M14 4h6v6M20 4l-7 7M4 14v6h6"/>',
  // Mouvements
  attack: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
  troops: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
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
  lock: '<rect x="5" y="10" width="14" height="11" rx="1"/><path d="M8 10V7a4 4 0 018 0v3M12 14v3"/>',
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
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  // Récompenses de construction : coffret enrubanné.
  gift: '<path d="M4 11h16v10H4zM3 7h18v4H3zM12 7v14"/><path d="M12 7C10 3 6 3 7 6c.5 1 5 1 5 1zM12 7c2-4 6-4 5-1-.5 1-5 1-5 1z"/>',
};

// Icône de chaque unité.
const UNIT_ICONS = {
  spear: '/img/units/spear.png?v=1',
  sword: '/img/units/sword.png?v=1',
  axe: '/img/units/axe.png?v=1',
  archer: '/img/units/archer.png?v=1',
  spy: '/img/units/spy.png?v=1',
  light: '/img/units/light.png?v=1',
  marcher: '/img/units/marcher.png?v=1',
  heavy: '/img/units/heavy.png?v=1',
  ram: '/img/units/ram.png?v=1',
  catapult: '/img/units/catapult.png?v=1',
  knight: '/img/units/knight.png?v=1',
  snob: '/img/units/snob.png?v=1',
};

// Ordre de la barre d'accès rapide (comme sur Guerre Tribale).
const QUICKBAR = ['main', 'barracks', 'stable', 'garage', 'snob', 'smith', 'place', 'statue', 'market'];

/**
 * Onglets d'un bâtiment qu'on peut mettre en favori : [{ key, name, path }] (adresse relative au village), le premier
 * étant la page par défaut du bâtiment. Rien pour un bâtiment sans onglet.
 */
function buildingTabs(id, world) {
  const pageDef = FAVORITE_PAGES.find((p) => p.key === id);
  if (pageDef) return pageDef.tabs || [];
  if (id === 'place') {
    return [
      { key: 'commands', name: 'Commandes', path: 'place' },
      { key: 'troops', name: 'Troupes', path: 'place?tab=troops' },
      { key: 'sim', name: 'Simulateur', path: 'place?tab=sim' },
      ...(world && world.scavenging && world.scavenging.active ? [{ key: 'scavenge', name: 'Collecte', path: 'scavenge' }] : []),
      { key: 'farm', name: 'Pillage', path: 'farm' },
    ];
  }
  if (id === 'market') {
    return [['offers', 'Échange'], ['create', 'Créer des offres'], ['mass', 'Offres en masse'], ['send', 'Envoyer des ressources'],
      ['transports', 'Transports'], ['merchants', 'Marchands'], ['own', 'Mes offres'], ['request', 'Demande']]
      .map(([key, name], i) => ({ key, name, path: i ? `market?tab=${key}` : 'market' }));
  }
  if (id === 'main') return [{ key: 'build', name: 'Construction', path: 'main' }, { key: 'demolition', name: 'Démolition', path: 'main?tab=demolition' }];
  if (['barracks', 'stable', 'garage'].includes(id)) {
    return [{ key: 'recruit', name: 'Recrutement', path: `recruit/${id}` }, { key: 'dismiss', name: 'Désaffectation', path: `recruit/${id}?tab=dismiss` }];
  }
  return [];
}

// Pages du village qui ne sont pas des bâtiments mais peuvent aller dans la barre d'accès rapide (étoile de leur en-tête).
// `tabs` : onglets qu'on peut aussi mettre en favori, le premier étant la page par défaut (comme buildingTabs).
const FAVORITE_PAGES = [
  {
    key: 'seals', name: 'Sceaux', path: 'seals', available: (cfg) => Boolean(cfg && cfg.features && cfg.features.seals),
    tabs: [['overview', 'Aperçu'], ['trade', 'Échange'], ['history', 'Historique'], ['villages', 'Mes villages'], ['help', 'Aide']]
      .map(([key, name], i) => ({ key, name, path: i ? `seals?tab=${key}` : 'seals' })),
  },
  {
    key: 'manager', name: 'Gestionnaire de compte', path: 'manager', available: () => true,
    // Villages : sous-onglets Construction (buildings), Troupes (units) et Forge (forge, voir manager.ejs).
    tabs: [['overview', 'Aperçu'], ['buildings', 'Villages'], ['templates', 'Modèles de construction'], ['troops', 'Modèles de troupes'], ['research', 'Modèles de forge'], ['market', 'Marché'], ['notify', 'Notifications']]
      .map(([key, name], i) => ({ key, name, path: i ? `manager?tab=${key}` : 'manager' })),
  },
];
const favoritePage = (key, cfg) => FAVORITE_PAGES.find((p) => p.key === key && p.available(cfg)) || null;

/** Clé d'un favori : le bâtiment seul pour sa page par défaut (ou un onglet inconnu), sinon « bâtiment:onglet ». */
function favKey(id, tab, world) {
  const tabs = buildingTabs(id, world);
  return tab && tabs.slice(1).some((t) => t.key === tab) ? `${id}:${tab}` : id;
}

/**
 * Favoris du joueur (barre d'accès rapide) : bâtiments ou onglets de bâtiment, dans l'ordre des bâtiments du jeu puis
 * de leurs onglets : [{ key, id, tab, name, title, path }]. Tant qu'il n'a rien choisi : la barre par défaut (QUICKBAR),
 * limitée aux bâtiments construits dans le village courant.
 */
function favoriteEntries(player, ctx) {
  const keys = player && Array.isArray(player.favoriteBuildings)
    ? player.favoriteBuildings
    : QUICKBAR.filter((id) => ctx && ctx.state.level(id) > 0);
  const wanted = new Set(keys);
  const out = [];
  for (const id of registry.BUILDINGS.keys()) {
    if (ctx && !registry.building(id).isAvailableIn(ctx.cfg)) continue;
    const name = registry.building(id).name;
    if (wanted.has(id)) out.push({ key: id, id, tab: null, name, title: name, path: buildingPath(id, ctx && ctx.cfg) });
    for (const t of buildingTabs(id, ctx && ctx.cfg).slice(1)) {
      if (wanted.has(`${id}:${t.key}`)) out.push({ key: `${id}:${t.key}`, id, tab: t.key, name: t.name, title: `${name} · ${t.name}`, path: t.path });
    }
  }
  // Pages hors bâtiments (sceaux…), après les bâtiments ; `id` nul : la barre affiche leur propre vignette.
  for (const p of FAVORITE_PAGES) {
    if (!p.available(ctx && ctx.cfg)) continue;
    if (wanted.has(p.key)) out.push({ key: p.key, id: null, page: p.key, tab: null, name: p.name, title: p.name, path: p.path });
    for (const t of (p.tabs || []).slice(1)) {
      if (wanted.has(`${p.key}:${t.key}`)) out.push({ key: `${p.key}:${t.key}`, id: null, page: p.key, tab: t.key, name: t.name, title: `${p.name} · ${t.name}`, path: t.path });
    }
  }
  return out;
}

/** Clés des favoris du joueur (voir favoriteEntries) : « place », « place:farm »… */
function favoriteBuildings(player, ctx) {
  return favoriteEntries(player, ctx).map((f) => f.key);
}

/**
 * Étoile « favori » d'un bâtiment, ou d'un de ses onglets (`tab`) : petit formulaire (game.js l'envoie sans recharger
 * la page et met à jour la barre d'accès rapide). `cls` : placement et taille du bouton.
 */
function favStar(vid, buildingId, on, csrfToken, cls = 'size-7', tab = null) {
  const label = on ? 'Retirer des favoris' : 'Ajouter aux favoris';
  const key = tab ? `${buildingId}:${tab}` : buildingId;
  return `<form method="post" action="/village/${vid}/buildings/${buildingId}/favorite" class="contents" data-fav-form>`
    + `<input type="hidden" name="_csrf" value="${esc(csrfToken)}">${tab ? `<input type="hidden" name="tab" value="${esc(tab)}">` : ''}`
    + `<button class="group/fav inline-flex shrink-0 cursor-pointer items-center justify-center text-parchment-500 transition hover:text-gold-200 aria-pressed:text-gold-200 ${cls}" data-fav="${esc(key)}" aria-pressed="${on}" title="${label}" aria-label="${label}">`
    + icon('star', 'size-[70%] drop-shadow-[0_1px_1px_#000] group-aria-pressed/fav:fill-current', 2)
    + '</button></form>';
}

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
    case 'church': return world ? { label: 'Zone d’influence', value: `${world.church.radius[Math.min(level, world.church.radius.length - 1)] || 0} cases` } : null;
    case 'church_f': return world ? { label: 'Zone d’influence', value: `${world.church.firstRadius} cases` } : null;
    default: return null;
  }
}

/**
 * Menu « Aperçu » commun à ses pages (aperçus des villages, Arrivant) : mêmes onglets partout. `active` : mode des
 * aperçus des villages (combined, prod, units, buildings, groups) ou 'incomings'.
 */
function overviewMenu(vid, active) {
  const modes = [['combined', 'Combiné'], ['prod', 'Production'], ['units', 'Troupes'], ['buildings', 'Bâtiments'], ['groups', 'Groupes']]
    .map(([m, label]) => [`/village/${vid}/villages?mode=${m}`, label, active === m]);
  return segMenu(modes.concat([[`/village/${vid}/incomings`, 'Arrivant', active === 'incomings'], [`/village/${vid}/manager`, 'Gestionnaire', false]]), { label: 'Aperçu' });
}

/** Chemin (relatif au village) de la page d'un bâtiment. */
function buildingPath(id, world) {
  if (id === 'main' || id === 'place' || id === 'market') return id;
  if (registry.RECRUIT_BUILDINGS.includes(id)) return `recruit/${id}`;
  if (id === 'smith' && world && world.tech === 'simple') return 'smith';
  return `building/${id}`;
}

function icon(name, cls = 'size-4', strokeWidth = 1.8) {
  if (name === 'adarton') {
    return `<img src="/img/shop/adarton.webp" width="384" height="384" class="${cls} shrink-0 object-contain" alt="" aria-hidden="true">`;
  }
  return `<svg class="${cls} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.flag}</svg>`;
}

/** Icône raster commune à toutes les représentations d'unités dans l'interface. */
const unitIcon = (id, cls = 'size-7') => `<img src="${UNIT_ICONS[id] || UNIT_ICONS.spear}" class="${cls} min-h-7 min-w-7 shrink-0 object-contain" alt="" aria-hidden="true">`;
/** Pictogramme commun des ordres : type de trajet et unité qui fixe sa vitesse. */
function orderBadge(type, units, size = 'md') {
  const types = {
    attack: { box: 'bg-blood-600', icon: 'attack', name: 'Attaque' },
    return: { box: 'bg-gold-400', icon: 'return', name: 'Retour' },
    support: { box: 'bg-steel-500', icon: 'support', name: 'Soutien' },
    relocate: { box: 'bg-olive-500', icon: 'relocate', name: 'Déménagement' },
  };
  const sizes = {
    sm: { box: 'size-5 shadow-[1px_1px_0_#000]', icon: 'size-[12px]', stroke: 3.2, unit: 'size-4' },
    md: { box: 'size-[22px] shadow-[2px_2px_0_#000]', icon: 'size-[13px]', stroke: 3.2, unit: 'size-[18px]' },
    lg: { box: 'size-[30px] shadow-[2px_2px_0_#000]', icon: 'size-[15px]', stroke: 2.2, unit: 'size-6' },
    // Listes (villages d'un profil…) : 18 px, comme les gommettes d'opération (opBadge), en px fixes.
    list: { box: 'size-[18px] shadow-[1px_1px_0_#000]', icon: 'size-[11px]', stroke: 3, unit: 'size-[12px]' },
    // Carte : 16 px, comme les gommettes d'opération et la note du carnet (public/js/map.js) ; en px et non en rem,
    // car le canevas de la carte compte en px quelle que soit la taille de police de la page.
    map: { box: 'size-[16px] shadow-[1px_1px_0_#000]', icon: 'size-[10px]', stroke: 3, unit: 'size-[10px]' },
  };
  // Éclaireurs seuls : espionnage, sur fond bleu (la couleur de la gommette « Espionnage »).
  const spyOnly = type === 'attack' && units && Object.keys(units).length > 0 && Object.entries(units).every(([id, n]) => !n || id === 'spy');
  const t = spyOnly ? { box: 'bg-[#3f7fd1]', icon: 'eye', name: 'Espionnage' } : types[type] || types.support;
  const s = sizes[size] || sizes.md;
  const pace = units ? paceUnit(units, type) : null;
  const unit = pace ? (size === 'map'
    ? `<img src="${UNIT_ICONS[pace.id] || UNIT_ICONS.spear}" class="${s.unit} shrink-0 object-contain" alt="" aria-hidden="true">`
    : unitIcon(pace.id, s.unit)) : '';
  const unitWrap = size === 'map'
    ? 'flex size-[16px] shrink-0 items-center justify-center border-2 border-black bg-panel-top shadow-[1px_1px_0_#000]'
    : 'flex shrink-0 text-gold-400';
  return `<span class="flex shrink-0 items-center ${size === 'map' || size === 'list' ? 'gap-[2px]' : 'gap-1.5'}"><span class="flex shrink-0 items-center justify-center border-2 border-black text-night ${s.box} ${t.box}" title="${t.name}">${icon(t.icon, s.icon, s.stroke)}</span>${pace ? `<span class="${unitWrap}" title="Unité la plus lente : ${esc(pace.name)}">${unit}</span>` : ''}</span>`;
}
/**
 * Gommettes d'opération de tribu (comme sur la carte), cumulées : cible à la couleur de l'opération s'il reste des
 * attaques à prendre, épée sur fond doré si tu y as revendiqué une attaque, coche si toutes sont prises, couronne
 * dorée si noblage. `op` : OperationService.summary (couleur, noble, mine, open, names, claimed, count).
 */
function opBadge(op) {
  if (!op) return '';
  const color = /^#[0-9a-f]{6}$/i.test(op.color) ? op.color : '#e0452b';
  const stroke = (d) => `<path fill="none" stroke="#000" stroke-opacity=".7" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" d="${d}"/><path fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;
  const svg = (body) => `<svg viewBox="0 0 24 24" class="size-[12px]" aria-hidden="true">${body}</svg>`;
  // Même boîte que les pastilles d'ordres des listes (orderBadge 'list') : 18 px, bordure noire de 2 px, ombre d'1 px,
  // 2 px d'écart ; en px fixes, quelle que soit la mise en page.
  const box = (bg, body, hint) => `<span class="flex size-[18px] shrink-0 items-center justify-center border-2 border-black shadow-[1px_1px_0_#000]" style="background:${bg}" title="${esc(hint)}">${body}</span>`;
  const names = (op.names || []).join(', ');
  const badges = [
    op.open && box(color, svg(stroke('M12 5a7 7 0 100 14 7 7 0 100-14M12 1v6M12 17v6M1 12h6M17 12h6')), `${names} · ${op.count - op.claimed} attaque(s) à prendre`),
    op.mine && box('#f2c14e', svg('<path fill="#1b1206" d="M21 3l-1.2 4.6-8.3 8.3-3.4-3.4 8.3-8.3zM4.6 12.2l7.2 7.2-1.9 1.9-7.2-7.2zM8.6 17.6l-3.5 3.5-2.2-2.2 3.5-3.5z"/>'), `${names} · tu y participes`),
    !op.open && box(color, svg(stroke('M5 12.5l4.5 4.5L19 7.5')), `${names} · complet (${op.claimed} / ${op.count})`),
    op.noble && `<span class="flex size-[18px] shrink-0 items-center justify-center border-2 border-black bg-[#f2c14e] text-[#1b1206] shadow-[1px_1px_0_#000]" title="${esc(`${names} · noblage`)}">${icon('crown', 'size-[12px]', 2.6)}</span>`,
  ].filter(Boolean);
  return `<span class="inline-flex shrink-0 items-center gap-[2px] align-middle">${badges.join('')}<span class="sr-only">Opération ${esc(names)} : ${op.claimed} / ${op.count} attaques</span></span>`;
}

/**
 * Pastille d'un ordre entrant : type, et icône de l'unité nommée dans son nom (« Noble », « Bélier »…), comme sur GT
 * quand on renomme une attaque ; les troupes restent inconnues du défenseur.
 */
function incomingBadge(cmd, size = 'md') {
  const unit = incomingLabel.unitFromName(cmd.incomingName);
  return orderBadge(cmd.type, unit ? { [unit]: 1 } : null, size);
}
/**
 * Lien vers un village, composant unique : nom, coordonnées et continent forment un seul lien vers l'aperçu du village
 * (sa fiche, ou l'aperçu de ton village avec `own`). `href` : autre destination (marché du village…), même rendu.
 * `truncate` : nom tronqué dans une colonne étroite (les coordonnées restent entières). Nom et coordonnées sont
 * toujours en demi-gras et de la couleur du lien (`cls`), pour bien se voir : les graisses et couleurs passées dans
 * `nameCls` / `coordsCls` sont ignorées (il n'y reste que la taille du texte).
 */
function villageLink(vid, v, { cls = ui.linkPlain, href = null, own = false, nameCls = '', coordsCls = '', k = true, truncate = false } = {}) {
  if (!v) return '';
  const bold = (c) => `${String(c)
    .replace(/\bfont-(thin|light|normal|medium|semibold|bold)\b/g, '')
    .replace(/\btext-(gold|parchment|blood|olive|steel|bronze)-\d+\b/g, '')
    .replace(/\s+/g, ' ').trim()} font-semibold`.trim();
  nameCls = bold(nameCls);
  coordsCls = bold(coordsCls);
  const url = href || (own ? `/village/${v.id}` : `/village/${vid}/villages/${v.id}`);
  const where = `(${v.x}|${v.y})${k ? ` ${continent(v.x, v.y)}` : ''}`;
  return `<a href="${esc(url)}" class="${cls}${truncate ? ' inline-flex min-w-0 max-w-full items-baseline gap-1' : ''}" title="${esc(`${v.name} ${where}`)}">`
    + `<span class="${nameCls}${truncate ? ' min-w-0 truncate' : ''}">${esc(v.name)}</span>${truncate ? '' : ' '}<span class="${coordsCls} whitespace-nowrap tabular-nums">${where}</span></a>`;
}
/**
 * Même lien à partir du libellé « nom (x|y) » gardé dans les rapports : par l'identifiant s'il est connu, sinon par
 * les coordonnées du libellé (/villages/at). Texte seul si le libellé n'a pas de coordonnées.
 */
function villageLabelLink(vid, label, id = null, opts = {}) {
  const m = /^(.*) \((\d+)\|(\d+)\)(?: K\d+)?$/.exec(String(label || ''));
  if (!m) return esc(label || '');
  const v = { id, name: m[1], x: Number(m[2]), y: Number(m[3]) };
  return villageLink(vid, v, { href: id ? null : `/village/${vid}/villages/at?x=${v.x}&y=${v.y}`, ...opts });
}
/** Icône raster commune aux ressources, au stockage et à la population. */
const resourceIcon = (id, cls = 'size-8') => `<img src="${RESOURCE_ICONS[id] || RESOURCE_ICONS.storage}" class="${cls} min-h-8 min-w-8 shrink-0 object-contain" alt="" aria-hidden="true">`;

/** Blason (écu) de village ; `fill` est une classe de couleur (fill-rel-own…) ; emblème : 'cross' (le sien), 'star' (spécial) ou rien. */
function shield(fill, { cls = 'w-4', emblem = '', glow = false } = {}) {
  const e = emblem === 'cross' ? '<path class="stroke-shield-mark" d="M6 9h8M10 6v8" stroke-width="1.8" stroke-linecap="round"/>'
    : emblem === 'star' ? '<path class="fill-shield-mark" d="M10 5.5l1.3 2.7 3 .4-2.2 2 .5 3L10 12.2 7.4 13.6l.5-3-2.2-2 3-.4z"/>' : '';
  const f = glow ? 'drop-shadow-[0_0_6px_var(--color-gold-200)]' : 'drop-shadow-[0_2px_1px_rgba(0,0,0,0.7)]';
  return `<svg class="${cls} ${f} shrink-0" viewBox="0 0 20 22" aria-hidden="true"><path class="${fill} stroke-shield-edge" d="M2 2h16v8c0 5.5-4 8.5-8 10C6 18.5 2 15.5 2 10z" stroke-width="1.6" stroke-linejoin="round"/><path d="M4.5 4h11" stroke="#fff" stroke-opacity="0.35" stroke-width="1.2" stroke-linecap="round"/>${e}</svg>`;
}

/**
 * Miniature carrée de l'image de profil d'un joueur ou d'une tribu (`kind` : 'player' ou 'tribe'), recadrée au centre ;
 * sans image, médaillon avec l'icône du profil ou de la tribu, pour garder l'alignement des listes.
 * `size` : classes de taille (size-7 par défaut, dans les listes).
 */
function avatarThumb(kind, rec, { size = 'size-7', iconCls = 'size-3.5' } = {}) {
  // Même médaillon que les rangs du classement (taille, cadre, ombre), l'image remplissant l'intérieur.
  const fallback = icon(kind === 'tribe' ? 'tribe' : 'profile', iconCls, 2);
  const image = rec && rec.avatar
    ? `<img src="${ImageService.url(rec.avatar)}" alt="" loading="lazy" decoding="async" onerror="this.remove()" class="absolute inset-0 size-full object-cover">`
    : '';
  return `<span class="${ui.medallion} ${size} relative overflow-hidden text-parchment-600" aria-hidden="true">${fallback}${image}</span>`;
}

/** Grande image de profil (pages de profil), réduite à la taille maximale gardée par ImageService. */
function avatarImage(kind, rec, { cls = 'mx-auto' } = {}) {
  if (!rec || !rec.avatar) return '';
  const alt = kind === 'tribe' ? `Image de la tribu ${rec.name}` : `Image du profil de ${rec.name}`;
  return `<img src="${ImageService.url(rec.avatar)}" alt="${esc(alt)}" width="${ImageService.MAX_WIDTH}" height="${ImageService.MAX_HEIGHT}" class="${cls} block h-auto w-auto max-w-full border-2 border-black" style="max-height:${ImageService.MAX_HEIGHT}px">`;
}

/**
 * Nom d'un joueur, avec lien vers son profil quand on est en jeu (`vid` : village courant ; sans village,
 * texte simple, les profils n'existant que dans le jeu). `p` nul : texte de remplacement (`none`).
 * `avatar` : miniature de son image de profil devant le nom (listes de joueurs).
 */
function playerLink(vid, p, { cls = ui.linkPlain, none = 'Barbares', avatar = false } = {}) {
  if (!p) return `<span class="text-parchment-500">${esc(none)}</span>`;
  const name = vid ? `<a href="/village/${vid}/players/${p.id}" class="${cls}">${esc(p.name)}</a>` : `<span>${esc(p.name)}</span>`;
  const label = p.isBot ? `${name} ${botTag()}` : name;
  return avatar ? `<span class="inline-flex min-w-0 items-center gap-2 align-middle">${avatarThumb('player', p)}<span class="min-w-0">${label}</span></span>` : label;
}

/** Étiquette d'un joueur géré par l'ordinateur (voir BotService). */
function botTag() {
  return '<span class="inline-flex items-center border border-steel-500/60 bg-night px-1.5 py-px align-middle text-[11px] font-medium text-steel-300" title="Joueur géré par l’ordinateur">Bot</span>';
}

/**
 * Tribu : tag (et nom si `name`), avec lien vers sa page publique en jeu. `avatar` : miniature de son image devant
 * (listes de tribus).
 */
function tribeLink(vid, tr, { name = false, tagCls = ui.tagMuted, cls = ui.linkPlain, avatar = false } = {}) {
  if (!tr) return '<span class="text-parchment-700">—</span>';
  // Avec la miniature, le tag prend la même hauteur que le médaillon.
  const inner = `${avatar ? avatarThumb('tribe', tr) : ''}<span class="${tagCls}${avatar ? ' h-7 py-0' : ''}">${esc(tr.tag)}</span>${name ? `<span class="truncate">${esc(tr.name)}</span>` : ''}`;
  return vid
    ? `<a href="/village/${vid}/tribes/${tr.id}" class="${cls} inline-flex min-w-0 items-center gap-2 align-middle font-semibold whitespace-nowrap">${inner}</a>`
    : `<span class="inline-flex min-w-0 items-center gap-2 align-middle whitespace-nowrap">${inner}</span>`;
}

// Un seul formateur pour toutes les pages : toLocaleString en recrée un à chaque nombre affiché (des centaines par page).
const NUMBER_FR = new Intl.NumberFormat('fr-FR');

function num(n) {
  return NUMBER_FR.format(Math.floor(n));
}

/** Nombre abrégé pour les barres étroites (mobile) : 950, 8,4k, 400k, 1,2M ; arrondi vers le bas, comme num. Même règle que short() dans public/js/game.js. */
function numShort(n) {
  const v = Math.floor(n);
  const cut = (x, unit) => `${NUMBER_FR.format(x < 10 ? Math.floor(x * 10) / 10 : Math.floor(x))}${unit}`;
  if (v < 1000) return String(v);
  if (v < 1e6) return cut(v / 1000, 'k');
  return cut(v / 1e6, 'M');
}

/** Journée AAAA-MM-JJ (heure du serveur) : « aujourd'hui », « hier » ou « 27.09.2026 », comme sur GT. */
function dayLabel(day, now = new Date()) {
  if (!day) return '—';
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (day === key(now)) return 'aujourd’hui';
  if (day === key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'hier';
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Aperçu d'un cosmétique, le même dans la boutique et dans les réglages du compte : le fond d'un thème de jeu
 * (`kind` 'theme'), ou un design de village sur un coin de carte, la capitale (niveau 6) en grand puis les niveaux
 * 1 à 5 (`kind` 'design'). Les couleurs autour suivent le thème affiché. Hauteur en px fixes (pas réduite en
 * minimaliste) : les capitales les plus hautes (futuriste) dépassent de 42 px au-dessus de leur case.
 */
function cosmeticPreview(kind, id) {
  if (kind === 'theme') {
    return `<div class="aspect-966/580 border-2 border-black bg-cover bg-center" style="background-image: url('/img/game-styles/${esc(id)}/background-preview.webp')" aria-hidden="true"></div>`;
  }
  const marker = (l, w, h) => `<span class="village-marker village-marker--${l} village-design--${esc(id)}" style="--tile-w:${w}px;--tile-h:${h}px"><span class="village-sprite"></span></span>`;
  return `<div class="relative overflow-hidden border-2 border-black bg-[url(/img/map/terrain-grass.webp)] bg-size-[260px]" aria-hidden="true">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(255,236,170,0.28),transparent_55%),radial-gradient(ellipse_at_50%_50%,transparent_55%,rgba(0,0,0,0.55))]"></div>
    <div class="relative flex h-[172px] items-end justify-center pb-[12px]">${marker(6, 140, 100)}</div>
    <div class="relative flex items-end justify-center gap-1 border-t border-black/40 bg-black/35 px-2 py-1.5">${[1, 2, 3, 4, 5].map((l) => marker(l, 44, 32)).join('')}</div>
  </div>`;
}

const ImageService = require('../services/ImageService');

module.exports = {
  ...require('./ui'),
  // Tracés des icônes (grille 24 × 24), repris dans d'autres SVG (sceaux, voir sealSvg.js).
  ICONS,
  asset: require('./assets').asset,
  // Taille maximale des images de profil (formulaire d'envoi) ; affichage : avatarThumb et avatarImage.
  // Listes à nombre de lignes par page réglable (partials/pagination).
  PER_PAGE_LISTS: require('../services/PaginationService').LISTS,
  avatarSize: { w: ImageService.MAX_WIDTH, h: ImageService.MAX_HEIGHT },
  GAME_STYLES: require('./gameStyles').GAME_STYLES,
  VILLAGE_DESIGNS: require('./villageDesigns').VILLAGE_DESIGNS,
  GAME_LAYOUTS: require('./gameLayouts').GAME_LAYOUTS,
  defaultShadows: require('./gameLayouts').defaultShadows,
  QUICKBAR_POSITIONS: require('./quickbarPositions').QUICKBAR_POSITIONS,
  RESOURCES,
  RESOURCE_ICONS,
  UNIT_ICONS,
  overviewMenu,
  buildingImg,
  VILLAGE_PLAN: require('./villagePlan'),
  ...require('./worldLabels'),
  factionName: require('../game/factions').factionName,
  factionDesign: require('../game/factions').factionDesign,
  SEALS: require('../game/seals'),
  sealSvg: require('./sealSvg').sealSvg,
  unitIcon,
  orderBadge,
  opBadge,
  incomingBadge,
  incomingName: (cmd) => cmd.incomingName || (cmd.type === 'attack' ? 'Attaque' : 'Soutien'),
  resourceIcon,
  shield,
  QUICKBAR,
  favoriteBuildings,
  favoriteEntries,
  favoritePage,
  buildingTabs,
  favKey,
  favStar,
  UNIT_GROUPS,
  buildingPath,
  buildingStat,
  icon,
  duration,
  when,
  whenShort,
  // L'encart de la quête en cours s'affiche-t-il sur cette page (pages de la quête, hors bulle d'accueil et remplaçant) ?
  // `user` : compte connecté, qui peut masquer ces encarts (Compte → Quêtes).
  questTrackerShown: (q, asSitter, currentPath, vid, user) => Boolean(q && !q.intro && !asSitter && (!user || user.questReminders !== false)
    && q.pages.some((p) => currentPath === `/village/${vid}${p ? `/${p}` : ''}`)),
  // Le monde donne-t-il encore des récompenses de construction (bouton de la barre du village) ?
  buildRewardsOpen: require('../game/buildRewards').active,
  resourcesWhen,
  num,
  numShort,
  dayLabel,
  playerLink,
  avatarThumb,
  avatarImage,
  botTag,
  tribeLink,
  continent,
  buildingName: (id) => registry.building(id).name,
  unitName: (id) => registry.unit(id).name,
  unitPop: (id) => registry.unit(id).pop,
  registry,
  tribeRights,
  ACHIEVEMENT_IMAGES,
  paceUnit,
  buildingSprite,
  ATTACK_RESULTS,
  attackDot,
  villageLink,
  villageLabelLink,
  reportOutcome,
  haulIcon,
  cosmeticPreview,
  reportTitle,
  attackDots,
  TIER_STYLES,
};
