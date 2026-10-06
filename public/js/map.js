'use strict';

// Carte du monde, façon Guerre Tribale : cases de taille fixe, villages chargés par secteurs de 20 × 20 cases
// (/map/sector) et déplacement fluide (glisser, flèches, clavier, mini-carte) sans recharger la page.
// Décor, eau et villages sont dessinés dans un canevas par bloc de cases ; l'herbe est une texture unique.
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
  // Texte mis à jour en continu (zoom, infobulle, titre) : nœud texte modifié, pas remplacé (une insertion fait
  // recalculer les styles de toute la page, voir chunkEl).
  const setText = (el, text) => {
    const node = el.firstChild;
    if (node && node === el.lastChild && node.nodeType === 3) { if (node.data !== text) node.data = text; } else if (el.textContent !== text) el.textContent = text;
  };

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
        .then((list) => {
          if (!list) return;
          warmVillageSpecs(list.flatMap((sec) => sec.cells));
          list.forEach(sectorLoaded);
        })
        .catch(() => {})
        .finally(() => batch.forEach(([sx, sy]) => loading.delete(key(sx, sy))));
    }
  }

  // ------------------------------------------------------------------ Décor déterministe, partagé avec le serveur
  // (src/game/terrain.js, servi en /js/terrain.js) : le serveur n'y place pas de village sur l'eau, les lacs,
  // les montagnes ni au cœur des forêts.
  const { rnd, forestAt, waterAt, terrain } = window.GTTerrain;

  // ------------------------------------------------------------------ Rendu
  // Comme sur Guerre Tribale : chaque bloc de la carte est une image (<canvas>), pas des centaines d'éléments par
  // case ; la case visée se déduit de la position de la souris (cellAt). Restent des éléments : la texture d'herbe
  // (fond CSS du bloc), les pastilles d'ordres (HTML du serveur), la case survolée et la case sélectionnée.
  // Tailles, images et filtres viennent du CSS (src/styles/app.css), lus sur des éléments sonde : un design de
  // village ou un thème qui change une règle n'a rien à changer ici.
  let MARGIN = Math.max(4, Math.ceil(size / 3));
  let baseX = 0;
  let baseY = 0;
  let span = 0;

  // Gommette de la dernière attaque dans l'infobulle (comme sur GT) : composant du serveur (helpers.attackDot),
  // le même que dans l'aperçu du village et les rapports. { win|partial|loss|spy: { html, label } }
  const LAST = boot.attackDots || {};
  const HAUL = { full: 'butin plein', partial: 'butin partiel' };
  const lastDot = (last) => LAST[last.result].html;
  const layerOn = (k) => frame.hasAttribute(`data-layer-${k}`);
  const hiddenBarb = (c) => c.kind === 'barb' && layerOn('nobarb');

  // Résolution des blocs : pixels du canevas par px CSS, selon l'écran et le zoom (dézoomé, moins de pixels ;
  // zoomé, plus, pour rester net). Changée à la fin d'un zoom (recrisp) : les blocs sont alors redessinés.
  const RES_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];
  const resFor = () => RES_STEPS.find((s) => s >= (window.devicePixelRatio || 1) * zoom - 0.01) || 3;
  let res = resFor();

  // Images : chargées une fois ; à leur arrivée, seuls les blocs dessinés sans elles sont refaits (`waiting` : blocs
  // en attente de chaque image ; `drawing` : bloc en cours de dessin).
  const images = new Map();
  const waiting = new Map();
  let drawing = null;
  function image(src) {
    let img = images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => {
        const keys = waiting.get(src);
        waiting.delete(src);
        if (!keys) return;
        for (const k of keys) if (chunks.has(k)) dirty.add(k);
        schedule();
      };
      img.src = src;
      images.set(src, img);
    }
    if (img.complete && img.naturalWidth) return img;
    if (drawing) {
      if (!waiting.has(src)) waiting.set(src, new Set());
      waiting.get(src).add(drawing);
    }
    return null;
  }
  const cssUrl = (v) => { const m = /url\(["']?([^"')]+)["']?\)/.exec(v || ''); return m ? m[1] : null; };
  // Position de fond CSS (« 50% », « 100% », « calc(50% + 1px) ») : décalage dans l'espace libre `free`.
  const bgPos = (v, free) => {
    const p = /(-?[\d.]+)%/.exec(v); const n = /(-?[\d.]+)px/.exec(v);
    return (p ? (free * Number(p[1])) / 100 : 0) + (n ? Number(n[1]) : 0);
  };
  // Image ajustée (contain) dans une boîte, centrée ou à la position de fond donnée.
  function contain(img, x, y, w, h, pos = ['50%', '50%']) {
    const f = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * f; const ih = img.naturalHeight * f;
    return [x + bgPos(pos[0], w - iw), y + bgPos(pos[1], h - ih), iw, ih];
  }

  // Sondes : éléments invisibles portant les classes de la carte, dans le cadre (variables --tile-*, thème actif).
  const probeBox = document.createElement('div');
  // Isolées (contain) : les lire ne recalcule que leurs styles et leur mise en page, pas celles de toute la page.
  probeBox.style.cssText = 'position:absolute;left:-9999px;top:0;width:200px;height:200px;contain:strict;visibility:hidden;pointer-events:none';
  probeBox.setAttribute('aria-hidden', 'true');
  frame.append(probeBox);
  function probe(html) {
    probeBox.innerHTML = html;
    return probeBox.firstElementChild;
  }
  const relBox = (el, root) => { const r = el.getBoundingClientRect(); const o = root.getBoundingClientRect(); return [r.left - o.left, r.top - o.top, r.width, r.height]; };
  // Règles lues une fois par taille de case (vidées par dropChunks).
  const specs = new Map();
  function spec(k, read) {
    if (!specs.has(k)) specs.set(k, read());
    return specs.get(k);
  }
  // Couleurs des calques d'influence, du sous-bois et du bord du monde (classes d'origine, alpha compris).
  const paint = (cls) => spec(`paint:${cls}`, () => getComputedStyle(probe(`<i class="${cls}"></i>`)).backgroundColor);
  const PAINT = { influence: 'bg-blood-700/25', faction: 'bg-[#4fb3e8]/30', enemy: 'bg-rel-enemy/20', edge: 'bg-map-edge' };
  // Village : image, boîte du sprite dans la case (marges, agrandissement), position du fond, filtres (barbares
  // grisés, halo du village courant, thème), couleur de la pastille de relation.
  const markerHtml = (kind, design, level) => `<span class="village-marker village-marker--${kind} village-marker--${level} village-design--${design}" style="position:absolute"><span class="village-sprite"></span></span>`;
  function readVillageSpec(marker) {
    const sprite = marker.firstElementChild;
    const ms = getComputedStyle(marker); const ss = getComputedStyle(sprite);
    return {
      src: cssUrl(ss.backgroundImage), box: relBox(sprite, marker), pos: [ss.backgroundPositionX, ss.backgroundPositionY],
      filter: [ss.filter, ms.filter].filter((f) => f && f !== 'none').join(' '),
      color: ms.getPropertyValue('--village-color').trim(),
    };
  }
  function villageSpec(kind, design, level) {
    return spec(`v:${kind}|${design}|${level}`, () => readVillageSpec(probe(markerHtml(kind, design, level))));
  }
  // Règles des villages d'un lot de cases lues d'un coup : une seule insertion dans la page (chaque insertion fait
  // recalculer les styles de toute la page, voir chunkEl), au lieu d'une par sorte de village rencontrée en dessinant.
  function warmVillageSpecs(list) {
    const want = new Map();
    for (const c of list) {
      const design = c.design || 'beige';
      const k = `v:${c.kind}|${design}|${c.level}`;
      if (!specs.has(k) && !want.has(k)) want.set(k, markerHtml(c.kind, design, c.level));
    }
    if (!want.size) return;
    probeBox.innerHTML = [...want.values()].join('');
    const markers = [...probeBox.children];
    [...want.keys()].forEach((k, i) => specs.set(k, readVillageSpec(markers[i])));
  }
  // Villages intégrés à la page.
  warmVillageSpecs(cells.values());
  // Décor : image et taille à l'échelle 1 (largeur, hauteur, décalage vertical --decor-oy), voir .map-decor > span.
  function decorSpec(kind, flip) {
    return spec(`d:${kind}${flip}`, () => {
      const el = probe(`<div class="map-decor map-decor--${kind}${flip ? ' map-decor--flip' : ''}" style="position:absolute;--decor-scale:1;--decor-x:0px;--decor-y:0px"><span></span></div>`);
      const [, top, w, h] = relBox(el.firstElementChild, el);
      return { src: cssUrl(getComputedStyle(el.firstElementChild).backgroundImage), w, h, oy: top - th / 2 + h / 2 };
    });
  }
  const waterSpec = () => spec('water', () => {
    // Décalage de la texture défini : sans lui, la règle de fond (qui l'utilise) serait ignorée.
    const el = probe('<div class="map-water" style="--water-bg-x:0px;--water-bg-y:0px"><span class="map-shore"></span><span class="map-shore-corner"></span></div>');
    const s = getComputedStyle(el);
    return { color: s.backgroundColor, src: cssUrl(s.backgroundImage), shore: cssUrl(getComputedStyle(el.children[0]).backgroundImage), corner: cssUrl(getComputedStyle(el.children[1]).backgroundImage) };
  });

  // Sprite de village pré-rendu à la résolution courante, filtres CSS appliqués une fois pour toutes (ils coûtent
  // cher à chaque dessin) ; `x`, `y` : position dans la case, en px CSS. Vidé quand la résolution change.
  const sprites = new Map();
  const PAD = 8;
  function villageSprite(kind, design, level) {
    const k = `${kind}|${design}|${level}`;
    if (sprites.has(k)) return sprites.get(k);
    const s = villageSpec(kind, design, level);
    const img = s.src && image(s.src);
    if (!img) return null;
    const [ix, iy, iw, ih] = contain(img, ...s.box, s.pos);
    const x = Math.floor(ix - PAD); const y = Math.floor(iy - PAD);
    const c = document.createElement('canvas');
    c.width = Math.ceil((ix + iw + PAD - x) * res);
    c.height = Math.ceil((iy + ih + PAD - y) * res);
    const g = c.getContext('2d');
    // Les longueurs des filtres (ombres, flous) ne suivent pas l'échelle du canevas : mises à la résolution ici.
    if (s.filter) g.filter = s.filter.replace(/(-?[\d.]+)px/g, (m, n) => `${Number(n) * res}px`);
    g.drawImage(img, (ix - x) * res, (iy - y) * res, iw * res, ih * res);
    const out = { canvas: c, x, y, w: c.width / res, h: c.height / res };
    sprites.set(k, out);
    return out;
  }

  // Décors d'une case (hors eau et villages) : biome, puis petits arbres et cailloux qui lient le paysage.
  // Taille de chaque décor (facteur min, max) : lacs et montagnes très variables, petits décors plus réguliers.
  const DECOR_SCALE = { hill: [0.78, 1.08], pine: [0.8, 1.2], default: [0.84, 1.06] };
  function decorations(x, y, ground, woods) {
    // En forêt : pas de lac ni de colline, mais bosquets et sapins, plus serrés au cœur du massif.
    const t = ground === 'forest' ? (rnd(x, y, 141) < 0.25 + 0.45 * woods ? 'trees' : 'pine') : ground;
    const list = t ? [t] : [];
    const accent = rnd(x, y, 101);
    const besideVillage = near(x, y, ['current', 'own', 'tribe', 'ally', 'nap', 'enemy', 'other', 'barb']);
    const pineChance = besideVillage ? 0.34 : 0.16;
    const rockChance = besideVillage ? 0.08 : 0.045;
    if (accent < pineChance) list.push('pine');
    else if (accent < pineChance + rockChance) list.push('rocks');
    if (woods) {
      // Arbres plus nombreux vers le cœur du massif : 1 à 5 par case.
      const extra = Math.floor(woods * 3.2 + rnd(x, y, 107) * 1.4);
      for (let k = 0; k < extra; k++) list.push(rnd(x, y, 151 + k) < 0.3 ? 'trees' : 'pine');
    }
    // Arbres seuls : parfois deux ou trois dans la même case (décalés, voir dx / dy).
    if (list.includes('pine')) {
      const more = rnd(x, y, 131);
      if (more < 0.38) list.push('pine');
      if (more < 0.14) list.push('pine');
    }
    return list.map((kind, i) => {
      const [min, max] = DECOR_SCALE[kind] || DECOR_SCALE.default;
      // Le décor principal reste centré ; les suivants (et tous les arbres seuls d'une case à plusieurs) sont décalés.
      const shifted = i || (kind === 'pine' && list.length > 1);
      return {
        kind, scale: min + rnd(x, y, 37 + i * 7) * (max - min), flip: rnd(x, y, 41 + i * 11) > 0.5,
        dx: shifted ? Math.round((rnd(x, y, 113 + i) - 0.5) * tw * 0.72) : 0,
        dy: shifted ? Math.round((rnd(x, y, 127 + i) - 0.5) * th * 0.58) : 0,
      };
    });
  }
  // Villages d'autres joueurs de sa faction (mondes à factions), pour le calque « Influence de ta faction ».
  const nearFaction = (x, y) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const c = cells.get(ck(x + dx, y + dy));
        if (c && c.faction) return true;
      }
    }
    return false;
  };
  const near = (x, y, kinds, radius = 1) => {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const c = cells.get(ck(x + dx, y + dy));
        if (c && kinds.includes(c.kind)) return true;
      }
    }
    return false;
  };

  // Case d'eau : eau continue (texture de 6 cases calée sur le monde) et rives contenues dans la case, tournées
  // comme .map-shore--* / .map-shore-corner--* (rive droite repoussée de 19 % vers la terre).
  function drawWater(g, x, y, X, Y, pattern) {
    const w = waterSpec();
    g.save();
    g.beginPath(); g.rect(X, Y, tw, th); g.clip();
    g.fillStyle = w.color; g.fillRect(X, Y, tw, th);
    if (pattern) { g.fillStyle = pattern; g.fillRect(X, Y, tw, th); }
    const n = !waterAt(x, y - 1); const e = !waterAt(x + 1, y); const s2 = !waterAt(x, y + 1); const wst = !waterAt(x - 1, y);
    const mask = Number(n) | (Number(e) << 1) | (Number(s2) << 2) | (Number(wst) << 3);
    const corner = { 9: 0, 3: 90, 6: 180, 12: 270 }[mask];
    const shore = (src, angle, shift) => {
      const im = src && image(src);
      if (!im) return;
      const turned = angle % 180 !== 0;
      const sw2 = turned ? th : tw; const sh2 = turned ? tw : th;
      g.save();
      g.translate(X + tw / 2, Y + th / 2);
      g.rotate((angle * Math.PI) / 180);
      g.drawImage(im, -sw2 / 2, -sh2 / 2 + shift * sh2, sw2, sh2);
      g.restore();
    };
    if (corner !== undefined) shore(w.corner, corner, 0);
    else {
      if (n) shore(w.shore, 0, -0.19);
      if (e) shore(w.shore, 90, -0.19);
      if (s2) shore(w.shore, 180, -0.19);
      if (wst) shore(w.shore, 270, -0.19);
    }
    g.restore();
  }

  // Marques d'un village, au-dessus de son image : pastille (marquage ou relation), village spécial (étoile ou rune),
  // note du carnet (feuille en bas à gauche), favori (étoile en bas à droite). Mêmes tailles que l'ancien HTML.
  const RUNE = typeof Path2D === 'function' ? new Path2D('M8 2v12M8 8 3.5 3.5M8 8l4.5-4.5') : null;
  const NOTE = typeof Path2D === 'function' ? new Path2D('M5 3h10l4 4v14H5zM15 3v4h4M8 12h8M8 16h6') : null;
  const cssVar = (name) => spec(`var:${name}`, () => getComputedStyle(frame).getPropertyValue(name).trim());
  function drawMarks(g, c, X, Y, color) {
    const dot = c.mark ? (layerOn('markers') ? c.mark : null) : ['current', 'own', 'tribe', 'ally', 'enemy'].includes(c.kind) ? color : null;
    if (dot) {
      g.fillStyle = 'rgb(0 0 0 / .7)'; g.fillRect(X + 2, Y + 2, 8, 8);
      g.fillStyle = '#050505'; g.fillRect(X + 1, Y + 1, 8, 8);
      g.fillStyle = dot; g.fillRect(X + 2, Y + 2, 6, 6);
    }
    if (c.special && c.specialKind === 'rune' && RUNE) {
      g.save();
      g.translate(X + tw + 2 - 15, Y - 3); g.scale(15 / 16, 15 / 16);
      g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round';
      g.shadowColor = '#7b4dff'; g.shadowBlur = 6 * res;
      g.strokeStyle = '#e4d8ff'; g.stroke(RUNE);
      g.restore();
    } else if (c.special) {
      g.save();
      g.font = '13px sans-serif'; g.textAlign = 'right'; g.textBaseline = 'top';
      g.shadowColor = '#000'; g.shadowOffsetY = res; g.shadowBlur = 2 * res;
      g.fillStyle = cssVar('--color-gold-200') || '#f4dba0';
      g.fillText('★', X + tw - 1, Y);
      g.restore();
    }
    if (c.note && NOTE) {
      const nx = X + 2; const ny = Y + th - 20;
      g.fillStyle = '#000'; g.fillRect(nx + 1, ny + 1, 18, 18);
      g.fillRect(nx, ny, 18, 18);
      g.fillStyle = '#f4e8c8'; g.fillRect(nx + 1, ny + 1, 16, 16);
      g.save();
      g.translate(nx + 2, ny + 2); g.scale(14 / 24, 14 / 24);
      g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#3a2812';
      g.stroke(NOTE);
      g.restore();
    }
    if (c.fav) {
      g.save();
      g.font = '12px sans-serif'; g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillStyle = '#000'; g.fillText('★', X + tw - 1, Y + th + 1);
      g.fillStyle = cssVar('--color-map-label-me') || '#e0b04a'; g.fillText('★', X + tw - 2, Y + th);
      g.restore();
    }
  }

  // Bloc (x0, y0) dans son canevas : sol (bord du monde, calques d'influence, sous-bois), puis eau et décors ligne
  // par ligne, puis villages ligne par ligne (toujours au-dessus des décors). Décors et grands villages débordent
  // sur les cases voisines : ceux des cases autour du bloc sont dessinés aussi (le canevas les coupe à son bord).
  function drawChunk(g, x0, y0) {
    const X = (x) => (x - x0) * tw; const Y = (y) => (y - y0) * th;
    const inWorld = (x, y) => x >= 0 && y >= 0 && x < WORLD && y < WORLD;
    const L = { influence: layerOn('influence'), faction: layerOn('faction'), enemy: layerOn('enemy') };
    for (let y = y0; y < y0 + CHUNK; y++) {
      for (let x = x0; x < x0 + CHUNK; x++) {
        if (!inWorld(x, y)) { g.fillStyle = paint(PAINT.edge); g.fillRect(X(x), Y(y), tw, th); continue; }
        // Calque de faction sous celui de la tribu : une case de ta tribu garde sa couleur quand les deux sont affichés.
        const ownZone = near(x, y, ['current', 'own', 'tribe']);
        if (ownZone && L.influence) { g.fillStyle = paint(PAINT.influence); g.fillRect(X(x), Y(y), tw, th); }
        if (L.faction && !(ownZone && L.influence) && nearFaction(x, y)) { g.fillStyle = paint(PAINT.faction); g.fillRect(X(x), Y(y), tw, th); }
        if (L.enemy && !ownZone && near(x, y, ['enemy'])) { g.fillStyle = paint(PAINT.enemy); g.fillRect(X(x), Y(y), tw, th); }
        // Sol des forêts assombri (fondu vers les lisières), villages compris : pas de clairières carrées.
        const woods = forestAt(x, y);
        if (woods) { g.fillStyle = `rgb(22 40 12 / ${(0.1 + 0.3 * woods).toFixed(2)})`; g.fillRect(X(x), Y(y), tw, th); }
      }
    }
    // Eau : texture calée sur le monde (même décalage que l'herbe, voir texOffset).
    const w = waterSpec();
    const wimg = w.src && image(w.src);
    let pattern = null;
    if (wimg) {
      pattern = g.createPattern(wimg, 'repeat');
      const T = texture();
      pattern.setTransform(new DOMMatrix().translateSelf(texOffset(x0, tw), texOffset(y0, th)).scaleSelf(T / wimg.naturalWidth, T / wimg.naturalHeight));
    }
    const inside = (x, y) => x >= x0 && y >= y0 && x < x0 + CHUNK && y < y0 + CHUNK;
    for (let y = y0 - 2; y < y0 + CHUNK + 2; y++) {
      for (let x = x0 - 2; x < x0 + CHUNK + 2; x++) {
        if (!inWorld(x, y) || cells.has(ck(x, y))) continue;
        const ground = terrain(x, y);
        if (ground === 'water') { if (inside(x, y)) drawWater(g, x, y, X(x), Y(y), pattern); continue; }
        for (const d of decorations(x, y, ground, forestAt(x, y))) {
          const s = decorSpec(d.kind, d.flip);
          const img = s.src && image(s.src);
          if (!img) continue;
          // Comme .map-decor > span : boîte agrandie de `scale` autour d'un point aux trois quarts de sa hauteur.
          const bw = s.w * d.scale; const bh = s.h * d.scale;
          const left = X(x) + tw / 2 + d.dx - bw / 2;
          const top = Y(y) + th / 2 + d.dy + s.oy + s.h * (0.25 - 0.75 * d.scale);
          g.drawImage(img, ...contain(img, left, top, bw, bh));
        }
      }
    }
    for (let y = y0 - 1; y < y0 + CHUNK + 1; y++) {
      for (let x = x0 - 1; x < x0 + CHUNK + 1; x++) {
        const c = cells.get(ck(x, y));
        if (!c || hiddenBarb(c)) continue;
        const design = c.design || 'beige';
        const sp = villageSprite(c.kind, design, c.level);
        if (sp) g.drawImage(sp.canvas, X(x) + sp.x, Y(y) + sp.y, sp.w, sp.h);
        drawMarks(g, c, X(x), Y(y), villageSpec(c.kind, design, c.level).color);
      }
    }
  }

  // Pastilles des ordres en cours (en haut à droite, débordant sur la case voisine) : HTML au-dessus de tous les
  // canevas, transparent aux clics.
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
  // qui en sortent). Un bloc n'est redessiné que si les villages de son secteur ou d'un secteur voisin changent
  // (le décor et les zones d'influence dépendent des cases voisines), si un calque change ou si la résolution change.
  const CHUNK = 10;
  const chunkBox = document.createElement('div');
  // Case survolée (repère et ancre de l'infobulle et du menu) et case sélectionnée, au-dessus des villages.
  const hoverEl = document.createElement('div');
  hoverEl.className = 'map-hover pointer-events-none absolute z-[4] hidden w-(--tile-w) h-(--tile-h)';
  const selEl = document.createElement('div');
  selEl.className = 'map-tile pointer-events-none absolute hidden w-(--tile-w) h-(--tile-h) bg-none';
  selEl.setAttribute('data-selected', '');
  const overlay = document.createElement('div');
  overlay.className = 'pointer-events-none absolute';
  layer.append(chunkBox, selEl, hoverEl, overlay);
  const chunks = new Map();
  const dirty = new Set();
  // Zone de blocs à garder dessinés (vue + MARGIN cases de chaque côté), en numéros de bloc.
  let zone = null;
  // Blocs sortis de la zone, masqués et gardés pour resservir : en glissant, aucun élément n'est ajouté ni retiré de la
  // page. Une insertion fait recalculer les styles de toute la page (règles :has(:checked)… des utilitaires has-*),
  // un bloc déplacé seulement le sien.
  const spare = [];
  function chunkEl() {
    const reused = spare.pop();
    if (reused) { reused.hidden = false; return reused; }
    const el = document.createElement('div');
    el.className = 'absolute';
    el.setAttribute('data-map-chunk', '');
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute top-0 left-0 size-full';
    el.append(canvas);
    chunkBox.append(el);
    return el;
  }
  function releaseChunk(k) {
    const el = chunks.get(k);
    chunks.delete(k);
    dirty.delete(k);
    el.hidden = true;
    spare.push(el);
  }

  // Bloc (a, b) : cases a·CHUNK… et b·CHUNK…, texture d'herbe calée sur le monde (hors du monde : bord, voir drawChunk).
  function buildChunk(a, b) {
    const k = key(a, b);
    let el = chunks.get(k);
    const x0 = a * CHUNK; const y0 = b * CHUNK;
    if (!el) {
      el = chunkEl();
      el.style.cssText = `left:${x0 * tw}px;top:${y0 * th}px;width:${CHUNK * tw}px;height:${CHUNK * th}px;--terrain-px:${texOffset(x0, tw)}px;--terrain-py:${texOffset(y0, th)}px`;
      chunks.set(k, el);
    }
    dirty.delete(k);
    const canvas = el.firstElementChild;
    const W = Math.round(CHUNK * tw * res); const H = Math.round(CHUNK * th * res);
    const g = canvas.getContext('2d');
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } else { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); }
    g.setTransform(W / (CHUNK * tw), 0, 0, H / (CHUNK * th), 0, 0);
    drawing = k;
    drawChunk(g, x0, y0);
    drawing = null;
    // Pastilles d'ordres : touchées seulement si le bloc en avait ou en a (rares).
    const badges = [];
    for (let y = y0; y < y0 + CHUNK; y++) {
      for (let x = x0; x < x0 + CHUNK; x++) {
        const c = cells.get(ck(x, y));
        if (c && !hiddenBarb(c)) badges.push(orderBadgesHtml(c, `left:${(x - x0) * tw}px;top:${(y - y0) * th}px`));
      }
    }
    const html = badges.join('');
    if (el.dataset.badges !== html) {
      while (canvas.nextSibling) canvas.nextSibling.remove();
      if (html) el.insertAdjacentHTML('beforeend', html);
      el.dataset.badges = html;
    }
  }

  // Tout redessiner (taille des cases changée, carte agrandie…).
  function dropChunks() {
    chunkBox.textContent = '';
    spare.length = 0;
    chunks.clear();
    dirty.clear();
    specs.clear();
    sprites.clear();
    warmVillageSpecs(cells.values());
    zone = null;
  }
  // Tous les blocs gardés à refaire (calque basculé, image arrivée, résolution changée), du centre vers les bords.
  function redrawAll() {
    for (const k of chunks.keys()) dirty.add(k);
    schedule();
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
    // Villages demandés un secteur plus loin que la zone dessinée : ils arrivent avant que les blocs en aient besoin
    // (sinon un bloc est dessiné vide, puis redessiné quand ses villages arrivent).
    ensure(z.a0 * CHUNK - SECTOR, z.b0 * CHUNK - SECTOR, (z.a1 + 1) * CHUNK - 1 + SECTOR, (z.b1 + 1) * CHUNK - 1 + SECTOR);
    for (const k of [...chunks.keys()]) {
      const [a, b] = k.split('|').map(Number);
      if (a < z.a0 || a > z.a1 || b < z.b0 || b > z.b1) releaseChunk(k);
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
  // la vue, recalés quand la vue sort de sa marge. Leurs éléments sont créés une fois, puis seulement déplacés.
  // Frontières de continent (tous les 100 cases) : 3 au plus par axe dans la fenêtre, même dézoomée.
  const BORDERS = 3;
  overlay.innerHTML = [
    ...Array.from({ length: BORDERS }, () => '<div class="pointer-events-none absolute top-0 z-[5] hidden h-full border-l-[3px] border-dashed border-gold-400/80 group-data-[layer-borders]/map:block" data-border-x></div>'),
    ...Array.from({ length: BORDERS }, () => '<div class="pointer-events-none absolute left-0 z-[5] hidden w-full border-t-[3px] border-dashed border-gold-400/80 group-data-[layer-borders]/map:block" data-border-y></div>'),
    '<div class="map-grid-lines pointer-events-none absolute inset-0 z-[4] hidden group-data-[layer-grid]/map:block" data-grid></div>',
    // Zones de foi : couleur de carte (--color-map-label, la même dans tous les styles) sur un liseré sombre.
    `<svg class="pointer-events-none absolute inset-0 z-[4] hidden overflow-visible group-data-[layer-church]/map:block" width="100%" height="100%" aria-hidden="true"><g class="fill-map-label/15 stroke-black/45" stroke-width="5">${'<ellipse/>'.repeat((boot.churches || []).length)}</g><g class="fill-none stroke-map-label" stroke-width="2.5" stroke-dasharray="10 5">${'<ellipse/>'.repeat((boot.churches || []).length)}</g></svg>`,
    '<svg class="pointer-events-none absolute inset-0 z-[7] hidden overflow-visible group-data-[layer-moves]/map:block" width="100%" height="100%" aria-hidden="true"><path class="stroke-blood-450" stroke-width="2" stroke-dasharray="6 5" fill="none" data-arrow-lines/><path class="fill-blood-450" data-arrow-heads/></svg>',
  ].join('');
  const borderX = [...overlay.querySelectorAll('[data-border-x]')];
  const borderY = [...overlay.querySelectorAll('[data-border-y]')];
  const gridEl = overlay.querySelector('[data-grid]');
  const churchEls = [...overlay.querySelectorAll('ellipse')];
  const arrowLines = overlay.querySelector('[data-arrow-lines]');
  const arrowHeads = overlay.querySelector('[data-arrow-heads]');
  const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

  function frameOverlay() {
    const x0 = Math.floor(cx) - half - MARGIN;
    const y0 = Math.floor(cy) - half - MARGIN;
    span = size + 2 * MARGIN;
    baseX = x0;
    baseY = y0;
    const lines = (els, from, prop, px) => els.forEach((el, i) => {
      const v = Math.ceil(from / 100) * 100 + i * 100;
      const on = v < from + span;
      el.style.display = on ? '' : 'none';
      if (on) el.style[prop] = `${(v - from) * px}px`;
    });
    lines(borderX, x0, 'left', tw);
    lines(borderY, y0, 'top', th);
    gridEl.style.setProperty('--grid-x', String((5 - (((x0 % 5) + 5) % 5)) % 5));
    gridEl.style.setProperty('--grid-y', String((5 - (((y0 % 5) + 5) % 5)) % 5));
    churchZones(x0, y0);
    arrows(x0, y0);
    overlay.style.cssText = `left:${x0 * tw}px;top:${y0 * th}px;width:${span * tw}px;height:${span * th}px`;
    rulers();
  }

  function render() {
    const [w, h] = [tw, th];
    fit();
    if (tw !== w || th !== h) dropChunks();
    const r = resFor();
    if (r !== res) { res = r; sprites.clear(); redrawAll(); }
    zone = null;
    frameOverlay();
    place();
    applySelection();
  }

  // Zones d'influence de ses églises (mondes avec église, calque « Zones de foi ») : hors de ces cercles, ses villages se
  // battent à 50 %. Deux ellipses par église (liseré sombre, trait clair).
  function churchZones(x0, y0) {
    const list = boot.churches || [];
    churchEls.forEach((el, i) => {
      const [x, y, r] = list[i % list.length];
      setAttr(el, 'cx', ((x - x0 + 0.5) * tw).toFixed(1));
      setAttr(el, 'cy', ((y - y0 + 0.5) * th).toFixed(1));
      setAttr(el, 'rx', (r * tw).toFixed(1));
      setAttr(el, 'ry', (r * th).toFixed(1));
    });
  }

  // Flèches des attaques en route depuis ce village (calque « Mouvements de troupes ») : plus de flèche une fois
  // l'attaque arrivée (le retour des troupes n'en a pas).
  const liveAttacks = () => boot.attacks.filter(([, , at]) => !at || at > Date.now());
  function arrows(x0, y0) {
    const px = (x) => (x - x0 + 0.5) * tw;
    const py = (y) => (y - y0 + 0.5) * th;
    let line = '';
    let heads = '';
    for (const [tx, ty] of liveAttacks()) {
      const [sx0, sy0, x1, y1] = [px(meX), py(meY), px(tx), py(ty)];
      const dx = x1 - sx0; const dy = y1 - sy0; const L = Math.hypot(dx, dy) || 1; const ux = dx / L; const uy = dy / L;
      const ex = x1 - ux * 13; const ey = y1 - uy * 13; const bx = ex - ux * 8; const by = ey - uy * 8;
      line += `M${(sx0 + ux * 18).toFixed(1)} ${(sy0 + uy * 18).toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`;
      heads += `M${ex.toFixed(1)} ${ey.toFixed(1)}L${(bx - uy * 5).toFixed(1)} ${(by + ux * 5).toFixed(1)}L${(bx + uy * 5).toFixed(1)} ${(by - ux * 5).toFixed(1)}Z`;
    }
    setAttr(arrowLines, 'd', line);
    setAttr(arrowHeads, 'd', heads);
  }

  // Règles (coordonnées au bord de la carte) : un canevas par axe, redessiné quand la fenêtre est recalée et décalé
  // à chaque image (calque à part, will-change). Couleurs de carte (--color-map-label*), les mêmes dans tous les
  // styles : la règle est posée sur la carte.
  rulerX.innerHTML = '<canvas class="absolute inset-y-0 left-0 will-change-transform" data-inner></canvas>';
  rulerY.innerHTML = '<canvas class="absolute right-0 -top-5 will-change-transform" data-inner></canvas>';
  function rulers() {
    // Dézoomé, les cases deviennent trop petites pour leur numéro : un numéro toutes les 2, 5 ou 10 cases.
    const every = (px, need) => [1, 2, 5, 10, 20].find((n) => n * px >= need) || 50;
    const ratio = window.devicePixelRatio || 1;
    const font = `600 11px ${getComputedStyle(rulerX).fontFamily}`;
    const draw = (canvas, w, h, labels) => {
      canvas.width = Math.ceil(w * ratio); canvas.height = Math.ceil(h * ratio);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      const g = canvas.getContext('2d');
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [text, x, y, me] of labels) {
        g.fillStyle = '#000'; g.fillText(text, x + 1, y + 1);
        g.fillStyle = cssVar(me ? '--color-map-label-me' : '--color-map-label'); g.fillText(text, x, y);
      }
    };
    const stepX = every(sw, 26); const stepY = every(sh, 15);
    const rw = rulerY.clientWidth; const rh = rulerX.clientHeight;
    const lx = []; const ly = [];
    for (let i = 0; i < span; i++) {
      if ((baseX + i) % stepX === 0) lx.push([String(baseX + i), (i + 0.5) * sw, rh / 2, baseX + i === meX]);
      if ((baseY + i) % stepY === 0) ly.push([String(baseY + i), rw / 2, (i + 0.5) * sh, baseY + i === meY]);
    }
    draw(rulerX.firstChild, span * sw, rh, lx);
    draw(rulerY.firstChild, rw, span * sh, ly);
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
    if (label) setText(label, `${baseSize} × ${baseSize}`);
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
    hideTip(); hideHover(); closeMenu();
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
      if (title) setText(title, `Continent ${continent(x, y)}`);
      const range = document.querySelector('[data-map-range]');
      if (range) setText(range, `${x - half}–${x - half + size - 1} × ${y - half}–${y - half + size - 1}`);
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
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, tile: villageAt(e) };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    if (!drag.moved) { drag.moved = true; viewport.classList.add('is-dragging'); hideTip(); hideHover(); closeMenu(); }
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
    if (d.tile) { const el = pointTile(...d.tile); selectTile(el); openMenu(el); } else closeMenu();
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
    setText(zoomLabel, `×${(Math.round(z * 10) / 10).toLocaleString('fr-FR')}`);
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
    const r = resFor();
    if (r !== res) { res = r; sprites.clear(); redrawAll(); }
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
  // Case sous le pointeur, d'après sa position dans la fenêtre : la case `cx - half` commence à `ox` px.
  function cellAt(e) {
    const r = viewport.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left - ox) / sw + cx - half), Math.floor((e.clientY - r.top - oy) / sh + cy - half)];
  }
  // Village sous le pointeur (coordonnées), sauf barbare masqué.
  function villageAt(e) {
    const [x, y] = cellAt(e);
    const c = cells.get(ck(x, y));
    return c && !hiddenBarb(c) ? [x, y] : null;
  }
  // Repère de la case survolée : il sert aussi d'ancre à l'infobulle et au menu (data-x, data-y, position).
  function pointTile(x, y) {
    hoverEl.dataset.x = x;
    hoverEl.dataset.y = y;
    hoverEl.style.left = `${x * tw}px`;
    hoverEl.style.top = `${y * th}px`;
    hoverEl.classList.remove('hidden');
    return hoverEl;
  }
  function hideHover() { hoverEl.classList.add('hidden'); hoverAt = ''; viewport.style.cursor = ''; }
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
    const set = (k, v) => { const n = tip.querySelector(`[data-tip="${k}"]`); if (n) setText(n, String(v)); };
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
      travel.querySelectorAll('[data-tip-pace]').forEach((n) => { setText(n, fmt(Math.round(dist * Number(n.dataset.tipPace) * 60))); });
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
  // Survol : la case sous la souris est calculée (pas d'élément par case) ; sur un village, repère et infobulle.
  let hoverAt = '';
  viewport.addEventListener('pointermove', (e) => {
    if (drag) return;
    const v = e.target.closest('.map-controls, [data-mini-over]') ? null : villageAt(e);
    viewport.style.cursor = v ? 'pointer' : '';
    const k = v ? v.join('|') : '';
    if (k === hoverAt) return;
    hoverAt = k;
    if (!v) { hideHover(); hideTip(); return; }
    const el = pointTile(...v);
    if (!menuOpen()) showTip(el);
  });
  viewport.addEventListener('pointerleave', () => { hideHover(); hideTip(); });
  setInterval(() => {
    if (!tip || tip.classList.contains('hidden')) return;
    tip.querySelectorAll('[data-order-arrival]').forEach((el) => {
      setText(el, fmt(Math.max(0, Math.ceil((Number(el.dataset.orderArrival) - Date.now()) / 1000))));
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
  // Villages d'une case rechargés tout de suite (ordre envoyé depuis la carte) : son secteur est redemandé, ses
  // blocs se redessinent à l'arrivée avec la pastille de l'ordre, et l'infobulle avec sa liste d'ordres.
  function reloadAt(x, y) {
    loaded.delete(key(Math.floor(x / SECTOR), Math.floor(y / SECTOR)));
    ensure(x, y, x, y);
  }
  function refreshTip() {
    if (!tip || tip.classList.contains('hidden') || !tipAt) return;
    const c = cells.get(ck(...tipAt));
    if (c && !hiddenBarb(c)) showTip(pointTile(...tipAt)); else hideTip();
  }
  setInterval(() => {
    // Attaque arrivée : sa flèche disparaît.
    if (boot.attacks.length !== liveAttacks().length) { boot.attacks = liveAttacks(); arrows(baseX, baseY); }
    if (Date.now() < nextArrival) return;
    nextArrival = Infinity;
    for (const c of cells.values()) noteArrivals(c);
    reloadVisible();
    refreshTip();
    setTimeout(() => { reloadVisible(); }, RELOAD_AFTER_MS);
  }, 1000);

  // Case sélectionnée (« Aller à », résultat de recherche, village cliqué) : un seul cadre, posé sur la case.
  function applySelection() {
    selEl.classList.toggle('hidden', !sel);
    if (!sel) return;
    selEl.style.left = `${sel[0] * tw}px`;
    selEl.style.top = `${sel[1] * th}px`;
  }

  function selectTile(el) {
    sel = [Number(el.dataset.x), Number(el.dataset.y)];
    applySelection();
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
    const [tx, ty] = radial.dataset.targetXy.split('|').map(Number);
    const body = new URLSearchParams({ _csrf: frame.dataset.csrf, template: button.dataset.farmSend, target: radial.dataset.target });
    // Roue fermée dès le clic (avant la réponse) : le résultat arrive par une notification.
    closeMenu();
    try {
      const res = await fetch(`${base}/farm/send`, { method: 'POST', body, headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Envoi impossible.');
      boot.attacks.push([tx, ty, data.arrivesAt]);
      arrows(baseX, baseY);
      reloadAt(tx, ty);
      window.adarmaToast?.(`Attaque envoyée sur ${tx}|${ty}.`);
    } catch (err) {
      window.adarmaToast?.(err.message, true);
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
  const LAYER_KEYS = ['markers', 'moves', 'church', 'influence', 'faction', 'enemy', 'nobarb', 'grid', 'borders'];
  const layersOn = () => Object.fromEntries(LAYER_KEYS.map((k) => [k, frame.hasAttribute(`data-layer-${k}`)]));
  document.querySelectorAll('[data-map-layer]').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.mapLayer;
      const on = b.getAttribute('aria-pressed') !== 'true';
      frame.toggleAttribute(`data-layer-${k}`, on);
      b.setAttribute('aria-pressed', String(on));
      if (['influence', 'faction', 'enemy', 'nobarb', 'markers'].includes(k)) { redrawAll(); hideHover(); hideTip(); }
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
