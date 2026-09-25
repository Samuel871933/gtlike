'use strict';

/*
  Composants de la charte (maquette « Imperium — refonte ») sous forme de chaînes de classes Tailwind.
  Aucun CSS maison : chaque composant n'est qu'un assemblage d'utilitaires, réutilisé dans les vues.
  Les classes sont écrites en entier ici pour que Tailwind les détecte (@source "../web").
*/

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Relief commun des boutons sombres et des boutons-icônes.
const KNOB = 'border border-bronze-600 bg-linear-to-b from-knob-hi to-knob-lo shadow-[inset_0_1px_0_var(--color-glint),0_2px_0_rgba(0,0,0,0.5)]';

const BTN_BASE = 'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded font-display font-bold tracking-[0.08em] whitespace-nowrap uppercase no-underline transition hover:brightness-115 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale disabled:hover:brightness-100';

const BTN_VARIANTS = {
  gold: 'border border-gold-100 bg-linear-to-b from-gold-300 to-gold-600 text-gold-ink shadow-[inset_0_1px_0_rgba(255,250,220,0.6),0_2px_0_var(--color-gold-shadow),0_4px_12px_rgba(200,150,60,0.25)] hover:text-gold-ink',
  dark: `${KNOB} text-parchment-200 hover:text-gold-200`,
  red: 'border border-blood-400 bg-linear-to-b from-blood-600 to-blood-850 text-parchment-50 shadow-[inset_0_1px_0_rgba(255,210,170,0.35),0_2px_0_var(--color-blood-shadow),0_4px_12px_rgba(160,50,25,0.3)] hover:text-parchment-50',
  // Soutien : même relief que le bouton sombre, liseré olive.
  olive: 'border border-olive-500 bg-linear-to-b from-knob-hi to-knob-lo text-olive-300 shadow-[inset_0_1px_0_var(--color-glint),0_2px_0_rgba(0,0,0,0.5)] hover:text-olive-300',
  // Action destructrice discrète (annuler, supprimer).
  danger: `${KNOB} text-blood-350 hover:text-blood-300`,
};

const BTN_SIZES = {
  sm: 'h-8 px-3 text-[11px]',
  md: 'h-10 px-4.5 text-xs',
  lg: 'h-[50px] px-4.5 text-[15px]',
  xl: 'h-[62px] px-8 text-lg',
  // Bouton secondaire du héros de l'accueil.
  hero: 'h-[62px] px-6.5 text-[15px]',
};

/** Classes d'un bouton : btn('gold'), btn('dark', 'sm'), btn('red', 'lg', 'w-full'). */
function btn(variant = 'dark', size = 'md', extra = '') {
  return `${BTN_BASE} ${BTN_VARIANTS[variant] || BTN_VARIANTS.dark} ${BTN_SIZES[size] || BTN_SIZES.md} ${extra}`.trim();
}

