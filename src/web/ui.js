'use strict';

/*
  Composants de la charte (maquette « Adarma », maquettes/Adarma.html) sous forme de chaînes de classes Tailwind.
  Style « BD » : encre noire (bordures 2px), filet intérieur, ombre portée franche décalée, aucun arrondi.
  Typographie sobre : casse normale, graisses moyennes (semi-gras pour l'emphase), capitales réservées aux tags.
  Aucun CSS maison : chaque composant n'est qu'un assemblage d'utilitaires, réutilisé dans les vues.
  Les classes sont écrites en entier ici pour que Tailwind les détecte (@source "../web").
*/

const NUMBER_FR = new Intl.NumberFormat('fr-FR');
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
  tile: 'border border-bronze-800 border-t-2 border-t-bronze-500 bg-night px-2.5 py-1',
  tileLabel: 'text-xs text-parchment-500',
  tileValue: 'text-base font-semibold tabular-nums text-parchment-100',
  chip: 'inline-flex items-center gap-1.5 border border-bronze-800 bg-night px-2 py-0.5 text-[13px] font-medium text-parchment-300 shadow-[inset_0_-2px_0_var(--color-panel-lo),1px_1px_0_#000]',

  // Pastilles
  countBadge: 'flex h-4 min-w-4 items-center justify-center border border-black bg-blood-600 px-1 text-[11px] font-semibold tracking-normal text-on-accent shadow-[1px_1px_0_#000]',
  levelBadge: 'flex h-4 min-w-6 items-center justify-center border border-gold-400 bg-night px-1 text-[11px] font-semibold text-gold-400',
  tagRed: 'inline-flex items-center border border-black bg-blood-600 px-1.5 py-px text-[11px] font-semibold tracking-[0.04em] text-on-accent uppercase shadow-[1px_1px_0_#000]',
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
  iconBtnOn: 'inline-flex size-[30px] minimal:size-6 shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-action text-on-accent shadow-[inset_0_0_0_1px_var(--color-gold-400),2px_2px_0_#000] transition hover:bg-action-hi',
  iconBtnSm: 'inline-flex size-[22px] shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-blood-900 text-on-accent shadow-[1px_1px_0_#000] transition hover:bg-blood-600',

  // Onglets segmentés (VUE VILLAGE / LISTE, SORTANTS / ENTRANTS…), posés sur un bandeau rouge.
  // Puces de filtre (forum de la tribu, groupes de villages) : la puce active prend le fond du thème.
  filterChip: 'inline-flex h-8 max-w-48 items-center gap-1.5 border-2 border-black bg-panel-hi px-3 text-[13px] font-semibold text-gold-400 no-underline shadow-[2px_2px_0_#000] transition hover:bg-row-hover hover:text-parchment-100',
  filterChipOn: 'inline-flex h-8 max-w-48 items-center gap-1.5 border-2 border-black bg-head-dark px-3 text-[13px] font-semibold text-parchment-100 no-underline shadow-[inset_0_0_0_1px_var(--color-bronze-500),2px_2px_0_#000]',
  seg: 'flex flex-wrap gap-0.5',
  // Onglet actif : fond clair sur le bandeau d'un panneau (déjà à la couleur du thème, data-panel-head), fond du thème
  // ailleurs (comme les puces des forums de la tribu). Fond du thème en valeur arbitraire, pas la classe bg-head-dark :
  // les thèmes clairs recolorent les textes de tout élément qui porte cette classe (adarma.css), même dans un bandeau.
  // Un seul composant pour tous les onglets : segTabs / segMenu.
  segOn: 'inline-flex h-7 items-center gap-1 border border-black bg-night px-2.5 text-sm font-semibold text-gold-200 no-underline not-in-data-panel-head:bg-[var(--color-head-dark)] not-in-data-panel-head:text-on-accent not-in-data-panel-head:shadow-[inset_0_0_0_1px_var(--color-bronze-500)]',
  segOff: 'inline-flex h-7 items-center gap-1 border border-black px-2.5 text-sm font-medium text-parchment-300 no-underline transition hover:bg-head-dark hover:text-parchment-100',

  // Compteur à droite d'un en-tête de panneau (« 3 / 20 », « 12 rapports »).
  headCount: 'text-[13px] font-semibold text-parchment-500 tabular-nums',
  // Valeur mise en évidence (compte à rebours, score, plage horaire).
  figure: 'font-semibold text-gold-200 tabular-nums',
  // Liste vide dans un panneau (« Aucun rapport. »).
  empty: 'px-4.5 py-4 text-parchment-500',
  // Note en bas d'un panneau (règles, limites).
  panelNote: 'px-4.5 py-3 text-[13px] text-parchment-500',
  // Tableau défilant horizontalement, sous un bloc du panneau.
  tableScroll: 'overflow-x-auto border-t border-bronze-900',
  // Page de bâtiment en deux colonnes : illustration et infos à gauche, contenu à droite.
  buildingGrid: 'grid items-start gap-5 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]',
  // Sa colonne de gauche : grande illustration, collée en haut au défilement (vignette dans l'en-tête sous xl).
  buildingAside: 'max-xl:hidden xl:sticky xl:top-24',
  // Corps des formulaires de l'accueil (connexion, inscription, mot de passe oublié).
  authBody: 'flex flex-1 flex-col gap-2.5 p-3.5',

  // Menu latéral (sideNav) : en-tête de groupe en gras sur bande sombre ; lien en poids normal ; lien actif à trait doré.
  sideHead: 'block border-b-2 border-bronze-700 bg-black/15 px-3 py-1.5 text-[13px] font-bold text-parchment-100',
  sideLink: 'flex items-center gap-2 border-l-3 border-transparent py-1.5 pr-3 pl-2.5 font-medium text-gold-400 no-underline transition hover:bg-row-hover hover:text-parchment-100',
  sideLinkOn: 'flex items-center gap-2 border-l-3 border-gold-400 bg-gold-400/15 py-1.5 pr-3 pl-2.5 font-medium text-parchment-100 no-underline',

  // Barre de progression : rail d'encre, remplissage hachuré rouge, bord bronze.
  track: 'block h-[7px] overflow-hidden border border-black bg-night',
  fill: 'block h-full border-r-2 border-gold-400 bg-[repeating-linear-gradient(135deg,var(--color-action)_0_5px,var(--color-action-deep)_5px_10px)]',

  // Messages
  alertError: 'border-2 border-black border-l-4 border-l-blood-600 bg-blood-900/60 light:bg-blood-500/12 px-3 py-2 text-[15px] text-parchment-100 shadow-[3px_3px_0_#050505] minimal:text-sm',
  alertSuccess: 'border-2 border-black border-l-4 border-l-olive-500 bg-olive-700/30 px-3 py-2 text-[15px] text-parchment-100 shadow-[3px_3px_0_#050505] minimal:text-sm',
  alertInfo: 'border-2 border-black border-l-4 border-l-bronze-500 bg-panel-top px-3 py-2 text-[15px] text-parchment-300 shadow-[3px_3px_0_#050505] minimal:text-sm',

  // Liste déroulante (<details>) : panneau flottant.
  popover: 'absolute z-30 mt-1 border-2 border-black bg-panel-top p-2 shadow-[inset_0_0_0_1px_var(--color-bronze-500),5px_5px_0_#000]',
};

