'use strict';

/*
  Composants de la charte (maquette « Adarma », maquettes/Adarma.html) sous forme de chaînes de classes Tailwind.
  Style « BD » : encre noire (bordures 2px), filet intérieur, ombre portée franche décalée, aucun arrondi.
  Typographie sobre : casse normale, graisses moyennes (semi-gras pour l'emphase), capitales réservées aux tags.
  Aucun CSS maison : chaque composant n'est qu'un assemblage d'utilitaires, réutilisé dans les vues.
  Les classes sont écrites en entier ici pour que Tailwind les détecte (@source "../web").
*/

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Relief commun : trait d'encre, filet intérieur, ombre portée.
const INK = 'border-2 border-black';
const SHADOW = 'shadow-[inset_0_0_0_1px_var(--color-bronze-700),5px_5px_0_#050505]';

const BTN_BASE = 'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 border-2 border-black font-semibold tracking-[0.01em] whitespace-nowrap no-underline transition-[transform,background-color,color] hover:-translate-y-px active:translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale disabled:hover:translate-y-0';

const BTN_VARIANTS = {
  // Action principale (Améliorer, Jouer, Connexion).
  gold: 'bg-action text-on-accent shadow-[inset_0_0_0_1px_var(--color-action-line),inset_0_-3px_0_var(--color-action-deep),3px_3px_0_#050505] hover:bg-action-hi hover:text-on-accent active:shadow-[inset_0_0_0_1px_var(--color-action-line),1px_1px_0_#050505]',
  // Action secondaire : fond d'encre, filet et texte bronze.
  dark: 'bg-panel-lo text-gold-400 shadow-[inset_0_0_0_1px_var(--color-bronze-500),3px_3px_0_#050505] hover:bg-knob-hover hover:text-parchment-100',
  // Attaque : toujours rouge sang, quel que soit le style de jeu.
  red: 'bg-blood-700 text-on-accent shadow-[inset_0_0_0_1px_var(--color-blood-400),inset_0_-3px_0_var(--color-blood-900),3px_3px_0_#050505] hover:bg-blood-600 hover:text-on-accent active:shadow-[inset_0_0_0_1px_var(--color-blood-400),1px_1px_0_#050505]',
  // Soutien : fond d'encre, filet olive.
  olive: 'bg-panel-lo text-olive-300 shadow-[inset_0_0_0_1px_var(--color-olive-500),3px_3px_0_#050505] hover:bg-olive-700/40 hover:text-parchment-100',
  // Action destructrice discrète (annuler, supprimer).
  danger: 'bg-blood-900 text-on-accent shadow-[inset_0_0_0_1px_var(--color-blood-800),2px_2px_0_#050505] hover:bg-blood-600',
};

const BTN_SIZES = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-3.5 text-[15px] minimal:text-sm',
  lg: 'h-11 px-4 text-base minimal:text-[15px]',
  xl: 'h-14 px-8 text-xl',
  // Bouton secondaire du héros de l'accueil.
  hero: 'h-14 px-6 text-base',
};

/** Classes d'un bouton : btn('gold'), btn('dark', 'sm'), btn('red', 'lg', 'w-full'). */
function btn(variant = 'dark', size = 'md', extra = '') {
  return `${BTN_BASE} ${BTN_VARIANTS[variant] || BTN_VARIANTS.dark} ${BTN_SIZES[size] || BTN_SIZES.md} ${extra}`.trim();
}

const FIELD = 'border-2 border-black bg-night text-parchment-100 shadow-[inset_0_0_0_1px_var(--color-bronze-700)] scheme-dark light:scheme-light placeholder:text-parchment-700 focus:shadow-[inset_0_0_0_1px_var(--color-gold-400)] focus:outline-none disabled:opacity-40';

