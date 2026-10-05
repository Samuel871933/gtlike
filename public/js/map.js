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
  // Tailles en sixièmes de la largeur de la page (réglage « Taille de la carte », modifiable en direct), jamais plus
  // larges que le conteneur du site : la carte en prend `step`, la mini-carte `miniStep` ; à droite de la carte
  // ou à gauche (`miniPos` side, left), les deux se partagent la largeur (5/6 + 1/6 : toute la page). Sinon elle est en
  // dessous (below) ou par-dessus la carte, dans un coin (over). La fenêtre de la carte fait `viewW` × `viewH` px,
  // au pixel près ; `baseSize` : cases de côté qui y tiennent ; `size` : cases dessinées (impair, pour centrer la
  // case du centre ; moins nombreuses quand on zoome, plus quand on dézoome : `zoom`, molette en tenant la carte,
  // de ×1/3 à ×3). `ox`, `oy` : décalage en px (à l'écran) qui centre ces cases dans la fenêtre.
  let step = Number(frame.dataset.step) || 4;
  let miniStep = Number(frame.dataset.miniStep) || 1;
  let miniPos = frame.dataset.miniPos || 'side';
  const beside = (pos) => pos === 'side' || pos === 'left';
  let viewW = 0;
  let viewH = 0;
  let ox = 0;
  let oy = 0;
  let baseSize = Number(frame.dataset.size);
  let zoom = 1;
  let size = baseSize;
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
  // Heure d'arrivée d'un ordre, à la milliseconde comme sur Guerre Tribale : « 01/10 11:25:21:926 ».
  const arrivalAt = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}:${String(d.getMilliseconds()).padStart(3, '0')}`;
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const continent = (x, y) => `K${Math.floor(y / 100)}${Math.floor(x / 100)}`;

  // État : centre de la vue (décimal pendant un glisser), case mise en évidence.
  let cx = Number(frame.dataset.cx);
  let cy = Number(frame.dataset.cy);
  let sel = frame.dataset.sel ? frame.dataset.sel.split('|').map(Number) : null;
  // Case de Guerre Tribale : 53 × 38 px (réduite sur petit écran, voir fit). La carte est toujours dessinée à cette
  // taille ; le zoom agrandit ou réduit l'image entière (`sw` × `sh` : taille d'une case à l'écran).
  let tw = Number(frame.dataset.tileW);
  let th = Number(frame.dataset.tileH);
  let sw = tw;
  let sh = th;
  // Taille des cases sans zoom (celle de GT, réduite sur petit écran) : elle fixe la taille de la fenêtre de la carte.
  let baseTw = tw;
  let baseTh = th;
  // Textures d'herbe et d'eau : carrés de 6 cases de large, calés sur le monde (décalage en px).
  const texture = () => 6 * tw;
  const texOffset = (cells, px) => -((((cells * px) % texture()) + texture()) % texture());

  // ------------------------------------------------------------------ Données : secteurs de villages
  // Villages par case, clé numérique (x, y) : lue des centaines de fois par bloc dessiné (voir near).
  const cells = new Map();
  const ck = (x, y) => y * 8192 + x;
  const loaded = new Set();
  const loading = new Set();
  const key = (x, y) => `${x}|${y}`;
  // Prochaine arrivée d'un ordre affiché (voir plus bas, « Ordres arrivés »).
  let nextArrival = Infinity;
  const noteArrivals = (c) => {
    for (const o of [...((c.orders && c.orders.own) || []), ...((c.orders && c.orders.tribe) || [])]) {
      const t = new Date(o.arrivesAt).getTime();
      if (t > Date.now() && t < nextArrival) nextArrival = t;
    }
  };
  const addSector = (s) => {
    loaded.add(key(s.sx, s.sy));
    for (const c of s.cells) {
      cells.set(ck(c.x, c.y), c);
      noteArrivals(c);
    }
  };
  // Ordres encore en route : un ordre arrivé disparaît tout de suite de la case et de l'infobulle (voir expireOrders).
  const live = (list) => (list || []).filter((o) => new Date(o.arrivesAt).getTime() > Date.now());
  const liveOrders = (c) => ({ own: live(c.orders && c.orders.own), tribe: live(c.orders && c.orders.tribe) });
  boot.sectors.forEach(addSector);
  // Secteurs manquants de la zone : demandés ensemble (/map/sectors, 16 par requête), puis seuls les blocs
  // touchés sont redessinés (sectorLoaded).
  function ensure(x0, y0, x1, y1) {
    const max = Math.ceil(WORLD / SECTOR) - 1;
    const missing = [];
    for (let sy = Math.max(0, Math.floor(y0 / SECTOR)); sy <= Math.min(max, Math.floor(y1 / SECTOR)); sy++) {
      for (let sx = Math.max(0, Math.floor(x0 / SECTOR)); sx <= Math.min(max, Math.floor(x1 / SECTOR)); sx++) {
        const k = key(sx, sy);
        if (loaded.has(k) || loading.has(k)) continue;
        loading.add(k);
        missing.push([sx, sy]);
      }
    }
    for (let i = 0; i < missing.length; i += 16) {
      const batch = missing.slice(i, i + 16);
      fetch(`${base}/map/sectors?s=${batch.map(([sx, sy]) => `${sx}.${sy}`).join(',')}`, { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((list) => { if (list) list.forEach(sectorLoaded); })
        .catch(() => {})
        .finally(() => batch.forEach(([sx, sy]) => loading.delete(key(sx, sy))));
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
        const c = cells.get(ck(x + dx, y + dy));
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

  // Gommette de la dernière attaque dans l'infobulle (comme sur GT) : composant du serveur (helpers.attackDot),
  // le même que dans l'aperçu du village et les rapports. { win|partial|loss|spy: { html, label } }
  const LAST = boot.attackDots || {};
  const HAUL = { full: 'butin plein', partial: 'butin partiel' };
  const lastDot = (last) => LAST[last.result].html;
  // Note du carnet sur ce village : petite feuille en haut à gauche de la case.
  const NOTE_ICON = '<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 12h8M8 16h6"/></svg>';

  function villageHtml(c) {
    const relationHasDot = ['current', 'own', 'tribe', 'ally', 'enemy'].includes(c.kind);
    // Une seule pastille par village : le marquage personnalisé remplace la relation. Les barbares,
    // autres joueurs et PNA sans marquage n'affichent rien.
    const dot = c.mark
      ? `<span class="village-relation-dot hidden group-data-[layer-markers]/map:block" style="background:${esc(c.mark)}"></span>`
      : relationHasDot ? '<span class="village-relation-dot"></span>' : '';
    const fav = c.fav ? '<span class="pointer-events-none absolute right-0.5 bottom-0 z-[6] text-xs leading-none text-map-label-me [text-shadow:1px_1px_0_#000]" aria-hidden="true">★</span>' : '';
    const barb = c.kind === 'barb' ? ' group-data-[layer-nobarb]/map:hidden' : '';
    const note = c.note ? `<span class="pointer-events-none absolute bottom-0.5 left-0.5 z-[6] flex border border-black bg-[#f4e8c8] p-px text-[#3a2812] shadow-[1px_1px_0_#000]" title="Note">${NOTE_ICON}</span>` : '';
    return `<span class="contents${barb}"><span class="village-marker village-marker--${c.kind} village-marker--${c.level} village-design--${c.design || 'beige'}" aria-hidden="true"><span class="village-sprite"></span>${dot}${c.special ? '<span class="village-special">★</span>' : ''}</span>${note}</span>${fav}`;
  }

  // Pastilles des ordres en cours (en haut à droite, débordant sur la case voisine) : dans un calque au-dessus de
  // tous les villages, et transparentes aux clics pour qu'on puisse toujours cliquer sur le village voisin. Dans
  // la case, elles passeraient sous le village voisin (chaque case de village a son propre z-index).
  function orderBadgesHtml(c, style) {
    const { own, tribe } = liveOrders(c);
    const orders = [...own, ...tribe];
    const active = orders.find((o) => o.type !== 'return');
    const returning = orders.find((o) => o.type === 'return');
    // Ton village attaqué : épées rouges et nombre d'attaques en approche, au-dessus des pastilles d'ordres.
    const incoming = c.incoming
      ? `<span class="flex h-[18px] items-center gap-0.5 border border-black bg-blood-600 px-0.5 text-[10px] leading-none font-semibold text-on-accent tabular-nums shadow-[1px_1px_0_#000]" title="${c.incoming} attaque${c.incoming > 1 ? 's' : ''} en approche">${boot.attackIcon || ''}${c.incoming}</span>`
      : '';
    const marks = incoming + [active, returning].filter(Boolean).map((o) => `<span title="${o.type === 'return' ? 'Troupes en retour' : 'Ordre en cours'}">${o.mapBadge}</span>`).join('');
    return marks ? `<div class="pointer-events-none absolute z-[5] w-(--tile-w) h-(--tile-h)" style="${style}" aria-hidden="true"><span class="absolute top-px -right-5 flex flex-col items-end">${marks}</span></div>` : '';
  }

  // La carte est découpée en blocs de CHUNK × CHUNK cases, posés en coordonnées du monde dans le calque. Un bloc
  // est dessiné une fois puis gardé : glisser ne fait qu'ajouter les blocs qui entrent dans la zone (et retirer ceux
  // qui en sortent), au lieu de redessiner toute la carte. Un bloc n'est redessiné que si les villages de son
  // secteur ou d'un secteur voisin changent (le décor et les zones d'influence dépendent des cases voisines).
  // Les blocs ne créent pas de contexte d'empilement (ni z-index, ni transform) : villages, décors et pastilles
  // de toute la carte se superposent comme s'ils étaient dans un seul calque.
  // 5 cases : assez petit pour que la zone gardée colle à la vue (peu d'éléments), assez grand pour peu de blocs.
  const CHUNK = 5;
  const chunkBox = document.createElement('div');
  const overlay = document.createElement('div');
  overlay.className = 'pointer-events-none absolute';
  layer.append(chunkBox, overlay);
  const chunks = new Map();
  const dirty = new Set();
  // Zone de blocs à garder dessinés (vue + MARGIN cases de chaque côté), en numéros de bloc.
  let zone = null;

  function chunkHtml(x0, y0) {
    const out = [];
    const badges = [];
    const at = (x, y) => `left:${(x - x0) * tw}px;top:${(y - y0) * th}px`;
    for (let y = y0; y < y0 + CHUNK; y++) {
      for (let x = x0; x < x0 + CHUNK; x++) {
        if (x >= WORLD || y >= WORLD) {
          out.push(`<div class="absolute w-(--tile-w) h-(--tile-h) bg-map-edge" style="${at(x, y)}"></div>`);
          continue;
        }
        const c = cells.get(ck(x, y));
        // Calques d'influence : cases voisines d'un village à soi ou de sa tribu, ou d'un ennemi.
        if (near(x, y, ['current', 'own', 'tribe'])) out.push(`<div class="pointer-events-none absolute hidden w-(--tile-w) h-(--tile-h) bg-blood-700/25 group-data-[layer-influence]/map:block" style="${at(x, y)}"></div>`);
        else if (near(x, y, ['enemy'])) out.push(`<div class="pointer-events-none absolute hidden w-(--tile-w) h-(--tile-h) bg-rel-enemy/20 group-data-[layer-enemy]/map:block" style="${at(x, y)}"></div>`);
        // Sol des forêts assombri (fondu vers les lisières), villages compris : pas de clairières carrées.
        const woods = forestAt(x, y);
        if (woods) out.push(`<div class="pointer-events-none absolute w-(--tile-w) h-(--tile-h)" style="${at(x, y)};background:rgb(22 40 12 / ${(0.1 + 0.3 * woods).toFixed(2)})"></div>`);
        if (c) {
          out.push(`<div class="map-tile map-tile--village absolute flex w-(--tile-w) h-(--tile-h) cursor-pointer items-center justify-center" style="${at(x, y)}" data-map-tile data-x="${x}" data-y="${y}"${sel && sel[0] === x && sel[1] === y ? ' data-selected' : ''} aria-label="${esc(`${c.name} ${x}|${y} · ${c.points} pts · ${c.owner}`)}">${villageHtml(c)}</div>`);
          badges.push(orderBadgesHtml(c, at(x, y)));
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
            const flip = rnd(x, y, 41 + i * 11) > 0.5 ? ' map-decor--flip' : '';
            // Le décor principal reste centré ; les suivants (et tous les arbres seuls d'une case à plusieurs) sont décalés.
            const shifted = i || (kind === 'pine' && decorations.length > 1);
            const dx = shifted ? Math.round((rnd(x, y, 113 + i) - 0.5) * tw * 0.72) : 0;
            const dy = shifted ? Math.round((rnd(x, y, 127 + i) - 0.5) * th * 0.58) : 0;
            out.push(`<div class="map-decor map-decor--${kind}${flip} pointer-events-none absolute" style="${at(x, y)};--decor-scale:${scale};--decor-x:${dx}px;--decor-y:${dy}px" aria-hidden="true"><span></span></div>`);
          });
          if (sel && sel[0] === x && sel[1] === y) out.push(`<div class="map-tile pointer-events-none absolute w-(--tile-w) h-(--tile-h) bg-none" style="${at(x, y)}" data-selected></div>`);
        }
      }
    }
    return out.join('') + badges.join('');
  }

  // Bloc (a, b) : cases a·CHUNK… et b·CHUNK…, texture d'herbe calée sur le monde. Hors du monde : simple bord.
  function buildChunk(a, b) {
    const k = key(a, b);
    let el = chunks.get(k);
    const x0 = a * CHUNK; const y0 = b * CHUNK;
    const outside = x0 + CHUNK <= 0 || y0 + CHUNK <= 0 || x0 >= WORLD || y0 >= WORLD;
    if (!el) {
      el = document.createElement('div');
      el.className = outside ? 'absolute bg-map-edge' : 'absolute';
      if (!outside) el.setAttribute('data-map-chunk', '');
      el.style.cssText = `left:${x0 * tw}px;top:${y0 * th}px;width:${CHUNK * tw}px;height:${CHUNK * th}px;--terrain-px:${texOffset(x0, tw)}px;--terrain-py:${texOffset(y0, th)}px`;
      // Ordre du document : ligne par ligne, comme les cases, pour que les décors qui débordent sur le bloc
      // suivant passent dessus comme avant.
      const order = b * 100000 + a;
      el.dataset.order = order;
      const next = [...chunkBox.children].find((n) => Number(n.dataset.order) > order);
      chunkBox.insertBefore(el, next || null);
      chunks.set(k, el);
    }
    dirty.delete(k);
    if (!outside) el.innerHTML = chunkHtml(x0, y0);
  }

  // Tout redessiner (taille des cases changée, carte agrandie…).
  function dropChunks() {
    chunkBox.textContent = '';
    chunks.clear();
    dirty.clear();
    zone = null;
  }

  // Blocs de la zone autour de la vue : ceux qui touchent la partie visible sont dessinés tout de suite, les autres
  // (la marge) au fil des images suivantes (pump), pour ne jamais bloquer un glisser.
  function syncChunks() {
    const left = cx - half; const top = cy - half;
    const z = {
      a0: Math.floor((left - MARGIN) / CHUNK), a1: Math.floor((left + size + MARGIN) / CHUNK),
      b0: Math.floor((top - MARGIN) / CHUNK), b1: Math.floor((top + size + MARGIN) / CHUNK),
    };
    if (zone && z.a0 === zone.a0 && z.a1 === zone.a1 && z.b0 === zone.b0 && z.b1 === zone.b1) return;
    zone = z;
    ensure(z.a0 * CHUNK, z.b0 * CHUNK, (z.a1 + 1) * CHUNK - 1, (z.b1 + 1) * CHUNK - 1);
    for (const [k, el] of chunks) {
      const [a, b] = k.split('|').map(Number);
      if (a < z.a0 || a > z.a1 || b < z.b0 || b > z.b1) { el.remove(); chunks.delete(k); dirty.delete(k); }
    }
    for (let b = Math.floor(top / CHUNK); b <= Math.floor((top + size) / CHUNK); b++) {
      for (let a = Math.floor(left / CHUNK); a <= Math.floor((left + size) / CHUNK); a++) if (!chunks.has(key(a, b))) buildChunk(a, b);
    }
    schedule();
  }

  // Blocs à (re)dessiner, du centre vers les bords : 6 ms au plus par image.
  let pumpFrame = 0;
  function schedule() { if (!pumpFrame) pumpFrame = requestAnimationFrame(pump); }
  function pump() {
    pumpFrame = 0;
    if (!zone) return;
    const mx = (cx + 0.5) / CHUNK; const my = (cy + 0.5) / CHUNK;
    const todo = [];
    for (let b = zone.b0; b <= zone.b1; b++) {
      for (let a = zone.a0; a <= zone.a1; a++) {
        const k = key(a, b);
        if (!chunks.has(k) || dirty.has(k)) todo.push([a, b, (a + 0.5 - mx) ** 2 + (b + 0.5 - my) ** 2]);
      }
    }
    if (!todo.length) return;
    todo.sort((p, q) => p[2] - q[2]);
    const start = performance.now();
    let rebuilt = false;
    for (const [a, b] of todo) {
      if (performance.now() - start > 6) { schedule(); break; }
      rebuilt = rebuilt || chunks.has(key(a, b));
      buildChunk(a, b);
    }
    if (rebuilt) refreshTip();
  }

  // Secteur reçu : ses blocs, et ceux qui touchent ses bords (cases voisines), sont à redessiner.
  function sectorLoaded(sec) {
    addSector(sec);
    const x0 = sec.sx * SECTOR; const y0 = sec.sy * SECTOR;
    for (let b = Math.floor((y0 - 1) / CHUNK); b <= Math.floor((y0 + SECTOR) / CHUNK); b++) {
      for (let a = Math.floor((x0 - 1) / CHUNK); a <= Math.floor((x0 + SECTOR) / CHUNK); a++) {
        if (chunks.has(key(a, b))) dirty.add(key(a, b));
      }
    }
    schedule();
  }

  // Calque du dessus (quadrillage, frontières, zones de foi, flèches) et règles : posés sur une fenêtre autour de
  // la vue, refaits quand la vue sort de sa marge (quelques éléments seulement).
  function frameOverlay() {
    const x0 = Math.floor(cx) - half - MARGIN;
    const y0 = Math.floor(cy) - half - MARGIN;
    span = size + 2 * MARGIN;
    baseX = x0;
    baseY = y0;
    const out = [];
    // Frontières de continent (tous les 100 cases) et quadrillage de 5 cases (fond du calque).
    for (let x = Math.ceil(x0 / 100) * 100; x < x0 + span; x += 100) out.push(`<div class="pointer-events-none absolute top-0 z-[5] hidden h-full border-l-[3px] border-dashed border-gold-400/80 group-data-[layer-borders]/map:block" style="left:${(x - x0) * tw}px"></div>`);
    for (let y = Math.ceil(y0 / 100) * 100; y < y0 + span; y += 100) out.push(`<div class="pointer-events-none absolute left-0 z-[5] hidden w-full border-t-[3px] border-dashed border-gold-400/80 group-data-[layer-borders]/map:block" style="top:${(y - y0) * th}px"></div>`);
    out.push(`<div class="map-grid-lines pointer-events-none absolute inset-0 z-[4] hidden group-data-[layer-grid]/map:block" style="--grid-x:${(5 - (((x0 % 5) + 5) % 5)) % 5};--grid-y:${(5 - (((y0 % 5) + 5) % 5)) % 5}"></div>`);
    out.push(churchZones(x0, y0));
    out.push(arrows(x0, y0));
    overlay.innerHTML = out.join('');
    overlay.style.cssText = `left:${x0 * tw}px;top:${y0 * th}px;width:${span * tw}px;height:${span * th}px`;
    rulers();
  }

  function render() {
    const [w, h] = [tw, th];
    fit();
    if (tw !== w || th !== h) dropChunks();
    zone = null;
    frameOverlay();
    place();
  }

  // Zones d'influence de ses églises (mondes avec église, calque « Zones de foi ») : hors de ces cercles, ses villages se
  // battent à 50 %.
  function churchZones(x0, y0) {
    if (!boot.churches || !boot.churches.length) return '';
    const circles = boot.churches.map(([x, y, r]) => `<ellipse cx="${((x - x0 + 0.5) * tw).toFixed(1)}" cy="${((y - y0 + 0.5) * th).toFixed(1)}" rx="${(r * tw).toFixed(1)}" ry="${(r * th).toFixed(1)}"/>`).join('');
    // Couleur de carte (--color-map-label, la même dans tous les styles) sur un liseré sombre : lisible sur l'herbe.
    return `<svg class="pointer-events-none absolute inset-0 z-[4] hidden overflow-visible group-data-[layer-church]/map:block" width="100%" height="100%" aria-hidden="true"><g class="fill-map-label/15 stroke-black/45" stroke-width="5">${circles}</g><g class="fill-none stroke-map-label" stroke-width="2.5" stroke-dasharray="10 5">${circles}</g></svg>`;
  }

  // Flèches des attaques en cours depuis ce village (calque « Mouvements de troupes »).
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
    return `<svg class="pointer-events-none absolute inset-0 z-[7] hidden overflow-visible group-data-[layer-moves]/map:block" width="100%" height="100%" aria-hidden="true"><path d="${line}" class="stroke-blood-450" stroke-width="2" stroke-dasharray="6 5" fill="none"/><path d="${heads}" class="fill-blood-450"/></svg>`;
  }

  function rulers() {
    // Couleurs de carte (--color-map-label*), les mêmes dans tous les styles : la règle est posée sur la carte.
    const lab = (v, me) => `text-[11px] font-semibold tabular-nums [text-shadow:1px_1px_0_#000] ${v === me ? 'text-map-label-me' : 'text-map-label'}`;
    let hx = '';
    let hy = '';
    // Dézoomé, les cases deviennent trop petites pour leur numéro : un numéro toutes les 2, 5 ou 10 cases.
    const every = (px, need) => [1, 2, 5, 10, 20].find((n) => n * px >= need) || 50;
    const stepX = every(sw, 26); const stepY = every(sh, 15);
    for (let i = 0; i < span; i++) {
      if ((baseX + i) % stepX === 0) hx += `<span class="absolute top-0 flex h-full items-center justify-center ${lab(baseX + i, meX)}" style="left:${i * sw}px;width:${sw}px">${baseX + i}</span>`;
      if ((baseY + i) % stepY === 0) hy += `<span class="absolute right-0 flex w-full items-center justify-center ${lab(baseY + i, meY)}" style="top:${i * sh}px;height:${sh}px">${baseY + i}</span>`;
    }
    // Calques à part (will-change) : leur décalage à chaque image d'un glisser ne fait rien repeindre.
    rulerX.innerHTML = `<div class="absolute inset-y-0 left-0 will-change-transform" data-inner>${hx}</div>`;
    rulerY.innerHTML = `<div class="absolute inset-x-0 -top-5 will-change-transform" data-inner>${hy}</div>`;
  }

  // Décale le calque (en coordonnées du monde) pour montrer la zone centrée sur (cx, cy), complète les blocs, et
  // recale le calque du dessus et les règles si l'on sort de leur marge.
  function place() {
    const left = cx - half;
    const top = cy - half;
    if (left < baseX + 1 || top < baseY + 1 || left + size > baseX + span - 1 || top + size > baseY + span - 1) frameOverlay();
    layer.style.transform = `translate3d(${ox - left * sw}px, ${oy - top * sh}px, 0) scale(${zoom})`;
    rulerX.firstChild.style.transform = `translateX(${ox - (left - baseX) * sw}px)`;
    rulerY.firstChild.style.transform = `translateY(${oy - (top - baseY) * sh}px)`;
    syncChunks();
    drawMini();
  }

  // Les cases gardent la taille de Guerre Tribale (plus petites sur mobile) : c'est le nombre de cases qui suit la
  // place disponible.
  const isMobile = () => window.matchMedia('(max-width: 639px)').matches;
  const odd = (n) => (n % 2 ? n : n + 1);
  function fit() {
    const nominal = Number(frame.dataset.tileW);
    baseTw = isMobile() ? Math.round(nominal * 0.72) : nominal;
    baseTh = Math.round(baseTw * Number(frame.dataset.tileH) / nominal);
    const lay = layout();
    viewW = Math.max(1, lay.colW - chrome());
    viewH = Math.round(viewW * baseTh / baseTw);
    baseSize = Math.max(1, Math.round(viewW / baseTw));
    frame.dataset.size = String(baseSize);
    if (baseTw !== tw || !frame.style.getPropertyValue('--tile-w')) {
      tw = baseTw;
      th = baseTh;
      frame.style.setProperty('--tile-w', `${tw}px`);
      frame.style.setProperty('--tile-h', `${th}px`);
      frame.style.setProperty('--tile', `${th}px`);
    }
    scaleView();
    const vw = `${viewW}px`; const vh = `${viewH}px`;
    if (viewport.style.width !== vw) viewport.style.width = vw;
    if (viewport.style.height !== vh) viewport.style.height = vh;
    const label = document.querySelector('[data-map-size-label]');
    if (label) label.textContent = `${baseSize} × ${baseSize}`;
    layoutAside(lay);
  }
  // Cases à l'écran avec le zoom, et cases à dessiner pour couvrir la fenêtre (la marge gardée autour de la vue ne
  // grandit pas en dézoomant : elle suit la taille de la carte sans zoom).
  function scaleView() {
    sw = tw * zoom;
    sh = th * zoom;
    size = odd(Math.max(Math.ceil(viewW / sw), Math.ceil(viewH / sh)));
    half = Math.floor(size / 2);
    MARGIN = Math.max(4, Math.ceil(baseSize / 3));
    ox = (viewW - size * sw) / 2;
    oy = (viewH - size * sh) / 2;
  }
  // Mise en page à la taille du contenu, calculée ici (une ligne flexible à retour ne sait pas se mesurer), toujours
  // dans la largeur de la page : la carte, puis la colonne de droite (mini-carte, 250 px au moins) à côté d'elle, ou
  // dessous. Sur mobile, ou quand la carte n'aurait plus 5 cases, la colonne passe dessous.
  const main = frame.closest('main');
  const aside = document.querySelector('[data-map-aside]');
  const pageBlock = frame.closest('[data-map-page]');
  const col = frame.closest('[data-map-col]');
  const row = frame.closest('[data-map-row]');
  const panel = frame.closest('section');
  const miniSlot = document.querySelector('[data-mini-slot]');
  const miniOver = frame.querySelector('[data-mini-over]');
  // Cadre, marges et bordures du panneau de la mini-carte, autour du canevas.
  const MINI_CHROME = 28;
  // Marges réelles (elles changent avec le style de jeu) : px(el, 'paddingLeft')…
  const px = (el, prop) => (el ? parseFloat(getComputedStyle(el)[prop]) || 0 : 0);
  const setWidth = (el, w) => { if (el.style.width !== w) el.style.width = w; };
  const setStyle = (el, prop, v) => { if (el.style[prop] !== v) el.style[prop] = v; };
  // Largeur de la page sans ses marges ; cadre de la carte (1 px), marges et bordures de son panneau.
  const pageWidth = () => Math.floor(main ? main.clientWidth - px(main, 'paddingLeft') - px(main, 'paddingRight') : document.documentElement.clientWidth);
  const chrome = () => 2 + 2 * (px(panel, 'paddingLeft') + px(panel, 'borderLeftWidth'));
  // Position effective de la mini-carte : à côté de la carte (à droite, à gauche), elle passe dessous sur mobile ou
  // si la carte n'aurait plus 5 cases.
  function placement() {
    if (!beside(miniPos)) return miniPos;
    if (isMobile()) return 'below';
    return pageWidth() - px(row, 'columnGap') - 250 - chrome() >= 5 * baseTw ? miniPos : 'below';
  }
  // Largeurs (px) de la colonne de la carte (panneau compris), de la colonne de droite et du panneau de la mini-carte.
  function layout() {
    const W = pageWidth();
    const gap = px(row, 'columnGap');
    const least = Math.min(W, chrome() + 5 * baseTw);
    const where = placement();
    if (beside(where)) {
      const unit = (W - gap) / 6;
      let asideW = Math.round(Math.max(250, unit * miniStep));
      const colW = Math.floor(Math.max(least, Math.min(unit * step, W - gap - asideW)));
      // Toute la largeur : la colonne de droite prend le reste, au pixel près.
      if (step + miniStep >= 6) asideW = W - gap - colW;
      return { where, W, colW, asideW, miniW: asideW };
    }
    const unit = W / 6;
    return { where, W, colW: Math.floor(Math.max(least, unit * step)), asideW: 0, miniW: Math.round(Math.min(W, Math.max(250, unit * miniStep))) };
  }
  function layoutAside(lay) {
    if (!aside || !pageBlock || !main) return;
    const side = beside(lay.where);
    // À gauche : la colonne passe avant la carte.
    setStyle(aside, 'order', lay.where === 'left' ? '-1' : '');
    const gap = px(row, 'columnGap');
    setWidth(pageBlock, `${side ? lay.colW + gap + lay.asideW : Math.min(lay.W, Math.max(lay.colW, lay.where === 'below' ? lay.miniW : 0))}px`);
    setWidth(col, `${lay.colW}px`);
    setWidth(aside, side ? `${lay.asideW}px` : '100%');
    // Dessous : les panneaux se rangent côte à côte, celui de la mini-carte à sa largeur.
    setStyle(aside, 'flexDirection', side ? '' : 'row');
    setStyle(aside, 'flexWrap', side ? '' : 'wrap');
    setStyle(aside, 'alignItems', side ? '' : 'flex-start');
    const below = lay.where === 'below';
    for (const el of aside.children) setStyle(el, 'flex', side ? '' : below && el.contains(mini) ? `0 1 ${lay.miniW}px` : '1 1 260px');
    placeMini(lay);
  }
  // Mini-carte dans son panneau (carrée), ou par-dessus la carte, dans son coin bas-droit : là, `miniStep` sixièmes
  // de la carte en largeur comme en hauteur (6/6 : toute la carte), à ses proportions. Le canevas est déplacé tel
  // quel : ses gestes (glisser, clic) restent les mêmes. Ses cases gardent 5 px : leur nombre suit sa taille.
  // Coin : 4 px de marge (right-1, bottom-1) ; canevas : 2 px de bordure.
  const OVER_INSET = 4;
  const MINI_BORDER = 4;
  function placeMini(lay) {
    if (!mini || !miniSlot || !miniOver) return;
    const over = lay.where === 'over';
    const host = over ? miniOver : miniSlot;
    if (mini.parentElement !== host) host.appendChild(mini);
    miniSlot.classList.toggle('hidden', over);
    miniOver.classList.toggle('hidden', !over);
    const part = (len) => Math.max(40, Math.round(((len - 2 * OVER_INSET) * miniStep) / 6) - MINI_BORDER);
    const w = over ? part(viewW) : Math.max(60, Math.round(lay.miniW - MINI_CHROME));
    const h = over ? part(viewH) : w;
    setWidth(mini, `${w}px`);
    setStyle(mini, 'height', over ? `${h}px` : '');
    setStyle(mini, 'aspectRatio', over ? 'auto' : '1');
    const cell = Number(mini.dataset.cell);
    const cols = Math.max(8, Math.round(w / cell));
    const rows = Math.max(8, Math.round(h / cell));
    if (cols !== miniSize || rows !== miniRows) {
      miniSize = cols;
      miniRows = rows;
      mini.dataset.size = String(cols);
      const label = document.querySelector('[data-mini-label]');
      if (label) label.textContent = `${cols} × ${rows}`;
      recenterMini(Math.round(cx), Math.round(cy), true);
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
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, tile: e.target.closest('[data-map-tile]') };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    if (!drag.moved) { drag.moved = true; viewport.classList.add('is-dragging'); hideTip(); closeMenu(); }
    // Pas à pas depuis la dernière position : la taille des cases à l'écran change si l'on zoome en glissant.
    cx = clampC(cx - (e.clientX - drag.lx) / sw);
    cy = clampC(cy - (e.clientY - drag.ly) / sh);
    drag.lx = e.clientX; drag.ly = e.clientY;
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

  // Zoom : molette en tenant la carte cliquée (sans clic, la molette fait défiler la page), de ×1/3 à ×3 (autant
  // de dézoom que de zoom), autour de la souris. La carte n'est jamais redessinée pour zoomer : l'image entière
  // (terrain, décors, villages, notes, pastilles) est agrandie ou réduite d'un bloc ; en dézoomant, les blocs qui
  // entrent dans la vue s'ajoutent comme en glissant. À l'arrêt, l'image est rafraîchie nette à sa taille (recrisp).
  const MIN_ZOOM = 1 / 3;
  const MAX_ZOOM = 3;
  const zoomLabel = frame.querySelector('[data-map-zoom]');
  function showZoom(z = zoom) {
    if (!zoomLabel) return;
    zoomLabel.hidden = Math.abs(z - 1) < 0.01;
    zoomLabel.textContent = `×${(Math.round(z * 10) / 10).toLocaleString('fr-FR')}`;
  }
  layer.style.transformOrigin = '0 0';
  // Zoom posé à `z`, le point du monde sous (px, py) (px dans la fenêtre) restant sous la souris : la case `cx` est
  // au centre de la fenêtre, à (viewW / 2 + (X - cx - ½) · sw).
  function setZoom(z, px, py) {
    const [sw0, sh0] = [sw, sh];
    zoom = z;
    scaleView();
    cx = clampC(cx + (px - viewW / 2) * (1 / sw0 - 1 / sw));
    cy = clampC(cy + (py - viewH / 2) * (1 / sh0 - 1 / sh));
    rulers();
    place();
    showZoom();
  }
  // Après un zoom, l'image du calque (gardée telle quelle pendant le geste, will-change) est refaite à la bonne
  // échelle : sinon elle resterait floue en zoomant.
  function recrisp() {
    layer.style.willChange = 'auto';
    requestAnimationFrame(() => requestAnimationFrame(() => { layer.style.willChange = ''; }));
  }
  // Geste en cours : zoom visé et point fixe (souris, px dans la fenêtre). Animation en échelle logarithmique.
  let zg = null;
  let zoomFrame = 0;
  function zoomStep() {
    zoomFrame = 0;
    if (!zg) return;
    const ratio = zg.target / zoom;
    const next = Math.abs(Math.log(ratio)) < 0.003 ? zg.target : zoom * ratio ** 0.35;
    setZoom(next, zg.px, zg.py);
    if (zoom !== zg.target) { zoomFrame = requestAnimationFrame(zoomStep); return; }
    zg = null;
    recrisp();
    settle();
  }
  viewport.addEventListener('wheel', (e) => {
    if (!drag) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    if (!zg) {
      zg = { target: zoom, px: 0, py: 0 };
      // La molette fait partie du geste : relâcher ne sera pas pris pour un clic sur une case.
      drag.moved = true;
      hideTip(); closeMenu();
    }
    zg.px = e.clientX - r.left; zg.py = e.clientY - r.top;
    // Un cran de molette ≈ ×1,2 ; un pavé tactile envoie de petits pas, d'autant plus fins.
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zg.target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zg.target * Math.exp(-delta * 0.0018)));
    if (!zoomFrame) zoomFrame = requestAnimationFrame(zoomStep);
  }, { passive: false });

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
      applySelection();
    });
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 100); });

  // ------------------------------------------------------------------ Infobulle et menu d'actions
  const cellOf = (el) => cells.get(ck(Number(el.dataset.x), Number(el.dataset.y)));
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
  let tipAt = null;
  function showTip(el) {
    const d = cellOf(el);
    if (!d || !tip) return;
    tipAt = [d.x, d.y];
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
    const travel = tip.querySelector('[data-tip-travel]');
    if (travel) {
      travel.classList.toggle('hidden', !dist);
      travel.querySelectorAll('[data-tip-pace]').forEach((n) => { n.textContent = fmt(Math.round(dist * Number(n.dataset.tipPace) * 60)); });
    }
    set('morale', d.morale || '');
    const mor = tip.querySelector('[data-tip="morale"]');
    if (mor) mor.classList.toggle('text-blood-450', Boolean(d.morale) && d.morale !== '100 %');
    show('morale', Boolean(d.morale));
    const lastCell = tip.querySelector('[data-tip="last"]');
    const hasLast = Boolean(d.last && LAST[d.last.result]);
    if (lastCell) {
      lastCell.innerHTML = hasLast
        ? `<span class="inline-flex items-center gap-1.5">${lastDot(d.last)}<span class="font-semibold">${esc(LAST[d.last.result].label)}</span><span class="text-parchment-400 tabular-nums">${esc(d.last.at)}</span>${d.last.haul ? `<span class="text-parchment-400">· ${HAUL[d.last.haul]}</span>` : ''}</span>`
        : '';
    }
    show('last', hasLast);
    const notesCell = tip.querySelector('[data-tip="notes"]');
    if (notesCell) {
      notesCell.innerHTML = (d.notes || []).map((n) => `<span class="block whitespace-pre-line wrap-break-word text-parchment-200">${n.author ? `<b class="font-semibold text-gold-200">${esc(n.author)} :</b> ` : ''}${esc(n.text)}</span>`).join('');
    }
    show('notes', Boolean(d.notes && d.notes.length));
    const orderLabels = { attack: 'Attaque', support: 'Soutien', relocate: 'Déplacement', return: 'Retour' };
    for (const group of ['own', 'tribe']) {
      const orders = liveOrders(d)[group];
      set(`orders-${group}-count`, orders.length);
      show(`orders-${group}`, orders.length > 0);
      const container = tip.querySelector(`[data-tip="orders-${group}"]`);
      if (container) container.innerHTML = orders.map((order) => {
        const arrival = new Date(order.arrivesAt);
        const remaining = Math.max(0, Math.ceil((arrival.getTime() - Date.now()) / 1000));
        const origin = `${order.origin} (${order.x}|${order.y})`;
        return `<div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-bronze-900 px-2 py-1 text-[11px]">`
          + `<span class="flex min-w-0 items-center gap-1.5">${order.badge}<span class="min-w-0 truncate" title="${esc(origin)}">${esc(orderLabels[order.type] || order.type)} · ${esc(origin)}${group === 'tribe' ? ` · ${esc(order.player)}` : ''}</span></span>`
          + `<span class="text-parchment-400 tabular-nums">${arrivalAt(arrival)}</span>`
          + `<span class="font-semibold text-gold-200 tabular-nums" data-order-arrival="${arrival.getTime()}">${fmt(remaining)}</span></div>`;
      }).join('');
    }
    tip.classList.remove('hidden');
    placeBeside(tip, el);
  }
  viewport.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-map-tile]');
    if (!el || drag || menuOpen()) { if (!el) hideTip(); return; }
    showTip(el);
  });
  viewport.addEventListener('pointerleave', hideTip);
  setInterval(() => {
    if (!tip || tip.classList.contains('hidden')) return;
    tip.querySelectorAll('[data-order-arrival]').forEach((el) => {
      el.textContent = fmt(Math.max(0, Math.ceil((Number(el.dataset.orderArrival) - Date.now()) / 1000)));
    });
  }, 1000);

  // Ordres arrivés : à 0, la case et l'infobulle ouverte se mettent à jour (ordres en route seulement), et les
  // secteurs affichés sont rechargés aussitôt : le serveur résout les arrivées échues à chaque requête d'un village
  // (middleware loadVillage), d'où le retour des troupes, la gommette et l'infobulle de la dernière attaque. Second
  // rechargement 6 s plus tard, au cas où l'horloge du navigateur serait en avance sur celle du serveur.
  const RELOAD_AFTER_MS = 6000;
  function reloadVisible() {
    if (!zone) return;
    const [x0, y0, x1, y1] = [zone.a0 * CHUNK, zone.b0 * CHUNK, (zone.a1 + 1) * CHUNK - 1, (zone.b1 + 1) * CHUNK - 1];
    for (let sy = Math.floor(y0 / SECTOR); sy <= Math.floor(y1 / SECTOR); sy++) {
      for (let sx = Math.floor(x0 / SECTOR); sx <= Math.floor(x1 / SECTOR); sx++) loaded.delete(key(sx, sy));
    }
    // Pastilles des ordres arrivés retirées tout de suite ; les secteurs rechargés redessinent ensuite leurs blocs.
    for (const k of chunks.keys()) dirty.add(k);
    schedule();
    ensure(x0, y0, x1, y1);
  }
  function refreshTip() {
    if (!tip || tip.classList.contains('hidden') || !tipAt) return;
    const el = layer.querySelector(`[data-map-tile][data-x="${tipAt[0]}"][data-y="${tipAt[1]}"]`);
    if (el) showTip(el);
  }
  setInterval(() => {
    if (Date.now() < nextArrival) return;
    nextArrival = Infinity;
    for (const c of cells.values()) noteArrivals(c);
    reloadVisible();
    refreshTip();
    setTimeout(() => { reloadVisible(); }, RELOAD_AFTER_MS);
  }, 1000);

  // Case sélectionnée par « Aller à » : marquée sur le bloc déjà dessiné (les blocs dessinés ensuite la marquent eux-mêmes).
  function applySelection() {
    layer.querySelectorAll('[data-selected]').forEach((n) => { if (n.hasAttribute('data-map-tile')) n.removeAttribute('data-selected'); else n.remove(); });
    if (!sel) return;
    const [x, y] = sel;
    const tile = layer.querySelector(`[data-map-tile][data-x="${x}"][data-y="${y}"]`);
    if (tile) { tile.setAttribute('data-selected', ''); return; }
    const a = Math.floor(x / CHUNK); const b = Math.floor(y / CHUNK);
    const el = chunks.get(key(a, b));
    if (el && el.hasAttribute('data-map-chunk')) el.insertAdjacentHTML('beforeend', `<div class="map-tile pointer-events-none absolute w-(--tile-w) h-(--tile-h) bg-none" style="left:${(x - a * CHUNK) * tw}px;top:${(y - b * CHUNK) * th}px" data-selected></div>`);
  }

  function selectTile(el) {
    sel = [Number(el.dataset.x), Number(el.dataset.y)];
    layer.querySelectorAll('[data-selected]').forEach((n) => { if (n.hasAttribute('data-map-tile')) n.removeAttribute('data-selected'); else n.remove(); });
    el.setAttribute('data-selected', '');
  }

  const MENU_ICONS = {
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    attack: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
    support: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 9v6M9 12h6"/>',
    market: '<path d="M12 4v16M7 20h10M5 8h14"/><path d="M5 8l-3 6h6zM19 8l-3 6h6z"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
    center: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    open: '<path d="M3 9l9-5 9 5z"/><path d="M5 20h14M6 17h12M7 17V10M11 17V10M13 17V10M17 17V10"/>',
    star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    mark: '<path d="M6 21V3"/><path d="M6 4h11l-3 4 3 4H6"/>',
    message: '<rect x="3" y="5" width="18" height="14"/><path d="M3 6l9 7 9-7"/>',
    // Deux épées croisées (envoyer des troupes).
    troops: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
    recruit: '<path d="M5 20V8l7-4 7 4v12zM9 20v-7h6v7M8 9h8"/>',
    // Longue-vue (espionnage).
    spy: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21"/>',
  };
  const MENU_COLORS = { attack: 'text-blood-500', troops: 'text-blood-500', support: 'text-steel-300', star: 'text-gold-200', mark: 'text-gold-400' };
  const radial = frame.querySelector('[data-map-radial]');
  const closeMenu = () => { if (menu) menu.classList.add('hidden'); if (radial) radial.classList.add('hidden'); };
  const menuOpen = () => (menu && !menu.classList.contains('hidden')) || (radial && !radial.classList.contains('hidden'));

  // Actions rapides d'un village, comme sur Guerre Tribale : une roue d'icônes autour de la case (voir ORDER).
  function openRadial(el, d, { tplOption, target, mine }) {
    const actions = mine ? [
      ['troops', d.kind === 'current' ? 'Point de ralliement' : 'Envoyer des troupes vers ce village', d.kind === 'current' ? `${base}/place` : `${base}/place?${target}`],
      ['recruit', 'Recruter', `/village/${d.id}/recruit/barracks`],
      ['center', 'Centrer ici', null, 'center'],
      ['star', d.fav ? 'Retirer des favoris' : 'Ajouter aux favoris', `${base}/favorites/${d.id}`, 'post'],
      ['market', 'Marché', `/village/${d.id}/market`],
    ] : [
      ['troops', tplOption && tplOption.value ? `Envoyer des troupes · ${tplOption.textContent}` : 'Envoyer des troupes', `${base}/place?${target}`],
      ...(d.playerId ? [['profile', `Profil de ${d.owner}`, `${base}/players/${d.playerId}`]] : []),
      ...(d.playerId && !d.bot ? [['message', `Écrire à ${d.owner}`, `${base}/messages/new?${new URLSearchParams({ to: d.owner })}`]] : []),
      ['star', d.fav ? 'Retirer des favoris' : 'Ajouter aux favoris', `${base}/favorites/${d.id}`, 'post'],
      ['market', 'Envoyer des ressources', `${base}/market?tab=send&x=${d.x}&y=${d.y}`],
    ];
    // Cercle un peu aplati, à la forme de la case sans zoom (baseTw × baseTh, 53 × 38) : sans zoom, les icônes ne
    // couvrent pas le village. Ce rayon ne suit pas le zoom : la roue garde sa taille et son espacement, comme sur GT
    // (zoomé, elle se pose sur le village au lieu de s'éparpiller sur la carte).
    const rx = baseTw * 0.95 + 8; const ry = baseTh * 0.95 + 12;
    const btn = 'pointer-events-auto absolute flex size-[30px] -translate-1/2 cursor-pointer items-center justify-center border-2 border-black bg-panel-top no-underline shadow-[inset_0_0_0_1px_var(--color-bronze-500),2px_2px_0_#000] transition hover:scale-110 hover:bg-head-dark hover:text-parchment-100';
    const svg = (ic) => `<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MENU_ICONS[ic]}</svg>`;
    const ORDER = { market: 0, profile: 1, recruit: 1, message: 2, center: 2, star: 3, troops: 4 };
    // Roue comme sur GT : toutes les actions à intervalles égaux autour de la case, en commençant en haut, dans le
    // sens des aiguilles d'une montre : ressources, modèles d'armée favoris (3 au plus, leur première lettre envoie
    // l'attaque tout de suite), puis profil, message, favoris et troupes. Au centre, l'aperçu (ou l'ouverture) du village.
    const farm = mine ? [] : (boot.farm || []).slice(0, 3);
    const ring = actions.sort((p, q) => ORDER[p[0]] - ORDER[q[0]]);
    ring.splice(1, 0, ...farm.map((t) => ['farm', `Attaquer avec « ${t.name} »`, null, 'farm', t]));
    const middle = mine ? ['open', 'Ouvrir le village', `/village/${d.id}`, 'middle'] : ['eye', 'Aperçu du village', `${base}/villages/${d.id}`, 'middle'];
    let bottom = 0;
    radial.querySelector('[data-radial-items]').innerHTML = [...ring, middle].map(([ic, label, href, kind, tpl], i) => {
      const a = (-90 + (i * 360) / ring.length) * (Math.PI / 180);
      const top = Math.round(Math.sin(a) * ry);
      if (kind !== 'middle') bottom = Math.max(bottom, top);
      const at = kind === 'middle' ? 'left:0;top:0' : `left:${Math.round(Math.cos(a) * rx)}px;top:${top}px`;
      const cls = `${btn} ${MENU_COLORS[ic] || 'text-parchment-300'}`;
      const attrs = `style="${at}" title="${esc(label)}" aria-label="${esc(label)}" data-radial-action="${esc(label)}"`;
      if (kind === 'farm') return `<button type="button" class="${btn} font-display text-[15px] text-gold-200" ${attrs} data-farm-send="${tpl.id}">${esc(tpl.letter)}</button>`;
      if (kind === 'post') return `<form method="post" action="${esc(href)}" class="contents"><input type="hidden" name="_csrf" value="${esc(frame.dataset.csrf)}"><button class="${cls}" ${attrs}>${svg(ic)}</button></form>`;
      if (kind === 'center') return `<button type="button" class="${cls}" ${attrs} data-map-center="${d.x}|${d.y}">${svg(ic)}</button>`;
      return `<a href="${esc(href)}" class="${cls}" ${attrs}>${svg(ic)}</a>`;
    }).join('');
    radial.dataset.target = String(d.id);
    radial.dataset.targetXy = `${d.x}|${d.y}`;
    const label = radial.querySelector('[data-radial-label]');
    const caption = `${d.name} (${d.x}|${d.y})${d.morale ? ` · morale ${d.morale}` : ''}`;
    label.textContent = caption;
    // Nom du village sous le bouton le plus bas de la roue.
    label.style.top = `${bottom + 24}px`;
    radial.dataset.caption = caption;
    // Centre du cercle : centre de la case, dans le cadre de la carte.
    const f = frame.getBoundingClientRect(); const r = el.getBoundingClientRect();
    radial.style.left = `${r.left - f.left + r.width / 2}px`;
    radial.style.top = `${r.top - f.top + r.height / 2}px`;
    radial.classList.remove('hidden');
  }
  if (radial) {
    radial.addEventListener('pointerover', (e) => {
      const b = e.target.closest('[data-radial-action]');
      radial.querySelector('[data-radial-label]').textContent = b ? b.dataset.radialAction : radial.dataset.caption;
    });
    radial.addEventListener('click', (e) => {
      const b = e.target.closest('[data-map-center]');
      if (b) moveTo(...b.dataset.mapCenter.split('|').map(Number));
      const f = e.target.closest('[data-farm-send]');
      if (f) sendFavorite(f);
    });
  }
  // Raccourci d'un modèle favori : l'attaque part du village courant (même envoi que l'assistant de pillage).
  async function sendFavorite(button) {
    const label = radial.querySelector('[data-radial-label]');
    const [tx, ty] = radial.dataset.targetXy.split('|').map(Number);
    button.disabled = true;
    try {
      const body = new URLSearchParams({ _csrf: frame.dataset.csrf, template: button.dataset.farmSend, target: radial.dataset.target });
      const res = await fetch(`${base}/farm/send`, { method: 'POST', body, headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Envoi impossible.');
      boot.attacks.push([tx, ty]);
      frameOverlay();
      radial.dataset.caption = 'Attaque envoyée';
      label.textContent = radial.dataset.caption;
      window.adarmaToast?.(`Attaque envoyée sur ${tx}|${ty}.`);
      setTimeout(closeMenu, 700);
    } catch (err) {
      window.adarmaToast?.(err.message, true);
    } finally {
      button.disabled = false;
    }
  }
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
    closeMenu();
    if (radial) { openRadial(el, d, { tplOption, target, mine }); return; }
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
    if (!e.target.closest('[data-map-menu]') && !e.target.closest('[data-map-radial]') && !e.target.closest('[data-map-viewport]')) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // ------------------------------------------------------------------ Ordres rapides (choix mémorisés dans le navigateur)
  // Ancienne clé (le jeu s'appelait GTLike) lue tant que la nouvelle n'existe pas.
  const QUICK_KEY = 'adarma.quickOrders';
  const OLD_QUICK_KEY = 'gtlike.quickOrders';
  function readQuick() {
    try { return JSON.parse(localStorage.getItem(QUICK_KEY) || localStorage.getItem(OLD_QUICK_KEY) || '{}') || {}; } catch (err) { return {}; }
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
  const LAYER_KEYS = ['markers', 'moves', 'church', 'influence', 'enemy', 'nobarb', 'grid', 'borders'];
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
  // Cases de côté de la mini-carte : `miniSize` en largeur, `miniRows` en hauteur (différents par-dessus la carte).
  let miniSize = mini ? Number(mini.dataset.size) : 0;
  let miniRows = miniSize;
  let miniVillages = boot.mini;
  let miniX0 = Math.round(cx) - Math.floor(miniSize / 2);
  let miniY0 = Math.round(cy) - Math.floor(miniRows / 2);
  // Dessin commun à toutes les mini-cartes : public/js/minimap.js.
  let miniFrame = 0;
  function drawMini() {
    if (!mini || miniFrame) return;
    miniFrame = requestAnimationFrame(() => {
      miniFrame = 0;
      window.GTMinimap.draw(mini, {
        x0: miniX0, y0: miniY0, width: miniSize, height: miniRows, villages: miniVillages,
        frame: { x: cx - half, y: cy - half, size }, layers: layersOn(),
      });
    });
  }
  // Points d'un carré de la mini-carte (/map/mini). Ils remplacent ceux de ce carré et s'ajoutent aux autres, pour
  // que la mini-carte reste remplie quand on la fait glisser. `move` : la mini-carte se cale ensuite sur ce carré.
  function loadMini(x0, y0, move) {
    // Le serveur renvoie un carré : celui qui couvre la mini-carte.
    const side = Math.max(miniSize, miniRows);
    fetch(`${base}/map/mini?x0=${x0}&y0=${y0}&size=${side}`, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        if (!list) return;
        const inside = ([x, y]) => x >= x0 && y >= y0 && x < x0 + side && y < y0 + side;
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
    const my = miniY0 + Math.floor(miniRows / 2);
    if (!force && Math.abs(x - mx) < miniSize / 4 && Math.abs(y - my) < miniRows / 4) return;
    loadMini(x - Math.floor(miniSize / 2), y - Math.floor(miniRows / 2), true);
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
      if (!d.moved) moveTo(...window.GTMinimap.cellAt(mini, { x0: miniX0, y0: miniY0, width: miniSize, height: miniRows }, e));
    };
    mini.addEventListener('pointerup', endMiniDrag);
    mini.addEventListener('pointercancel', endMiniDrag);
    window.addEventListener('resize', drawMini);
  }

  // ------------------------------------------------------------------ Tailles en direct (carte et mini-carte)
  // À droite de la carte, les deux tailles se partagent la page : 6/6 à elles deux au plus (5/6 chacune au plus),
  // l'autre réglage est réduit au besoin (et mémorisé avec). Ailleurs, chacune peut aller jusqu'à 6/6.
  const resizeSelect = (key) => document.querySelector(`[data-map-resize="${key}"]`);
  function limitSteps() {
    for (const key of ['step', 'miniStep']) {
      const select = resizeSelect(key);
      if (select) for (const o of select.options) o.disabled = beside(miniPos) && Number(o.value) === 6;
    }
  }
  function share(changed) {
    const fixes = [];
    const set = (key, n) => { if (key === 'step') step = n; else miniStep = n; resizeSelect(key).value = String(n); fixes.push([key, n]); };
    if (beside(miniPos)) {
      if (step > 5) set('step', 5);
      if (miniStep > 5) set('miniStep', 5);
      if (step + miniStep > 6) { if (changed === 'miniStep') set('step', 6 - miniStep); else set('miniStep', 6 - step); }
    }
    limitSteps();
    return fixes;
  }
  limitSteps();
  document.querySelectorAll('[data-map-resize]').forEach((select) => {
    select.addEventListener('change', () => {
      const key = select.dataset.mapResize;
      if (key === 'step') step = Number(select.value);
      else if (key === 'miniStep') miniStep = Number(select.value);
      else miniPos = select.value;
      const body = new URLSearchParams({ _csrf: frame.dataset.csrf, [key]: select.value });
      for (const [k, n] of share(key)) body.set(k, String(n));
      if (key === 'step') { zoom = 1; showZoom(); }
      render();
      settle();
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
