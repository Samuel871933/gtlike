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
  let tile = Number(frame.dataset.tile);

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

  // ------------------------------------------------------------------ Décor déterministe (comme le serveur l'était)
  const rnd = (a, b, s) => {
    let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const biomeAt = (x, y) => (
    rnd(Math.floor(x / 5), Math.floor(y / 5), 11)
    + rnd(Math.floor((x + 3) / 5), Math.floor((y + 3) / 5), 19)
  ) / 2;
  // Un grand décor n'est placé que sur le minimum local de son voisinage : cela forme des amas espacés,
  // au lieu de remplir chaque case avec le même gros sprite.
  const isAnchor = (x, y, seed, radius, ceiling) => {
    const n = rnd(x, y, seed);
    if (n > ceiling) return false;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if ((dx || dy) && rnd(x + dx, y + dy, seed) < n) return false;
      }
    }
    return true;
  };
  const terrain = (x, y) => {
    const biome = biomeAt(x, y);
    if (biome > 0.44 && biome < 0.61 && isAnchor(x, y, 73, 3, 0.11)) return 'lake';
    if (biome > 0.69 && isAnchor(x, y, 67, 3, 0.16)) return 'hill';
    if (biome < 0.48 && isAnchor(x, y, 43, 2, 0.2)) return 'forest';
    if (biome < 0.52 && rnd(x, y, 29) < 0.22) return 'trees';
    if (biome < 0.58 && rnd(x, y, 23) < 0.11) return 'pine';
    if (rnd(x, y, 31) < 0.032) return 'rocks';
    return null;
  };
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
    const at = (x, y) => `left:${(x - x0) * tile}px;top:${(y - y0) * tile}px`;
    for (let y = y0; y < y0 + span; y++) {
      for (let x = x0; x < x0 + span; x++) {
        if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) {
          out.push(`<div class="absolute size-(--tile) bg-map-edge" style="${at(x, y)}"></div>`);
          continue;
        }
        const c = cells.get(key(x, y));
        // Calques d'influence : cases voisines d'un village à soi ou de sa tribu, ou d'un ennemi.
        if (near(x, y, ['current', 'own', 'tribe'])) out.push(`<div class="pointer-events-none absolute hidden size-(--tile) bg-blood-700/25 group-data-[layer-influence]/map:block" style="${at(x, y)}"></div>`);
        else if (near(x, y, ['enemy'])) out.push(`<div class="pointer-events-none absolute hidden size-(--tile) bg-rel-enemy/20 group-data-[layer-enemy]/map:block" style="${at(x, y)}"></div>`);
        if (c) {
          out.push(`<div class="map-tile map-tile--village absolute flex size-(--tile) cursor-pointer items-center justify-center" style="${at(x, y)}" data-map-tile data-x="${x}" data-y="${y}"${sel && sel[0] === x && sel[1] === y ? ' data-selected' : ''} aria-label="${esc(`${c.name} ${x}|${y} · ${c.points} pts · ${c.owner}`)}">${villageHtml(c)}</div>`);
        } else {
          const t = terrain(x, y);
          // Le décor principal dessine les biomes. Une seconde couche, indépendante, ajoute de petits
          // arbres et cailloux entre les villages et jusque dans les grands amas pour lier le paysage.
          const decorations = t ? [t] : [];
          const accent = rnd(x, y, 101);
          const besideVillage = near(x, y, ['current', 'own', 'tribe', 'ally', 'nap', 'enemy', 'other', 'barb']);
          const pineChance = besideVillage ? 0.34 : 0.16;
          const rockChance = besideVillage ? 0.08 : 0.045;
          if (accent < pineChance) decorations.push('pine');
          else if (accent < pineChance + rockChance) decorations.push('rocks');
          if (t === 'forest' && rnd(x, y, 107) < 0.72) decorations.push('pine');
          decorations.forEach((kind, i) => {
            const scale = (0.84 + rnd(x, y, 37 + i * 7) * 0.22).toFixed(2);
            const flip = rnd(x, y, 41 + i * 11) > 0.5 ? -1 : 1;
            const dx = i ? Math.round((rnd(x, y, 113 + i) - 0.5) * tile * 0.72) : 0;
            const dy = i ? Math.round((rnd(x, y, 127 + i) - 0.5) * tile * 0.58) : 0;
            out.push(`<div class="map-decor map-decor--${kind} pointer-events-none absolute" style="${at(x, y)};--decor-scale:${scale};--decor-flip:${flip};--decor-x:${dx}px;--decor-y:${dy}px" aria-hidden="true"><span></span></div>`);
          });
          if (sel && sel[0] === x && sel[1] === y) out.push(`<div class="map-tile pointer-events-none absolute size-(--tile) bg-none" style="${at(x, y)}" data-selected></div>`);
        }
      }
    }
    // Frontières de continent (tous les 100 cases) et quadrillage de 5 cases (fond du calque).
    for (let x = Math.ceil(x0 / 100) * 100; x < x0 + span; x += 100) out.push(`<div class="pointer-events-none absolute top-0 z-[5] hidden h-full border-l-[3px] border-dashed border-gold-400/80 group-data-[layer-borders]/map:block" style="left:${(x - x0) * tile}px"></div>`);
    for (let y = Math.ceil(y0 / 100) * 100; y < y0 + span; y += 100) out.push(`<div class="pointer-events-none absolute left-0 z-[5] hidden w-full border-t-[3px] border-dashed border-gold-400/80 group-data-[layer-borders]/map:block" style="top:${(y - y0) * tile}px"></div>`);
    out.push(`<div class="map-grid-lines pointer-events-none absolute inset-0 z-[4] hidden group-data-[layer-grid]/map:block" style="--grid-x:${(5 - (((x0 % 5) + 5) % 5)) % 5};--grid-y:${(5 - (((y0 % 5) + 5) % 5)) % 5}"></div>`);
    out.push(arrows(x0, y0));
    layer.innerHTML = out.join('');
    layer.style.width = `${span * tile}px`;
    layer.style.height = `${span * tile}px`;
    // Texture d'herbe (6 × 6 cases) calée sur les coordonnées du monde.
    layer.style.setProperty('--terrain-x', String(-(((x0 % 6) + 6) % 6)));
    layer.style.setProperty('--terrain-y', String(-(((y0 % 6) + 6) % 6)));
    rulers();
    place();
  }

  // Flèches des attaques en cours depuis ce village.
  function arrows(x0, y0) {
    if (!boot.attacks.length) return '';
    const px = (x) => (x - x0 + 0.5) * tile;
    const py = (y) => (y - y0 + 0.5) * tile;
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
    const lab = (v, me) => `text-[11px] font-semibold tabular-nums ${v === me ? 'text-gold-200' : 'text-parchment-500'}`;
    let hx = '';
    let hy = '';
    for (let i = 0; i < span; i++) {
      hx += `<span class="absolute top-0 flex h-full items-center justify-center ${lab(baseX + i, meX)}" style="left:${i * tile}px;width:${tile}px">${baseX + i}</span>`;
      hy += `<span class="absolute right-0 flex w-full items-center justify-end pr-[5px] ${lab(baseY + i, meY)}" style="top:${i * tile}px;height:${tile}px">${baseY + i}</span>`;
    }
    rulerX.innerHTML = `<div class="absolute inset-y-0 left-0" data-inner>${hx}</div>`;
    rulerY.innerHTML = `<div class="absolute inset-x-0 top-0" data-inner>${hy}</div>`;
  }

  // Décale le calque pour montrer la zone centrée sur (cx, cy) ; redessine si l'on sort de la marge chargée.
  function place() {
    const left = cx - half;
    const top = cy - half;
    if (left < baseX + 1 || top < baseY + 1 || left + size > baseX + span - 1 || top + size > baseY + span - 1) { render(); return; }
    const ox = -(left - baseX) * tile;
    const oy = -(top - baseY) * tile;
    layer.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
    rulerX.firstChild.style.transform = `translateX(${ox}px)`;
    rulerY.firstChild.style.transform = `translateY(${oy}px)`;
    drawMini();
  }

  // Sur ordinateur, les cases gardent une taille fixe : augmenter le nombre de cases agrandit réellement
  // la carte au lieu de tout rapetisser. Seuls les petits écrans bénéficient d'une adaptation limitée.
  function fit() {
    const row = frame.closest('[data-map-row]');
    const avail = (row ? row.clientWidth : window.innerWidth) - 16 - 36 - 8;
    const nominal = Number(frame.dataset.tile);
    const mobile = window.matchMedia('(max-width: 639px)').matches;
    const next = mobile ? Math.max(34, Math.min(nominal, Math.floor(avail / Math.min(size, 11)))) : nominal;
    if (next !== tile || !frame.style.getPropertyValue('--tile')) {
      tile = next;
      frame.style.setProperty('--tile', `${tile}px`);
    }
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
    cx = clampC(drag.cx - dx / tile);
    cy = clampC(drag.cy - dy / tile);
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
  document.querySelectorAll('[data-map-layer]').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.mapLayer;
      const on = b.getAttribute('aria-pressed') !== 'true';
      frame.toggleAttribute(`data-layer-${k}`, on);
      b.setAttribute('aria-pressed', String(on));
      const body = new URLSearchParams({ _csrf: frame.dataset.csrf, layer: k, on: on ? '1' : '0' });
      fetch(`${base}/map/layers`, { method: 'POST', body, headers: { accept: 'application/json' } }).catch(() => {});
    });
  });

  // ------------------------------------------------------------------ Mini-carte (6 px par case), qui suit la carte
  const mini = document.querySelector('[data-mini-map]');
  let miniSize = mini ? Number(mini.dataset.size) : 0;
  let miniVillages = boot.mini;
  let miniX0 = Math.round(cx) - Math.floor(miniSize / 2);
  let miniY0 = Math.round(cy) - Math.floor(miniSize / 2);
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(`--color-${name}`).trim();
  const miniColors = {
    current: '#ffffff', own: '#f0c74b', tribe: '#3159b8', ally: '#4ba7e8', nap: '#9a8bc4',
    enemy: '#ff2818', other: '#51452b', barb: '#9b9f98',
  };
  function paintOverviewTerrain(g, x0, y0, side, cell, step = 1) {
    const px = side * cell;
    g.fillStyle = '#58732f';
    g.fillRect(0, 0, px, px);
    const patch = Math.max(step, 4);
    for (let oy = 0; oy < side; oy += patch) {
      for (let ox = 0; ox < side; ox += patch) {
        const biome = biomeAt(x0 + ox + Math.floor(patch / 2), y0 + oy + Math.floor(patch / 2));
        if (biome < .38) g.fillStyle = '#496629';
        else if (biome > .72) g.fillStyle = '#64743a';
        else g.fillStyle = biome < .54 ? '#54702d' : '#5d7833';
        g.fillRect(ox * cell, oy * cell, Math.min(patch, side - ox) * cell, Math.min(patch, side - oy) * cell);
      }
    }
  }
  let miniFrame = 0;
  function drawMini() {
    if (!mini || miniFrame) return;
    miniFrame = requestAnimationFrame(() => {
      miniFrame = 0;
      const ratio = window.devicePixelRatio || 1;
      const w = Math.round(mini.clientWidth * ratio);
      if (!w) return;
      if (mini.width !== w) { mini.width = w; mini.height = w; }
      const g = mini.getContext('2d');
      const cell = w / miniSize;
      paintOverviewTerrain(g, miniX0, miniY0, miniSize, cell);
      for (let i = 0; i <= miniSize; i++) {
        const x = miniX0 + i; const y = miniY0 + i;
        if (x % 10 === 0) { g.fillStyle = x % 100 === 0 ? 'rgba(12,18,8,.78)' : 'rgba(15,23,10,.22)'; g.fillRect(Math.round(i * cell), 0, x % 100 === 0 ? 2 * ratio : ratio, w); }
        if (y % 10 === 0) { g.fillStyle = y % 100 === 0 ? 'rgba(12,18,8,.78)' : 'rgba(15,23,10,.22)'; g.fillRect(0, Math.round(i * cell), w, y % 100 === 0 ? 2 * ratio : ratio); }
      }
      for (const [x, y, kind] of miniVillages) {
        const marked = kind.startsWith('#');
        const important = marked || ['current', 'own', 'tribe', 'ally', 'nap', 'enemy'].includes(kind);
        const insetRatio = important ? .07 : .15;
        const inset = cell > 4 ? cell * insetRatio : Math.min(cell * insetRatio, ratio * .35);
        const px = (x - miniX0) * cell + inset;
        const py = (y - miniY0) * cell + inset;
        const side = Math.max(1, cell - 2 * inset);
        const color = kind.startsWith('#') ? kind : miniColors[kind] || miniColors.other;
        g.fillStyle = color;
        g.fillRect(px, py, side, side);
      }
      if (meX >= miniX0 && meX < miniX0 + miniSize && meY >= miniY0 && meY < miniY0 + miniSize) {
        g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, ratio);
        g.strokeRect((meX - miniX0) * cell - ratio, (meY - miniY0) * cell - ratio, cell + 2 * ratio, cell + 2 * ratio);
      }
      // Cadre de la zone affichée par la grande carte.
      const fx = (cx - half - miniX0) * cell;
      const fy = (cy - half - miniY0) * cell;
      g.lineWidth = 2 * ratio; g.strokeStyle = '#000'; g.strokeRect(fx, fy, size * cell, size * cell);
      g.lineWidth = ratio; g.strokeStyle = '#f2ece2'; g.strokeRect(fx, fy, size * cell, size * cell);
    });
  }
  // Quand la carte s'éloigne du centre de la mini-carte, celle-ci se recentre (points chargés par /map/mini).
  function recenterMini(x, y, force = false) {
    if (!mini) return;
    const mx = miniX0 + Math.floor(miniSize / 2);
    const my = miniY0 + Math.floor(miniSize / 2);
    if (!force && Math.abs(x - mx) < miniSize / 4 && Math.abs(y - my) < miniSize / 4) return;
    const x0 = x - Math.floor(miniSize / 2);
    const y0 = y - Math.floor(miniSize / 2);
    fetch(`${base}/map/mini?x0=${x0}&y0=${y0}&size=${miniSize}`, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => { if (list) { miniVillages = list; miniX0 = x0; miniY0 = y0; drawMini(); } })
      .catch(() => {});
  }
  if (mini) {
    mini.addEventListener('click', (e) => {
      const r = mini.getBoundingClientRect();
      moveTo(miniX0 + Math.floor((e.clientX - r.left) / r.width * miniSize), miniY0 + Math.floor((e.clientY - r.top) / r.height * miniSize));
    });
    window.addEventListener('resize', drawMini);
  }

  // ------------------------------------------------------------------ Tailles en direct (carte et mini-carte)
  function resizeMap(n) {
    size = n;
    half = Math.floor(size / 2);
    MARGIN = Math.max(4, Math.ceil(size / 3));
    frame.dataset.size = String(size);
    const px = `calc(var(--tile) * ${size})`;
    viewport.style.width = px; viewport.style.height = px;
    rulerX.style.width = px; rulerY.style.height = px;
    render();
    settle();
  }
  function resizeMini(n) {
    if (!mini) return;
    miniSize = n;
    mini.dataset.size = String(n);
    mini.style.width = `${n * 6}px`;
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
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(worldCanvas.clientWidth * ratio);
    if (!w) return;
    worldCanvas.width = w; worldCanvas.height = w;
    const g = worldCanvas.getContext('2d');
    const v = world.view;
    const scale = w / v.side;
    const terrainStep = Math.max(1, Math.ceil(v.side / 160));
    paintOverviewTerrain(g, v.x0, v.y0, v.side, scale, terrainStep);
    // Quadrillage de 10 cases (léger) et frontières de continent (tous les 100) avec leur numéro.
    for (let n = Math.ceil(v.x0 / 10) * 10; n < v.x0 + v.side; n += 10) {
      g.fillStyle = n % 100 === 0 ? 'rgba(12,18,8,.78)' : 'rgba(15,23,10,.2)';
      g.fillRect(Math.round((n - v.x0) * scale), 0, n % 100 === 0 ? 2 * ratio : ratio, w);
    }
    for (let n = Math.ceil(v.y0 / 10) * 10; n < v.y0 + v.side; n += 10) {
      g.fillStyle = n % 100 === 0 ? 'rgba(12,18,8,.78)' : 'rgba(15,23,10,.2)';
      g.fillRect(0, Math.round((n - v.y0) * scale), w, n % 100 === 0 ? 2 * ratio : ratio);
    }
    g.font = `${11 * ratio}px sans-serif`; g.fillStyle = 'rgba(232,224,212,.55)';
    for (let ky = Math.floor(v.y0 / 100); ky * 100 < v.y0 + v.side; ky++) {
      for (let kx = Math.floor(v.x0 / 100); kx * 100 < v.x0 + v.side; kx++) {
        g.fillText(`K${ky}${kx}`, Math.max(0, (kx * 100 - v.x0) * scale) + 4 * ratio, Math.max(0, (ky * 100 - v.y0) * scale) + 13 * ratio);
      }
    }
    const dot = Math.max(1.65 * ratio, scale * .98);
    for (const [x, y, kind] of world.villages) {
      const important = kind.startsWith('#') || ['current', 'own', 'tribe', 'ally', 'nap', 'enemy'].includes(kind);
      const big = kind === 'current' || kind === 'own' ? dot * 1.6 : important ? dot * 1.25 : dot;
      const px = (x - v.x0) * scale + (scale - big) / 2;
      const py = (y - v.y0) * scale + (scale - big) / 2;
      g.fillStyle = '#111'; g.fillRect(px - ratio * .7, py - ratio * .7, big + ratio * 1.4, big + ratio * 1.4);
      g.fillStyle = kind.startsWith('#') ? kind : miniColors[kind] || miniColors.other;
      g.fillRect(px, py, big, big);
    }
    // Zone affichée par la grande carte.
    g.lineWidth = 2 * ratio; g.strokeStyle = '#000';
    g.strokeRect((cx - half - v.x0) * scale, (cy - half - v.y0) * scale, Math.max(4, size * scale), Math.max(4, size * scale));
    g.lineWidth = ratio; g.strokeStyle = '#fff';
    g.strokeRect((cx - half - v.x0) * scale, (cy - half - v.y0) * scale, Math.max(4, size * scale), Math.max(4, size * scale));
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
      const r = worldCanvas.getBoundingClientRect();
      const x = world.view.x0 + Math.floor((e.clientX - r.left) / r.width * world.view.side);
      const y = world.view.y0 + Math.floor((e.clientY - r.top) / r.height * world.view.side);
      closeWorld();
      moveTo(x, y, { animate: Math.hypot(x - cx, y - cy) < size * 2 });
    });
    window.addEventListener('resize', () => { if (!modal.classList.contains('hidden')) drawWorld(); });
  }

  render();
  settle();
}());