const ui = {
  // Panneau : aplat sombre, trait d'encre, filet intérieur, ombre portée.
  // Style de jeu minimaliste : trait fin brun (1 px, voir app.css) au lieu de l'encre noire.
  panel: `relative ${INK} bg-panel-top ${SHADOW} minimal:border-bronze-500`,
  // Bandeau rouge souligné de bronze (fin en style de jeu minimaliste, comme les en-têtes de Guerre Tribale).
  panelHead: 'flex min-h-[34px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b-2 border-bronze-500 bg-head px-3 py-1.5 shadow-[inset_0_-1px_0_#000] minimal:min-h-6 minimal:border-b minimal:py-0.5 minimal:text-[13px]',
  panelTitle: 'm-0 flex min-w-0 items-center gap-2 text-base font-semibold text-parchment-100 minimal:text-sm',
  panelBody: 'flex flex-col gap-3 p-3',
  diamond: 'size-[7px] shrink-0 rotate-45 border border-black bg-gold-400 minimal:size-[5px]',

  // Textes
  h1: 'font-display text-xl font-semibold tracking-[0.02em] text-parchment-100 minimal:text-lg',
  heading: 'font-display text-base font-semibold tracking-[0.02em] text-parchment-100',
  kicker: 'text-[13px] font-medium text-gold-400',
  // Encart de la colonne de droite de l'accueil (connexion, parties en cours, mondes, serveurs privés).
  lobbyCard: 'flex min-w-0 flex-col border-2 border-black bg-panel-top shadow-[inset_0_0_0_1px_var(--color-bronze-500),5px_5px_0_#000]',
  lobbyCardHead: 'border-b-2 border-bronze-500 bg-head px-3 py-2 font-display text-[17px] font-semibold tracking-[0.02em]',
  muted: 'text-parchment-500',
  faint: 'text-parchment-600',
  num: 'font-semibold tabular-nums',
  link: 'font-medium text-gold-400 no-underline transition hover:text-parchment-100',
  linkPlain: 'text-parchment-100 no-underline transition hover:text-gold-400',
  sectionLabel: 'flex items-center gap-2.5 text-sm font-semibold text-gold-400 after:h-0.5 after:flex-1 after:bg-linear-to-r after:from-bronze-500 after:to-transparent',
  subLabel: 'text-[13px] font-medium text-gold-400',

  // Formulaires
  label: 'flex flex-col gap-1 text-[13px] font-medium text-parchment-400',
  input: `h-9 px-2.5 text-[15px] tracking-normal normal-case minimal:text-sm ${FIELD}`,
  inputSm: `h-8 px-2 text-sm font-medium tracking-normal normal-case ${FIELD}`,
  textarea: `px-2.5 py-2 text-[15px] tracking-normal normal-case minimal:text-sm ${FIELD}`,
  checkbox: 'size-4 shrink-0 accent-blood-700',
  checkLabel: 'flex min-h-[30px] items-center gap-2 text-[15px] text-parchment-300 minimal:min-h-6 minimal:text-sm',

  // Tableau pleine largeur (à placer directement dans le panneau, sans panelBody).
  table: 'w-full border-collapse text-left text-[15px] [&_td]:border-b [&_td]:border-bronze-800 [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_th]:border-b-2 [&_th]:border-black [&_th]:bg-thead [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-[13px] [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-gold-400 [&_tbody_tr:nth-child(even)]:bg-row-alt [&_tbody_tr:hover]:bg-row-hover [&_tbody_tr:last-child_td]:border-b-0 minimal:text-sm minimal:[&_th]:py-1 minimal:[&_th]:text-xs',
  // Tableau compact, dans un panelBody.
  tableSm: 'w-full border-collapse text-left text-sm [&_td]:border-b [&_td]:border-bronze-800 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-middle [&_th]:border-b-2 [&_th]:border-black [&_th]:bg-thead [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-gold-400 [&_tbody_tr:last-child_td]:border-b-0',
  // Ligne du joueur (classements, membres) : fond doré, filet à gauche, texte clair.
  rowActive: 'bg-gold-200/12 [&>td]:bg-gold-200/12 [&>td]:text-gold-50 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-gold-400)]',

  // Encarts
  box: 'border border-bronze-800 bg-panel-lo shadow-[1px_1px_0_#000]',
  boxGold: 'border border-bronze-800 border-l-4 border-l-bronze-500 bg-panel-top',
  boxGoldV: 'border-2 border-black bg-night shadow-[inset_0_0_0_1px_var(--color-bronze-500),3px_3px_0_#050505]',
  boxDashed: 'border border-dashed border-bronze-700',
  tile: 'border border-bronze-800 border-t-2 border-t-bronze-500 bg-night px-2.5 py-1',
  tileLabel: 'text-xs text-parchment-500',
  tileValue: 'text-base font-semibold tabular-nums text-parchment-100',
  chip: 'inline-flex items-center gap-1.5 border border-bronze-800 bg-night px-2 py-0.5 text-[13px] font-medium text-parchment-300 shadow-[inset_0_-2px_0_var(--color-panel-lo),1px_1px_0_#000]',

  // Pastilles
  countBadge: 'flex h-4 min-w-4 items-center justify-center border border-black bg-blood-600 px-1 text-[11px] font-semibold tracking-normal text-on-accent shadow-[1px_1px_0_#000]',
  levelBadge: 'flex h-4 min-w-6 items-center justify-center border border-gold-400 bg-night px-1 text-[11px] font-semibold text-gold-400',
  tagRed: 'inline-flex items-center border border-black bg-blood-600 px-1.5 py-px text-[11px] font-semibold tracking-[0.04em] text-on-accent uppercase shadow-[1px_1px_0_#000]',
  tagSolidRed: 'inline-flex items-center border border-black bg-blood-800 px-1.5 py-px text-[11px] font-semibold tracking-[0.04em] text-on-accent uppercase',
  tagOlive: 'inline-flex items-center border border-black bg-olive-700 px-1.5 py-px text-[11px] font-semibold tracking-[0.04em] text-parchment-100 uppercase',
  tagGold: 'inline-flex items-center border border-gold-400 bg-night px-1.5 py-px text-[11px] font-semibold tracking-[0.04em] text-gold-400 uppercase',
  tagMuted: 'inline-flex items-center border border-bronze-700 bg-night px-1.5 py-px text-[11px] font-semibold tracking-[0.04em] text-parchment-500 uppercase',

  // Pictogrammes (icône dans un carré d'encre) : ajouter une taille (size-8, size-[42px]…).
  medallion: 'flex shrink-0 items-center justify-center border-2 border-black bg-night text-gold-400 shadow-[inset_0_0_0_1px_var(--color-bronze-700),2px_2px_0_#000]',
  medallionGold: 'flex shrink-0 items-center justify-center border-2 border-black bg-gold-400 text-night shadow-[2px_2px_0_#000]',
  medallionRed: 'flex shrink-0 items-center justify-center border-2 border-black bg-blood-600 text-night shadow-[2px_2px_0_#000]',
  medallionOlive: 'flex shrink-0 items-center justify-center border-2 border-black bg-olive-500 text-night shadow-[2px_2px_0_#000]',

  // Boutons-icônes carrés (flèches, fermer, annuler).
  iconBtn: 'inline-flex size-[30px] minimal:size-6 shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-panel-hi text-parchment-300 shadow-[inset_0_0_0_1px_var(--color-bronze-700),2px_2px_0_#000] transition hover:bg-head-dark hover:text-parchment-100 disabled:cursor-not-allowed disabled:opacity-40',
  // Bouton-icône actif (page courante, action principale).
  iconBtnOn: 'inline-flex size-[30px] minimal:size-6 shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-blood-800 text-on-accent shadow-[inset_0_0_0_1px_var(--color-gold-400),2px_2px_0_#000] transition hover:bg-blood-700',
  iconBtnSm: 'inline-flex size-[22px] shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-blood-900 text-on-accent shadow-[1px_1px_0_#000] transition hover:bg-blood-600',

  // Onglets segmentés (VUE VILLAGE / LISTE, SORTANTS / ENTRANTS…), posés sur un bandeau rouge.
  seg: 'flex flex-wrap gap-0.5',
  segOn: 'inline-flex h-7 items-center border border-black bg-night px-2.5 text-sm font-semibold text-gold-200 no-underline',
  segOff: 'inline-flex h-7 items-center border border-black px-2.5 text-sm font-medium text-parchment-300 no-underline transition hover:bg-head-dark hover:text-parchment-100',

  // Barre de progression : rail d'encre, remplissage hachuré rouge, bord bronze.
  track: 'block h-[7px] overflow-hidden border border-black bg-night',
  fill: 'block h-full border-r-2 border-gold-400 bg-[repeating-linear-gradient(135deg,var(--color-action)_0_5px,var(--color-action-deep)_5px_10px)]',

  // Messages
  alertError: 'border-2 border-black border-l-4 border-l-blood-600 bg-blood-900/60 px-3 py-2 text-[15px] text-parchment-100 shadow-[3px_3px_0_#050505] minimal:text-sm',
  alertSuccess: 'border-2 border-black border-l-4 border-l-olive-500 bg-olive-700/30 px-3 py-2 text-[15px] text-parchment-100 shadow-[3px_3px_0_#050505] minimal:text-sm',
  alertInfo: 'border-2 border-black border-l-4 border-l-bronze-500 bg-panel-top px-3 py-2 text-[15px] text-parchment-300 shadow-[3px_3px_0_#050505] minimal:text-sm',

  // Grand titre (logo, héros) : aplat parchemin, double ombre d'encre et de sang.
  goldText: 'text-parchment-100 [text-shadow:2px_2px_0_var(--color-title-shadow),3px_3px_0_var(--color-title-shadow-2)]',

  // Liste déroulante (<details>) : panneau flottant.
  popover: 'absolute z-30 mt-1 border-2 border-black bg-panel-top p-2 shadow-[inset_0_0_0_1px_var(--color-bronze-500),5px_5px_0_#000]',
};