const ui = {
  // Panneau à coins dorés (utiliser avec corners()).
  panel: 'relative rounded-md border border-bronze-700 bg-linear-to-b from-panel-top to-panel-lo shadow-[inset_0_0_0_1px_rgba(0,0,0,0.55),inset_0_1px_0_var(--color-glint),0_10px_30px_rgba(0,0,0,0.45)]',
  panelHead: 'flex min-h-[46px] flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-t-md border-b border-bronze-700 bg-linear-to-b from-panel-hi to-panel-mid px-4.5 py-2 shadow-[inset_0_-1px_0_rgba(0,0,0,0.5),inset_0_1px_0_var(--color-glint)]',
  panelTitle: 'm-0 flex min-w-0 items-center gap-2.5 font-display text-sm font-bold tracking-[0.14em] text-gold-400 uppercase',
  panelBody: 'flex flex-col gap-3 px-4.5 py-4',
  diamond: 'size-1.5 shrink-0 rotate-45 bg-gold-400',

  // Textes
  h1: 'font-display text-lg font-bold text-parchment-100',
  heading: 'font-display text-[15px] font-bold text-parchment-100',
  kicker: 'font-display text-[10px] font-bold tracking-[0.14em] text-parchment-500 uppercase',
  muted: 'text-parchment-500',
  faint: 'text-parchment-600',
  num: 'font-extrabold tabular-nums',
  link: 'font-bold text-gold-400 underline underline-offset-2 transition hover:text-gold-200',
  linkPlain: 'text-parchment-100 no-underline transition hover:text-gold-200',
  sectionLabel: 'flex items-center gap-2.5 font-display text-[11px] font-bold tracking-[0.14em] text-parchment-500 uppercase before:h-px before:flex-1 before:bg-bronze-900 after:h-px after:flex-1 after:bg-bronze-900',
  subLabel: 'font-display text-[11px] font-bold tracking-[0.12em] text-parchment-500 uppercase',

  // Formulaires
  label: 'flex flex-col gap-1.5 text-sm text-parchment-400',
  input: 'h-[38px] rounded-[3px] border border-bronze-700 bg-black/50 px-3 text-sm text-parchment-100 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] scheme-dark placeholder:text-parchment-600 focus:border-gold-400 focus:outline-none disabled:opacity-40',
  inputSm: 'h-[30px] rounded-[3px] border border-bronze-700 bg-black/50 px-2.5 text-sm text-parchment-100 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] scheme-dark placeholder:text-parchment-600 focus:border-gold-400 focus:outline-none disabled:opacity-40',
  textarea: 'rounded-[3px] border border-bronze-700 bg-black/50 px-3 py-2 text-sm text-parchment-100 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] scheme-dark placeholder:text-parchment-600 focus:border-gold-400 focus:outline-none',
  checkbox: 'size-[17px] shrink-0 accent-bronze-300',
  checkLabel: 'flex min-h-[30px] items-center gap-2.5 text-[15px] text-parchment-300',

  // Tableau pleine largeur (à placer directement dans le panneau, sans panelBody).
  table: 'w-full border-collapse text-left text-[15px] [&_td]:border-b [&_td]:border-bronze-700/35 [&_td]:px-4.5 [&_td]:py-3 [&_td]:align-middle [&_th]:border-b [&_th]:border-bronze-900 [&_th]:bg-black/25 [&_th]:px-4.5 [&_th]:py-2.5 [&_th]:font-display [&_th]:text-[11px] [&_th]:font-bold [&_th]:tracking-[0.12em] [&_th]:whitespace-nowrap [&_th]:text-parchment-500 [&_th]:uppercase [&_tbody_tr:last-child_td]:border-b-0',
  // Tableau compact, dans un panelBody.
  tableSm: 'w-full border-collapse text-left text-sm [&_td]:border-b [&_td]:border-bronze-700/35 [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-middle [&_th]:border-b [&_th]:border-bronze-900 [&_th]:px-2.5 [&_th]:py-2 [&_th]:font-display [&_th]:text-[10px] [&_th]:font-bold [&_th]:tracking-[0.12em] [&_th]:whitespace-nowrap [&_th]:text-parchment-500 [&_th]:uppercase [&_tbody_tr:last-child_td]:border-b-0',
  rowActive: 'bg-gold-400/8',

  // Encarts
  box: 'rounded border border-bronze-900 bg-black/30',
  boxGold: 'rounded border border-bronze-500 bg-linear-to-r from-gold-400/16 to-gold-400/2',
  boxGoldV: 'rounded border border-bronze-400 bg-linear-to-b from-gold-400/14 to-gold-400/3 shadow-[inset_0_1px_0_var(--color-glint-strong)]',
  boxDashed: 'rounded border border-dashed border-bronze-600',
  tile: 'rounded-[3px] border border-bronze-900 bg-black/30 px-2.5 py-2',
  tileLabel: 'text-xs text-parchment-500',
  tileValue: 'text-[15px] font-extrabold tabular-nums text-parchment-200',
  chip: 'inline-flex items-center gap-1.5 rounded-[3px] border border-bronze-800 bg-black/35 px-2.5 py-1 text-[13px] text-parchment-300',

  // Pastilles
  countBadge: 'flex h-4 min-w-4 items-center justify-center rounded-lg border border-blood-200 bg-linear-to-b from-blood-500 to-blood-800 px-1 text-[10px] font-extrabold text-parchment-50',
  levelBadge: 'flex h-[22px] min-w-6 items-center justify-center rounded-t-[3px] rounded-b-[10px] border border-blood-100 bg-linear-to-b from-blood-650 to-blood-900 px-1 font-display text-xs font-extrabold text-parchment-50 shadow-[0_2px_3px_rgba(0,0,0,0.6)]',
  tagRed: 'inline-flex items-center rounded-[2px] border border-blood-400 bg-linear-to-b from-blood-600 to-blood-850 px-2 py-0.5 font-display text-[10px] font-extrabold tracking-[0.12em] text-parchment-50 uppercase',
  tagSolidRed: 'inline-flex items-center rounded-[2px] bg-blood-850 px-2 py-0.5 font-display text-[10px] font-extrabold tracking-[0.12em] text-parchment-50 uppercase',
  tagOlive: 'inline-flex items-center rounded-[2px] bg-olive-700 px-2 py-0.5 font-display text-[10px] font-extrabold tracking-[0.12em] text-parchment-50 uppercase',
  tagGold: 'inline-flex items-center rounded-[3px] border border-gold-400 bg-gold-400/13 px-2 py-0.5 font-display text-[10px] font-bold tracking-[0.12em] text-gold-400 uppercase',
  tagMuted: 'inline-flex items-center rounded-[3px] border border-bronze-600 bg-black/35 px-2 py-0.5 font-display text-[10px] font-bold tracking-[0.12em] text-parchment-400 uppercase',

  // Médaillons (icône dans un cercle de bronze) : ajouter une taille (size-8, size-[42px]…).
  medallion: 'flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-bronze-400 bg-radial-[at_35%_30%] from-well-hi to-well-lo to-75% text-gold-400 shadow-[inset_0_0_0_2px_rgba(0,0,0,0.55),0_2px_4px_rgba(0,0,0,0.5)]',
  medallionGold: 'flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-gold-400 bg-radial-[at_35%_30%] from-well-hi to-well-lo to-75% text-gold-200 shadow-[inset_0_0_0_2px_rgba(0,0,0,0.55),0_2px_4px_rgba(0,0,0,0.5)]',
  medallionRed: 'flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-blood-700 bg-radial-[at_35%_30%] from-well-hi to-well-lo to-75% text-blood-300',
  medallionOlive: 'flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-olive-500 bg-radial-[at_35%_30%] from-well-hi to-well-lo to-75% text-olive-300',

  // Boutons-icônes carrés (flèches, fermer, annuler).
  iconBtn: `inline-flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded ${KNOB} text-gold-400 transition hover:text-gold-200 disabled:cursor-not-allowed disabled:opacity-40`,
  // Bouton-icône actif (page courante, action principale).
  iconBtnOn: 'inline-flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded border border-gold-400 bg-linear-to-b from-knob-hi to-knob-lo text-gold-200 shadow-[inset_0_1px_0_var(--color-glint),0_2px_0_rgba(0,0,0,0.5)] transition hover:text-gold-50',
  iconBtnSm: `inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded ${KNOB} text-blood-350 transition hover:text-blood-300`,

  // Onglets segmentés (VUE CITÉ / LISTE, SORTANTS / ENTRANTS…).
  seg: 'flex flex-wrap gap-0.5 rounded-[5px] border border-bronze-800 bg-black/45 p-[3px]',
  segOn: 'inline-flex h-7 items-center rounded-[3px] border border-bronze-500 bg-linear-to-b from-knob-on-hi to-knob-on-lo px-3 font-display text-[11px] font-bold tracking-[0.1em] text-gold-200 uppercase no-underline',
  segOff: 'inline-flex h-7 items-center rounded-[3px] border border-transparent px-3 font-display text-[11px] font-bold tracking-[0.1em] text-parchment-500 uppercase no-underline transition hover:text-gold-200',

  // Barre de progression
  track: 'block h-1.5 overflow-hidden rounded-full bg-black/60 shadow-[inset_0_0_0_1px_var(--color-glint)]',
  fill: 'block h-full bg-linear-to-r from-gold-600 to-gold-200',

  // Messages
  alertError: 'rounded border border-blood-700 bg-blood-850/25 px-4 py-3 text-[15px] text-blood-200',
  alertSuccess: 'rounded border border-olive-500 bg-olive-700/25 px-4 py-3 text-[15px] text-olive-300',
  alertInfo: 'rounded border border-bronze-500 bg-gold-400/10 px-4 py-3 text-[15px] text-gold-200',

  // Grand titre doré (logo, héros).
  goldText: 'bg-linear-to-b from-gold-50 via-gold-500 to-gold-700 bg-clip-text text-transparent',

  // Liste déroulante (<details>) : panneau flottant.
  popover: 'absolute z-30 mt-2 rounded-md border border-bronze-700 bg-panel-lo p-3 shadow-[0_10px_30px_rgba(0,0,0,0.6)]',
};

