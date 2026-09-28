'use strict';

// Carte du monde, façon Guerre Tribale : cases de taille fixe, villages chargés par secteurs de 20 × 20 cases
// (/map/sector) et déplacement fluide (glisser, flèches, clavier, mini-carte) sans recharger la page.
// Seuls les villages et le décor (forêts, collines, lacs) sont des éléments ; l'herbe est une texture unique.
(function () {
  const frame = document.querySelector('[data-map]');
  if (!frame) return;

  const boot = JSON.parse(document.querySelector('[data-map-boot]').textContent);
  const SECTOR = boot.sector;
  const WORLD = boot.worldSize;
  // Taille de la carte (cases de côté) : modifiable en direct (« Taille de la carte »).
  let size = Number(frame.dataset.size);
  let half = Math.floor(size / 2);
  const base = window.location.pathname.replace(/\/map$/, '');
  const [meX, meY] = frame.dataset.me.split('|').map(Number);
  const viewport = frame.querySelector('[data-map-viewport]');
  const layer = frame.querySelector('[data-map-plane]');
  const rulerX = frame.querySelector('[data-map-ruler-x]');
  const rulerY = frame.querySelector('[data-map-ruler-y]');
  const tip = frame.querySelector('[data-map-tip]');
  const menu = frame.querySelector('[data-map-menu]');
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (s) => `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const continent = (x, y) => `K${Math.floor(y / 100)}${Math.floor(x / 100)}`;

  // État : centre de la vue (décimal pendant un glisser), case mise en évidence.
  let cx = Number(frame.dataset.cx);
  let cy = Number(frame.dataset.cy);
  let sel = frame.dataset.sel ? frame.dataset.sel.split('|').map(Number) : null;
  // Case de Guerre Tribale : 53 × 38 px (réduite sur petit écran, voir fit).
  let tw = Number(frame.dataset.tileW);
  let th = Number(frame.dataset.tileH);
  // Textures d'herbe et d'eau : carrés de 6 cases de large, calés sur le monde (décalage en px).
  const texture = () => 6 * tw;
  const texOffset = (cells, px) => -((((cells * px) % texture()) + texture()) % texture());

  // ------------------------------------------------------------------ Données : secteurs de villages
  const cells = new Map();
  const loaded = new Set();
  const loading = new Set();
  const key = (x, y) => `${x}|${y}`;
  const addSector = (s) => {
    loaded.add(key(s.sx, s.sy));
    for (const c of s.cells) cells.set(key(c.x, c.y), c);
  };
  boot.sectors.forEach(addSector);
  function ensure(x0, y0, x1, y1) {
    const max = Math.ceil(WORLD / SECTOR) - 1;
    for (let sy = Math.max(0, Math.floor(y0 / SECTOR)); sy <= Math.min(max, Math.floor(y1 / SECTOR)); sy++) {
      for (let sx = Math.max(0, Math.floor(x0 / SECTOR)); sx <= Math.min(max, Math.floor(x1 / SECTOR)); sx++) {
        const k = key(sx, sy);
        if (loaded.has(k) || loading.has(k)) continue;
        loading.add(k);
        fetch(`${base}/map/sector?sx=${sx}&sy=${sy}`, { headers: { accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => { if (s) { addSector(s); render(); } })
          .catch(() => {})
          .finally(() => loading.delete(k));
      }
    }
  }

  // ------------------------------------------------------------------ Décor déterministe, partagé avec le serveur
  // (src/game/terrain.js, servi en /js/terrain.js) : le serveur n'y place pas de village sur l'eau, les lacs,
  // les montagnes ni au cœur des forêts.
  const { rnd, forestAt, waterAt, terrain } = window.GTTerrain;

  // Case d'eau d'une grande étendue : eau continue + vrais overlays de rive contenus dans la case.
  function waterHtml(x, y, at) {
    const n = !waterAt(x, y - 1); const e = !waterAt(x + 1, y); const s2 = !waterAt(x, y + 1); const w = !waterAt(x - 1, y);
    const mask = Number(n) | (Number(e) << 1) | (Number(s2) << 2) | (Number(w) << 3);
    const corner = mask === 9 ? 'nw' : mask === 3 ? 'ne' : mask === 6 ? 'se' : mask === 12 ? 'sw' : '';
    const shore = corner
      ? `<span class="map-shore-corner map-shore-corner--${corner}"></span>`
      : `${n ? '<span class="map-shore map-shore--n"></span>' : ''}${e ? '<span class="map-shore map-shore--e"></span>' : ''}${s2 ? '<span class="map-shore map-shore--s"></span>' : ''}${w ? '<span class="map-shore map-shore--w"></span>' : ''}`;
    const bx = texOffset(x, tw); const by = texOffset(y, th);
    return `<div class="map-water pointer-events-none absolute w-(--tile-w) h-(--tile-h)" style="${at};--water-bg-x:${bx}px;--water-bg-y:${by}px">${shore}</div>`;
  }
  // Taille de chaque décor (facteur min, max) : lacs et montagnes très variables, petits décors plus réguliers.
  const DECOR_SCALE = { hill: [0.78, 1.08], pine: [0.8, 1.2], default: [0.84, 1.06] };
  const near = (x, y, kinds, radius = 1) => {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const c = cells.get(key(x + dx, y + dy));
        if (c && kinds.includes(c.kind)) return true;
      }
    }
    return false;
  };

  // ------------------------------------------------------------------ Rendu
  let MARGIN = Math.max(4, Math.ceil(size / 3));
  let baseX = 0;
  let baseY = 0;
  let span = 0;

  function villageHtml(c) {
    const relationHasDot = ['current', 'own', 'tribe', 'ally', 'enemy'].includes(c.kind);
    // Une seule pastille par village : le marquage personnalisé remplace la relation. Les barbares,
    // autres joueurs et PNA sans marquage n'affichent rien.
    const dot = c.mark
      ? `<span class="village-relation-dot hidden group-data-[layer-markers]/map:block" style="background:${esc(c.mark)}"></span>`
      : relationHasDot ? '<span class="village-relation-dot"></span>' : '';
    const fav = c.fav ? '<span class="pointer-events-none absolute top-0 left-0.5 z-[6] text-xs text-gold-200 [text-shadow:1px_1px_0_#000]" aria-hidden="true">★</span>' : '';
    const barb = c.kind === 'barb' ? ' group-data-[layer-nobarb]/map:hidden' : '';
    return `<span class="contents${barb}"><span class="village-marker village-marker--${c.kind} village-marker--${c.level}" aria-hidden="true"><span class="village-sprite"></span>${dot}${c.special ? '<span class="village-special">★</span>' : ''}</span></span>${fav}`;
  }

  function render() {
    fit();
    const x0 = Math.floor(cx) - half - MARGIN;
    const y0 = Math.floor(cy) - half - MARGIN;
    span = size + 2 * MARGIN;
    baseX = x0;
    baseY = y0;
    ensure(x0, y0, x0 + span - 1, y0 + span - 1);
    const out = [];
    const at = (x, y) => `left:${(x - x0) * tw}px;top:${(y - y0) * th}px`;
    for (let y = y0; y < y0 + span; y++) {
      for (let x = x0; x < x0 + span; x++) {
        if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) {
          out.push(`<div class="absolute w-(--tile-w) h-(--tile-h) bg-map-edge" style="${at(x, y)}"></div>`);
          continue;
        }
        const c = cells.get(key(x, y));
        // Calques d'influence : cases voisines d'un village à soi ou de sa tribu, ou d'un ennemi.
        if (near(x, y, ['current', 'own', 'tribe'])) out.push(`<div class="pointer-events-none absolute hidden w-(--tile-w) h-(--tile-h) bg-blood-700/25 group-data-[layer-influence]/map:block" style="${at(x, y)}"></div>`);
        else if (near(x, y, ['enemy'])) out.push(`<div class="pointer-events-none absolute hidden w-(--tile-w) h-(--tile-h) bg-rel-enemy/20 group-data-[layer-enemy]/map:block" style="${at(x, y)}"></div>`);
        // Sol des forêts assombri (fondu vers les lisières), villages compris : pas de clairières carrées.
        const woods = forestAt(x, y);
        if (woods) out.push(`<div class="pointer-events-none absolute w-(--tile-w) h-(--tile-h)" style="${at(x, y)};background:rgb(22 40 12 / ${(0.1 + 0.3 * woods).toFixed(2)})"></div>`);
        if (c) {
          out.push(`<div class="map-tile map-tile--village absolute flex w-(--tile-w) h-(--tile-h) cursor-pointer items-center justify-center" style="${at(x, y)}" data-map-tile data-x="${x}" data-y="${y}"${sel && sel[0] === x && sel[1] === y ? ' data-selected' : ''} aria-label="${esc(`${c.name} ${x}|${y} · ${c.points} pts · ${c.owner}`)}">${villageHtml(c)}</div>`);
        } else {
          const ground = terrain(x, y);
          if (ground === 'water') {
            out.push(waterHtml(x, y, at(x, y)));
            if (sel && sel[0] === x && sel[1] === y) out.push(`<div class="map-tile pointer-events-none absolute w-(--tile-w) h-(--tile-h) bg-none" style="${at(x, y)}" data-selected></div>`);
            continue;
          }
          // En forêt : pas de lac ni de colline, mais bosquets et sapins, plus serrés au cœur du massif.
          const t = ground === 'forest' ? (rnd(x, y, 141) < 0.25 + 0.45 * woods ? 'trees' : 'pine') : ground;
          // Le décor principal dessine les biomes. Une seconde couche, indépendante, ajoute de petits
          // arbres et cailloux entre les villages et jusque dans les grands amas pour lier le paysage.
          const decorations = t ? [t] : [];
          const accent = rnd(x, y, 101);
          const besideVillage = near(x, y, ['current', 'own', 'tribe', 'ally', 'nap', 'enemy', 'other', 'barb']);
          const pineChance = besideVillage ? 0.34 : 0.16;
          const rockChance = besideVillage ? 0.08 : 0.045;
          if (accent < pineChance) decorations.push('pine');
          else if (accent < pineChance + rockChance) decorations.push('rocks');
          if (woods) {
            // Arbres plus nombreux vers le cœur du massif : 1 à 5 par case.
            const extra = Math.floor(woods * 3.2 + rnd(x, y, 107) * 1.4);
            for (let k = 0; k < extra; k++) decorations.push(rnd(x, y, 151 + k) < 0.3 ? 'trees' : 'pine');
          }
          // Arbres seuls : parfois deux ou trois dans la même case (décalés, voir dx / dy).
          if (decorations.includes('pine')) {
            const more = rnd(x, y, 131);
            if (more < 0.38) decorations.push('pine');
            if (more < 0.14) decorations.push('pine');
          }
          decorations.forEach((kind, i) => {
            const [min, max] = DECOR_SCALE[kind] || DECOR_SCALE.default;
            const scale = (min + rnd(x, y, 37 + i * 7) * (max - min)).toFixed(2);
            const flip = rnd(x, y, 41 + i * 11) > 0.5 ? -1 : 1;
            // Le décor principal reste centré ; les suivants (et tous les arbres seuls d'une case à plusieurs) sont décalés.
            const shifted = i || (kind === 'pine' && decorations.length > 1);
            const dx = shifted ? Math.round((rnd(x, y, 113 + i) - 0.5) * tw * 0.72) : 0;
            const dy = shifted ? Math.round((rnd(x, y, 127 + i) - 0.5) * th * 0.58) : 0;
            out.push(`<div class="map-decor map-decor--${kind} pointer-events-none absolute" style="${at(x, y)};--decor-scale:${scale};--decor-flip:${flip};--decor-x:${dx}px;--decor-y:${dy}px" aria-hidden="true"><span></span></div>`);
          });
          if (sel && sel[0] === x && sel[1] === y) out.push(`<div class="map-tile pointer-events-none absolute w-(--tile-w) h-(--tile-h) bg-none" style="${at(x, y)}" data-selected></div>`);
        }
      }
    }
    // Frontières de continent (tous les 100 cases) et quadrillage de 5 cases (fond du calque).
    for (let x = Math.ceil(x0 / 100) * 100; x < x0 + span; x += 100) out.push(`<div class="pointer-events-none absolute top-0 z-[5] hidden h-full border-l-[3px] border-dashed border-gold-400/80 group-data-[layer-borders]/map:block" style="left:${(x - x0) * tw}px"></div>`);
    for (let y = Math.ceil(y0 / 100) * 100; y < y0 + span; y += 100) out.push(`<div class="pointer-events-none absolute left-0 z-[5] hidden w-full border-t-[3px] border-dashed border-gold-400/80 group-data-[layer-borders]/map:block" style="top:${(y - y0) * th}px"></div>`);
    out.push(`<div class="map-grid-lines pointer-events-none absolute inset-0 z-[4] hidden group-data-[layer-grid]/map:block" style="--grid-x:${(5 - (((x0 % 5) + 5) % 5)) % 5};--grid-y:${(5 - (((y0 % 5) + 5) % 5)) % 5}"></div>`);
    out.push(arrows(x0, y0));
    layer.innerHTML = out.join('');
    layer.style.width = `${span * tw}px`;
    layer.style.height = `${span * th}px`;
    // Texture d'herbe (6 cases de large) calée sur les coordonnées du monde.
    layer.style.setProperty('--terrain-px', `${texOffset(x0, tw)}px`);
    layer.style.setProperty('--terrain-py', `${texOffset(y0, th)}px`);
    rulers();
    place();
  }

  // Flèches des attaques en cours depuis ce village.
  function arrows(x0, y0) {
    if (!boot.attacks.length) return '';
    const px = (x) => (x - x0 + 0.5) * tw;
    const py = (y) => (y - y0 + 0.5) * th;
    let line = '';
    let heads = '';
    for (const [tx, ty] of boot.attacks) {
      const [sx0, sy0, x1, y1] = [px(meX), py(meY), px(tx), py(ty)];
      const dx = x1 - sx0; const dy = y1 - sy0; const L = Math.hypot(dx, dy) || 1; const ux = dx / L; const uy = dy / L;
      const ex = x1 - ux * 13; const ey = y1 - uy * 13; const bx = ex - ux * 8; const by = ey - uy * 8;
      line += `M${(sx0 + ux * 18).toFixed(1)} ${(sy0 + uy * 18).toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`;
      heads += `M${ex.toFixed(1)} ${ey.toFixed(1)}L${(bx - uy * 5).toFixed(1)} ${(by + ux * 5).toFixed(1)}L${(bx + uy * 5).toFixed(1)} ${(by - ux * 5).toFixed(1)}Z`;
    }
    return `<svg class="pointer-events-none absolute inset-0 z-[7] overflow-visible" width="100%" height="100%" aria-hidden="true"><path d="${line}" class="stroke-blood-450" stroke-width="2" stroke-dasharray="6 5" fill="none"/><path d="${heads}" class="fill-blood-450"/></svg>`;
  }

  function rulers() {
    const lab = (v, me) => `text-[11px] font-semibold tabular-nums [text-shadow:1px_1px_0_#000] ${v === me ? 'text-gold-200' : 'text-parchment-100'}`;
    let hx = '';
    let hy = '';
    for (let i = 0; i < span; i++) {
      hx += `<span class="absolute top-0 flex h-full items-center justify-center ${lab(baseX + i, meX)}" style="left:${i * tw}px;width:${tw}px">${baseX + i}</span>`;
      hy += `<span class="absolute right-0 flex w-full items-center justify-center ${lab(baseY + i, meY)}" style="top:${i * th}px;height:${th}px">${baseY + i}</span>`;
    }
    rulerX.innerHTML = `<div class="absolute inset-y-0 left-0" data-inner>${hx}</div>`;
    rulerY.innerHTML = `<div class="absolute inset-x-0 -top-5" data-inner>${hy}</div>`;
  }

  // Décale le calque pour montrer la zone centrée sur (cx, cy) ; redessine si l'on sort de la marge chargée.
  function place() {
    const left = cx - half;
    const top = cy - half;
    if (left < baseX + 1 || top < baseY + 1 || left + size > baseX + span - 1 || top + size > baseY + span - 1) { render(); return; }
    const ox = -(left - baseX) * tw;
    const oy = -(top - baseY) * th;
    layer.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
    rulerX.firstChild.style.transform = `translateX(${ox}px)`;
    rulerY.firstChild.style.transform = `translateY(${oy}px)`;
    drawMini();
  }

  // Sur ordinateur, les cases gardent la taille de Guerre Tribale : augmenter le nombre de cases agrandit
  // réellement la carte (et la page si besoin, voir widen). Seuls les petits écrans réduisent les cases.
  function fit() {
    const row = frame.closest('[data-map-row]');
    const avail = (row ? row.clientWidth : window.innerWidth) - 16 - 8;
    const nominal = Number(frame.dataset.tileW);
    const mobile = window.matchMedia('(max-width: 639px)').matches;
    const next = mobile ? Math.max(34, Math.min(nominal, Math.floor(avail / Math.min(size, 11)))) : nominal;
    if (next !== tw || !frame.style.getPropertyValue('--tile-w')) {
      tw = next;
      th = Math.round(next * Number(frame.dataset.tileH) / nominal);
      frame.style.setProperty('--tile-w', `${tw}px`);
      frame.style.setProperty('--tile-h', `${th}px`);
      frame.style.setProperty('--tile', `${th}px`);
    }
    widen();
  }
  // La page (1500 px au plus) s'élargit quand la carte ne tient plus : 30 × 30 cases = 1590 px de carte.
  const main = frame.closest('main');
  function widen() {
    if (!main) return;
    // Cadre et marges du panneau (≈ 24 px), marges de la page (20 px) ; les règles sont posées sur la carte.
    const needed = size * tw + 24 + 20;
    main.style.maxWidth = needed > 1500 ? `${needed}px` : '';
    layoutAside();
  }
  // Mise en page à la taille du contenu, calculée ici (une ligne flexible à retour ne sait pas se mesurer) :
  // chaque colonne à la largeur exacte de sa carte (la carte, la mini-carte ; 250 px au moins), côte à côte si
  // elles tiennent dans la page, sinon la colonne de droite passe dessous, sur toute la largeur.
  const aside = document.querySelector('[data-map-aside]');
  const pageBlock = frame.closest('[data-map-page]');
  const col = frame.closest('[data-map-col]');
  function layoutAside() {
    if (!aside || !pageBlock || !main) return;
    const cell = mini ? Number(mini.dataset.cell) : 5;
    // 250 px au moins : largeur minimale de la recherche et des ordres rapides (petites mini-cartes centrées).
    const asideW = Math.max(250, (mini ? Number(mini.dataset.size) : 0) * cell + 28);
    // Carte, cadre et marges du panneau (22 px).
    const colW = size * tw + 22;
    const avail = main.clientWidth - 20;
    const side = colW + 16 + asideW <= avail;
    pageBlock.style.width = `${Math.min(avail, side ? colW + 16 + asideW : colW)}px`;
    aside.style.width = side ? `${asideW}px` : '100%';
    col.style.width = `${Math.min(avail, colW)}px`;
  }

  // ------------------------------------------------------------------ Déplacements
  const clampC = (v) => Math.max(0, Math.min(WORLD - 1, v));
  let anim = null;
  function moveTo(x, y, { animate = true } = {}) {
    x = clampC(x); y = clampC(y);
    cancelAnimationFrame(anim);
    hideTip(); closeMenu();
    if (!animate) { cx = x; cy = y; place(); settle(); return; }
    const [fx, fy] = [cx, cy];
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 220);
      const e = 1 - (1 - t) ** 3;
      cx = fx + (x - fx) * e; cy = fy + (y - fy) * e;
      place();
      if (t < 1) anim = requestAnimationFrame(step); else settle();
    };
    anim = requestAnimationFrame(step);
  }

  // Fin de déplacement : adresse, titre, champs « Aller à », mini-carte.
  let settleTimer = null;
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const x = Math.round(cx); const y = Math.round(cy);
      const url = new URL(window.location.href);
      url.searchParams.set('x', x); url.searchParams.set('y', y);
      for (const p of ['sx', 'sy', 'mark', 'label', 'world', 'size', 'mini', 'q', 'find']) url.searchParams.delete(p);
      window.history.replaceState(null, '', url.toString() + (url.hash || ''));
      const title = document.querySelector('[data-map-title]');
      if (title) title.textContent = `Continent ${continent(x, y)}`;
      const range = document.querySelector('[data-map-range]');
      if (range) range.textContent = `${x - half}–${x - half + size - 1} × ${y - half}–${y - half + size - 1}`;
      const go = document.querySelector('[data-map-goto]');
      if (go) { go.elements.x.value = x; go.elements.y.value = y; }
      recenterMini(x, y);
    }, 120);
  }

  // Glisser : le calque suit la souris (ou le doigt) ; un appui sans déplacement est un clic sur la case.
  let drag = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.map-controls')) return;
    cancelAnimationFrame(anim);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx, cy, moved: false, tile: e.target.closest('[data-map-tile]') };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) { drag.moved = true; viewport.classList.add('is-dragging'); hideTip(); closeMenu(); }
    cx = clampC(drag.cx - dx / tw);
    cy = clampC(drag.cy - dy / th);
    place();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    viewport.classList.remove('is-dragging');
    if (d.moved) { settle(); return; }
    if (d.tile) { selectTile(d.tile); openMenu(d.tile); } else closeMenu();
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  // Flèches du cadre et clavier (flèches : 1 case, Maj + flèche : une demi-carte).
  frame.querySelectorAll('[data-map-step]').forEach((b) => b.addEventListener('click', () => {
    const [dx, dy] = b.dataset.mapStep.split(',').map(Number);
    moveTo(Math.round(cx) + dx * Math.max(1, half), Math.round(cy) + dy * Math.max(1, half));
  }));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    const n = e.shiftKey ? Math.max(1, half) : 1;
    moveTo(Math.round(cx) + dir[0] * n, Math.round(cy) + dir[1] * n);
  });
  const home = frame.querySelector('[data-map-center-home]');
  if (home) home.addEventListener('click', () => moveTo(meX, meY));
  const homeLink = document.querySelector('[data-map-home]');
  if (homeLink) homeLink.addEventListener('click', (e) => { e.preventDefault(); moveTo(meX, meY); });
  const goto = document.querySelector('[data-map-goto]');
  if (goto) {
    goto.addEventListener('submit', (e) => {
      const x = Number.parseInt(goto.elements.x.value, 10);
      const y = Number.parseInt(goto.elements.y.value, 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      e.preventDefault();
      sel = [clampC(x), clampC(y)];
      moveTo(x, y, { animate: Math.hypot(x - cx, y - cy) < size * 2 });
      render();
    });
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 100); });

  // ------------------------------------------------------------------ Infobulle et menu d'actions
  const cellOf = (el) => cells.get(key(Number(el.dataset.x), Number(el.dataset.y)));
  function placeBeside(el, target) {
    const f = frame.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const left = r.left - f.left;
    const top = r.top - f.top;
    const flipX = left + r.width + el.offsetWidth + 8 > frame.clientWidth;
    const flipY = top + el.offsetHeight > frame.clientHeight;
    const clamp = (v, max) => Math.max(4, Math.min(v, max - 4));
    el.style.left = `${clamp(flipX ? left - el.offsetWidth - 6 : left + r.width + 6, frame.clientWidth - el.offsetWidth)}px`;
    el.style.top = `${clamp(flipY ? top + r.height - el.offsetHeight : top, frame.clientHeight - el.offsetHeight)}px`;
  }
  const hideTip = () => tip && tip.classList.add('hidden');
  function showTip(el) {
    const d = cellOf(el);
    if (!d || !tip) return;
    const set = (k, v) => { const n = tip.querySelector(`[data-tip="${k}"]`); if (n) n.textContent = v; };
    const show = (row, on) => tip.querySelectorAll(`[data-tip-row="${row}"]`).forEach((n) => n.classList.toggle('hidden', !on));
    const dist = Math.hypot(d.x - meX, d.y - meY);
    set('name', d.name);
    set('coords', `(${d.x}|${d.y})`);
    set('k', continent(d.x, d.y));
    set('points', d.points);
    set('owner', d.owner);
    set('ownerInfo', d.ownerInfo ? `(${d.ownerInfo})` : '');
    set('tribe', d.tribe);
    set('tribeName', d.tribeName);
    set('tribeInfo', d.tribeInfo ? `(${d.tribeInfo})` : '');
    show('tribe', Boolean(d.tribeName));
    set('rel', d.rel);
    set('dist', `${(Math.round(dist * 10) / 10).toLocaleString('fr-FR')} cases`);
    show('dist', dist > 0);
    const travel = tip.querySelector('[data-tip-travel]');
    if (travel) {
      travel.classList.toggle('hidden', !dist);
      travel.querySelectorAll('[data-tip-pace]').forEach((n) => { n.textContent = fmt(Math.round(dist * Number(n.dataset.tipPace) * 60)); });
    }
    set('morale', d.morale || '');
    const mor = tip.querySelector('[data-tip="morale"]');
    if (mor) mor.classList.toggle('text-blood-450', Boolean(d.morale) && d.morale !== '100 %');
    show('morale', Boolean(d.morale));
    tip.classList.remove('hidden');
    placeBeside(tip, el);
  }
  viewport.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-map-tile]');
    if (!el || drag || !menu.classList.contains('hidden')) { if (!el) hideTip(); return; }
    showTip(el);
  });
  viewport.addEventListener('pointerleave', hideTip);

  function selectTile(el) {
    sel = [Number(el.dataset.x), Number(el.dataset.y)];
    layer.querySelectorAll('[data-selected]').forEach((n) => { if (n.hasAttribute('data-map-tile')) n.removeAttribute('data-selected'); else n.remove(); });
    el.setAttribute('data-selected', '');
  }

  const MENU_ICONS = {
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    attack: '<path d="M5 19L17 7M14 4h6v6M4 16l4 4"/>',
    support: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 9v6M9 12h6"/>',
    market: '<path d="M12 4v16M7 20h10M5 8h14"/><path d="M5 8l-3 6h6zM19 8l-3 6h6z"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
    center: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    open: '<path d="M3 9l9-5 9 5z"/><path d="M5 20h14M6 17h12M7 17V10M11 17V10M13 17V10M17 17V10"/>',
    star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    mark: '<path d="M6 21V3"/><path d="M6 4h11l-3 4 3 4H6"/>',
  };
  const MENU_COLORS = { attack: 'text-blood-500', support: 'text-steel-300', star: 'text-gold-200', mark: 'text-gold-400' };
  const closeMenu = () => menu && menu.classList.add('hidden');
  function openMenu(el) {
    const d = cellOf(el);
    if (!d || !menu) { closeMenu(); return; }
    hideTip();
    const mine = d.kind === 'current' || d.kind === 'own';
    const spy = Number(frame.dataset.spy) || 0;
    const quick = readQuick();
    const tplOption = document.querySelector(`[data-quick-template] option[value="${quick.tpl || ''}"]`);
    const tplUnits = tplOption && tplOption.dataset.units ? new URLSearchParams(JSON.parse(tplOption.dataset.units)).toString() : '';
    const target = `x=${d.x}&y=${d.y}${tplUnits ? `&${tplUnits}` : ''}`;
    const allowed = (k) => quick[k] !== false;
    const markUrl = (type, id, label) => `${base}/map?${new URLSearchParams({ x: Math.round(cx), y: Math.round(cy), mark: `${type}:${id}`, label })}#marquages`;
    const actions = mine
      ? [['open', 'Ouvrir le village', `/village/${d.id}`], ['attack', 'Recruter', `/village/${d.id}/recruit/barracks`], ['center', 'Centrer ici', null, 'center']]
      : [
        ['eye', 'Voir le village', `${base}/villages/${d.id}`],
        ...(allowed('attack') ? [['attack', tplOption && tplOption.value ? `Attaquer · ${tplOption.textContent}` : 'Attaquer', `${base}/place?${target}`]] : []),
        ...(allowed('support') ? [['support', tplOption && tplOption.value ? `Soutenir · ${tplOption.textContent}` : 'Envoyer du soutien', `${base}/place?${target}`]] : []),
        ...(spy && allowed('spy') ? [['eye', `Espionner (${spy} éclaireur${spy > 1 ? 's' : ''})`, `${base}/place?x=${d.x}&y=${d.y}&spy=${spy}`]] : []),
        ['market', 'Envoyer des ressources', `${base}/market?tab=send&x=${d.x}&y=${d.y}`],
        ...(d.playerId ? [['profile', 'Profil du joueur', `${base}/players/${d.playerId}`]] : []),
        ['center', 'Centrer ici', null, 'center'],
        ['star', d.fav ? 'Retirer des favoris' : 'Ajouter aux favoris', `${base}/favorites/${d.id}`, 'post'],
        ...(d.playerId ? [['mark', `Marquer le joueur ${d.owner}`, markUrl('player', d.playerId, d.owner)]] : []),
        ...(d.tribeId ? [['mark', `Marquer la tribu [${d.tribe}]`, markUrl('tribe', d.tribeId, `[${d.tribe}]`)]] : []),
        ['mark', 'Marquer ce village', markUrl('village', d.id, `${d.name} (${d.x}|${d.y})`)],
      ];
    menu.querySelector('[data-menu-t="name"]').textContent = d.name;
    menu.querySelector('[data-menu-t="coords"]').textContent = `(${d.x}|${d.y})${d.morale ? ` · morale ${d.morale}` : ''}`;
    const item = 'flex w-full cursor-pointer items-center gap-2 border-b border-bronze-800 px-2 py-1.5 text-left font-semibold no-underline hover:bg-head-dark hover:text-parchment-100';
    const svg = (ic) => `<svg class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MENU_ICONS[ic]}</svg>`;
    menu.querySelector('[data-menu-t="actions"]').innerHTML = actions.map(([ic, label, href, kind]) => {
      const cls = `${item} ${MENU_COLORS[ic] || 'text-parchment-300'}`;
      if (kind === 'post') return `<form method="post" action="${esc(href)}"><input type="hidden" name="_csrf" value="${esc(frame.dataset.csrf)}"><button class="${cls}">${svg(ic)}${esc(label)}</button></form>`;
      if (kind === 'center') return `<button type="button" class="${cls}" data-map-center="${d.x}|${d.y}">${svg(ic)}${esc(label)}</button>`;
      return `<a href="${esc(href)}" class="${cls}">${svg(ic)}${esc(label)}</a>`;
    }).join('');
    menu.classList.remove('hidden');
    placeBeside(menu, el);
  }
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-map-center]');
    if (!b) return;
    const [x, y] = b.dataset.mapCenter.split('|').map(Number);
    moveTo(x, y);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-map-menu]') && !e.target.closest('[data-map-viewport]')) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // ------------------------------------------------------------------ Ordres rapides (choix mémorisés dans le navigateur)
  const QUICK_KEY = 'gtlike.quickOrders';
  function readQuick() {
    try { return JSON.parse(localStorage.getItem(QUICK_KEY) || '{}') || {}; } catch (err) { return {}; }
  }
  function saveQuick(q) {
    try { localStorage.setItem(QUICK_KEY, JSON.stringify(q)); } catch (err) { /* stockage indisponible */ }
  }
  const quickPanel = document.querySelector('[data-quick-orders]');
  if (quickPanel) {
    const q = readQuick();
    const select = quickPanel.querySelector('[data-quick-template]');
    if (q.tpl && select.querySelector(`option[value="${q.tpl}"]`)) select.value = q.tpl;
    select.addEventListener('change', () => { saveQuick({ ...readQuick(), tpl: select.value }); closeMenu(); });
    quickPanel.querySelectorAll('[data-quick-action]').forEach((box) => {
      const k = box.dataset.quickAction;
      if (q[k] === false) box.checked = false;
      box.addEventListener('change', () => { saveQuick({ ...readQuick(), [k]: box.checked }); closeMenu(); });
    });
  }

  // ------------------------------------------------------------------ Calques (mémorisés sur le joueur)
  // Aussi appliqués à la mini-carte et à la carte du monde (public/js/minimap.js).
  const LAYER_KEYS = ['markers', 'influence', 'enemy', 'nobarb', 'grid', 'borders'];
  const layersOn = () => Object.fromEntries(LAYER_KEYS.map((k) => [k, frame.hasAttribute(`data-layer-${k}`)]));
  document.querySelectorAll('[data-map-layer]').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.mapLayer;
      const on = b.getAttribute('aria-pressed') !== 'true';
      frame.toggleAttribute(`data-layer-${k}`, on);
      b.setAttribute('aria-pressed', String(on));
      drawMini();
      if (modal && !modal.classList.contains('hidden')) drawWorld();
      const body = new URLSearchParams({ _csrf: frame.dataset.csrf, layer: k, on: on ? '1' : '0' });
      fetch(`${base}/map/layers`, { method: 'POST', body, headers: { accept: 'application/json' } }).catch(() => {});
    });
  });

  // ------------------------------------------------------------------ Mini-carte (5 px par case), qui suit la carte
  const mini = document.querySelector('[data-mini-map]');
  let miniSize = mini ? Number(mini.dataset.size) : 0;
  let miniVillages = boot.mini;
  let miniX0 = Math.round(cx) - Math.floor(miniSize / 2);
  let miniY0 = Math.round(cy) - Math.floor(miniSize / 2);
  // Dessin commun à toutes les mini-cartes : public/js/minimap.js.
  let miniFrame = 0;
  function drawMini() {
    if (!mini || miniFrame) return;
    miniFrame = requestAnimationFrame(() => {
      miniFrame = 0;
      window.GTMinimap.draw(mini, {
        x0: miniX0, y0: miniY0, width: miniSize, height: miniSize, villages: miniVillages,
        frame: { x: cx - half, y: cy - half, size }, layers: layersOn(),
      });
    });
  }
  // Points d'un carré de la mini-carte (/map/mini). Ils remplacent ceux de ce carré et s'ajoutent aux autres, pour
  // que la mini-carte reste remplie quand on la fait glisser. `move` : la mini-carte se cale ensuite sur ce carré.
  function loadMini(x0, y0, move) {
    fetch(`${base}/map/mini?x0=${x0}&y0=${y0}&size=${miniSize}`, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        if (!list) return;
        const inside = ([x, y]) => x >= x0 && y >= y0 && x < x0 + miniSize && y < y0 + miniSize;
        miniVillages = [...miniVillages.filter((v) => !inside(v)), ...list];
        if (move) { miniX0 = x0; miniY0 = y0; }
        drawMini();
      })
      .catch(() => {});
  }
  // Quand la carte s'éloigne du centre de la mini-carte, celle-ci se recentre.
  function recenterMini(x, y, force = false) {
    if (!mini || miniDrag) return;
    const mx = miniX0 + Math.floor(miniSize / 2);
    const my = miniY0 + Math.floor(miniSize / 2);
    if (!force && Math.abs(x - mx) < miniSize / 4 && Math.abs(y - my) < miniSize / 4) return;
    loadMini(x - Math.floor(miniSize / 2), y - Math.floor(miniSize / 2), true);
  }
  // Glisser la mini-carte, comme sur Guerre Tribale : on l'attrape, elle suit la souris case par case et la carte
  // suit. Un appui sans déplacement recentre la carte sur la case visée.
  let miniDrag = null;
  let miniLoad = null;
  if (mini) {
    mini.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      miniDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: Math.round(cx), cy: Math.round(cy), x0: miniX0, y0: miniY0, ox: 0, oy: 0, moved: false };
      mini.setPointerCapture(e.pointerId);
    });
    mini.addEventListener('pointermove', (e) => {
      const d = miniDrag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x; const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) { d.moved = true; mini.classList.add('cursor-grabbing'); }
      const cell = mini.getBoundingClientRect().width / miniSize;
      const ox = Math.round(dx / cell); const oy = Math.round(dy / cell);
      if (ox === d.ox && oy === d.oy) return;
      d.ox = ox; d.oy = oy;
      miniX0 = d.x0 - ox; miniY0 = d.y0 - oy;
      moveTo(d.cx - ox, d.cy - oy, { animate: false });
      // Points de la zone découverte, chargés dès que le glisser marque une pause.
      clearTimeout(miniLoad);
      miniLoad = setTimeout(() => loadMini(miniX0, miniY0, false), 120);
    });
    const endMiniDrag = (e) => {
      const d = miniDrag;
      if (!d || e.pointerId !== d.id) return;
      miniDrag = null;
      mini.classList.remove('cursor-grabbing');
      if (!d.moved) moveTo(...window.GTMinimap.cellAt(mini, { x0: miniX0, y0: miniY0, width: miniSize, height: miniSize }, e));
    };
    mini.addEventListener('pointerup', endMiniDrag);
    mini.addEventListener('pointercancel', endMiniDrag);
    window.addEventListener('resize', () => { layoutAside(); drawMini(); });
  }

  // ------------------------------------------------------------------ Tailles en direct (carte et mini-carte)
  function resizeMap(n) {
    size = n;
    half = Math.floor(size / 2);
    MARGIN = Math.max(4, Math.ceil(size / 3));
    frame.dataset.size = String(size);
    const w = `calc(var(--tile-w) * ${size})`;
    const h = `calc(var(--tile-h) * ${size})`;
    viewport.style.width = w; viewport.style.height = h;
    render();
    settle();
  }
  function resizeMini(n) {
    if (!mini) return;
    miniSize = n;
    mini.dataset.size = String(n);
    mini.style.width = `${n * Number(mini.dataset.cell)}px`;
    layoutAside();
    const label = document.querySelector('[data-mini-label]');
    if (label) label.textContent = `${n} × ${n}`;
    recenterMini(Math.round(cx), Math.round(cy), true);
  }
  document.querySelectorAll('[data-map-resize]').forEach((select) => {
    select.addEventListener('change', () => {
      const n = Number(select.value);
      if (select.dataset.mapResize === 'size') resizeMap(n); else resizeMini(n);
      const body = new URLSearchParams({ _csrf: frame.dataset.csrf, [select.dataset.mapResize]: String(n) });
      fetch(`${base}/map/settings`, { method: 'POST', body, headers: { accept: 'application/json' } }).catch(() => {});
    });
  });
  const settingsForm = document.querySelector('[data-map-settings]');
  if (settingsForm) settingsForm.addEventListener('submit', (e) => e.preventDefault());

  // ------------------------------------------------------------------ Carte du monde : fenêtre sur la page
  const modal = document.querySelector('[data-world-modal]');
  // À la racine de la page : au-dessus de l'en-tête et de tout le contenu (sinon pris dans l'empilement de <main>).
  if (modal) document.body.appendChild(modal);
  const worldCanvas = modal && modal.querySelector('[data-world-canvas]');
  let world = null;
  // Cadrage : la zone peuplée du monde (villages + marge), pas les 1000 × 1000 cases presque vides.
  function worldView() {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of world.villages) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (!Number.isFinite(x0)) return { x0: 0, y0: 0, side: world.size };
    const side = Math.min(world.size, Math.max(100, Math.round(Math.max(x1 - x0, y1 - y0) * 1.25) + 20));
    const clampV = (v) => Math.max(0, Math.min(world.size - side, v));
    return { x0: clampV(Math.round((x0 + x1) / 2 - side / 2)), y0: clampV(Math.round((y0 + y1) / 2 - side / 2)), side };
  }
  function drawWorld() {
    if (!world || !worldCanvas) return;
    const v = world.view;
    window.GTMinimap.draw(worldCanvas, {
      x0: v.x0, y0: v.y0, width: v.side, height: v.side, villages: world.villages,
      frame: { x: cx - half, y: cy - half, size }, layers: layersOn(),
    });
  }
  function openWorld() {
    if (!modal) return;
    modal.classList.remove('hidden'); modal.classList.add('flex');
    hideTip(); closeMenu();
    if (world) { drawWorld(); return; }
    fetch(`${base}/map/world`, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        world = data;
        world.view = worldView();
        const stat = (k, v) => { const n = modal.querySelector(`[data-world-stat="${k}"]`); if (n) n.textContent = v.toLocaleString('fr-FR'); };
        stat('all', data.villages.length);
        stat('barb', data.villages.filter((v) => v[2] === 'barb').length);
        stat('own', data.villages.filter((v) => v[2] === 'own' || v[2] === 'current').length);
        drawWorld();
      })
      .catch(() => {});
  }
  const closeWorld = () => { if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } };
  document.querySelectorAll('[data-world-open]').forEach((b) => b.addEventListener('click', openWorld));
  if (modal) {
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-world-close]')) closeWorld(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWorld(); });
    worldCanvas.addEventListener('click', (e) => {
      if (!world) return;
      const v = world.view;
      const [x, y] = window.GTMinimap.cellAt(worldCanvas, { x0: v.x0, y0: v.y0, width: v.side, height: v.side }, e);
      closeWorld();
      moveTo(x, y, { animate: Math.hypot(x - cx, y - cy) < size * 2 });
    });
    window.addEventListener('resize', () => { if (!modal.classList.contains('hidden')) drawWorld(); });
  }

  render();
  settle();
}());