/**
 * En-tête de panneau : losange bronze + titre sur bandeau rouge, contenu libre à droite (HTML).
 * panelHead('Chantiers', '<span>3 / 5</span>') ; panelHead('Carte', '', { tag: 'h1' }).
 */
function panelHead(title, right = '', { tag = 'h2', id = '' } = {}) {
  return `<div class="${ui.panelHead}"><${tag} class="${ui.panelTitle}"${id ? ` id="${esc(id)}"` : ''}><span class="${ui.diamond}" aria-hidden="true"></span><span class="min-w-0 truncate">${esc(title)}</span></${tag}>${right}</div>`;
}

/** Onglets segmentés : [[href, libellé, actif], …]. */
function segTabs(items) {
  return `<nav class="${ui.seg}">${items.map(([href, label, on]) => `<a href="${esc(href)}" class="${on ? ui.segOn : ui.segOff}"${on ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
}

/**
 * Onglets segmentés sur desktop, liste déroulante sur mobile (menus de plus de 4 onglets, ou aux libellés longs).
 * Mêmes items que segTabs ; `label` nomme la liste pour les lecteurs d'écran.
 */
function segMenu(items, { label = 'Afficher' } = {}) {
  const options = items.map(([href, name, on]) => `<option value="${esc(href)}"${on ? ' selected' : ''}>${esc(name)}</option>`).join('');
  return `<div class="max-md:hidden">${segTabs(items)}</div>`
    + `<select class="${ui.inputSm} max-w-full md:hidden" aria-label="${esc(label)}" onchange="location.href = this.value">${options}</select>`;
}

module.exports = { ui, btn, panelHead, segTabs, segMenu, esc };