/** Les quatre équerres dorées aux angles d'un panneau. */
function corners() {
  const c = 'pointer-events-none absolute size-2 border-bronze-300';
  return `<span class="${c} top-[3px] left-[3px] border-t-2 border-l-2" aria-hidden="true"></span>`
    + `<span class="${c} top-[3px] right-[3px] border-t-2 border-r-2" aria-hidden="true"></span>`
    + `<span class="${c} bottom-[3px] left-[3px] border-b-2 border-l-2" aria-hidden="true"></span>`
    + `<span class="${c} right-[3px] bottom-[3px] border-r-2 border-b-2" aria-hidden="true"></span>`;
}

/**
 * En-tête de panneau : losange doré + titre en capitales, contenu libre à droite (HTML).
 * panelHead('Chantiers', '<span>3 / 5</span>') ; panelHead('Carte', '', { tag: 'h1' }).
 */
function panelHead(title, right = '', { tag = 'h2', id = '' } = {}) {
  return `<div class="${ui.panelHead}"><${tag} class="${ui.panelTitle}"${id ? ` id="${esc(id)}"` : ''}><span class="${ui.diamond}" aria-hidden="true"></span><span class="min-w-0 truncate">${esc(title)}</span></${tag}>${right}</div>`;
}

/** Onglets segmentés : [[href, libellé, actif], …]. */
function segTabs(items) {
  return `<nav class="${ui.seg}">${items.map(([href, label, on]) => `<a href="${esc(href)}" class="${on ? ui.segOn : ui.segOff}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
}

module.exports = { ui, btn, corners, panelHead, segTabs, esc };