/**
 * En-tête de panneau : losange bronze + titre sur bandeau rouge, contenu libre à droite (HTML).
 * panelHead('Chantiers', '<span>3 / 5</span>') ; panelHead('Carte', '', { tag: 'h1' }).
 */
function panelHead(title, right = '', { tag = 'h2', id = '' } = {}) {
  return `<div class="${ui.panelHead}" data-panel-head><${tag} class="${ui.panelTitle}"${id ? ` id="${esc(id)}"` : ''}><span class="${ui.diamond}" aria-hidden="true"></span><span class="min-w-0 truncate">${esc(title)}</span></${tag}>${right}</div>`;
}

/**
 * Onglets segmentés, composant commun de tous les onglets : [[href, libellé, actif, html], …]. `html` : libellé déjà
 * en HTML (compteur tenu à jour par game.js…), sinon le libellé est échappé.
 */
function segTabs(items) {
  return `<nav class="${ui.seg}">${items.map(([href, label, on, html]) => `<a href="${esc(href)}" class="${on ? ui.segOn : ui.segOff}"${on ? ' aria-current="page"' : ''}>${html || esc(label)}</a>`).join('')}</nav>`;
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

/**
 * Menu latéral (rapports, messagerie, marché, classements, modèles de troupes), comme les menus de gauche de GT :
 * colonne sur desktop, liens en ligne sur mobile. Items : { heading } pour un en-tête de groupe, sinon
 * { href, label, active, count, sub (lien en retrait), icon / after (HTML avant / après le libellé), title }.
 * `cls` : classes du <nav> (bordure selon qu'il est dans un panneau ou panneau lui-même) ; `at` : md | lg, largeur à
 * partir de laquelle il passe en colonne.
 */
// Classes du menu latéral selon le point de passage en colonne (écrites en entier pour Tailwind).
const SIDE_AT = {
  md: { list: 'flex flex-wrap md:flex-col', item: 'md:border-b md:border-bronze-900 md:last:border-b-0', sub: 'text-sm md:pl-6', head: 'border-t md:border-t-0' },
  lg: { list: 'flex flex-wrap lg:flex-col', item: 'lg:border-b lg:border-bronze-900 lg:last:border-b-0', sub: 'text-sm lg:pl-6', head: 'border-t lg:border-t-0' },
};

function sideNav(items, { label = 'Menu', cls = '', at = 'md' } = {}) {
  const c = SIDE_AT[at] || SIDE_AT.md;
  const row = (it, i) => {
    if (it.heading) return `<li class="basis-full"><span class="${ui.sideHead}${i ? ` ${c.head}` : ''}">${esc(it.heading)}</span></li>`;
    const count = it.count != null ? `<span class="text-xs text-parchment-500 tabular-nums">${esc(it.count)}</span>` : '';
    const attrs = `${it.title ? ` title="${esc(it.title)}"` : ''}${it.active ? ' aria-current="page"' : ''}`;
    return `<li class="${c.item}"><a href="${esc(it.href)}" class="${it.active ? ui.sideLinkOn : ui.sideLink}${it.sub ? ` ${c.sub}` : ''}"${attrs}>`
      + `${it.icon || ''}<span class="min-w-0 flex-1 truncate">${esc(it.label)}</span>${it.after || ''}${count}</a></li>`;
  };
  return `<nav class="${cls}" aria-label="${esc(label)}"><ul class="${c.list}">${items.map(row).join('')}</ul></nav>`;
}

/**
 * Barre de progression à libellé (fin du monde, sceaux…) : remplissage de `from` à `goal`, rouge, puis vert une fois
 * l'objectif atteint ; texte centré (par défaut « valeur / objectif »). `cls` : largeur, marges ; `size` : 'md', ou 'sm'
 * (barre basse, petit texte : conditions des quêtes).
 * progressBar(18, 20) ; progressBar(590, 918, { from: 300 }) ; progressBar(3, 14, { label: '3 / 14 jours' }).
 */
function progressBar(value, goal, { from = 0, label = null, cls = 'min-w-44', size = 'md' } = {}) {
  const span = goal - from;
  const width = span > 0 ? Math.max(0, Math.min(100, (100 * (value - from)) / span)) : 0;
  const done = goal > 0 && value >= goal;
  const text = label !== null ? label : `${NUMBER_FR.format(Math.floor(value))} / ${NUMBER_FR.format(Math.floor(goal))}`;
  const sm = size === 'sm';
  return `<span class="relative flex ${sm ? 'h-[18px]' : 'h-6'} items-center justify-center overflow-hidden border border-black bg-night shadow-[inset_0_1px_2px_#0006] ${cls}">`
    + `<span class="absolute inset-y-0 left-0 ${done ? 'bg-olive-500' : 'bg-blood-700'}" style="width: ${width.toFixed(1)}%"></span>`
    + `<span class="relative ${sm ? 'text-[11px] leading-none' : 'text-[13px]'} font-semibold text-parchment-100 tabular-nums">${text}</span></span>`;
}

module.exports = { ui, btn, panelHead, segTabs, segMenu, sideNav, esc, progressBar };
