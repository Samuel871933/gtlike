'use strict';

// Rendu commun des mini-cartes : mini-carte de la page Carte, fenêtre « Carte du monde », profil d'un joueur.
// Un seul dessin (terrain, quadrillage, continents, villages) : le modifier ici le modifie partout.
// Couleurs : jetons --color-mini-* de src/styles/app.css (redéfinis par les styles de jeu).
// Terrain : src/game/terrain.js (servi en /js/terrain.js, à charger avant ce fichier).
//
//   GTMinimap.draw(canvas, { x0, y0, width, height, villages, frame, layers })
//     villages  [[x, y, kind, marquage ?]] ; kind : current, own, tribe, ally, nap, enemy, other, barb
//               (ou directement une couleur #rrggbb) ; marquage : couleur #rrggbb du marquage du joueur
//     frame     { x, y, size } facultatif : zone affichée par la grande carte
//     layers    calques de la carte (« Calques de carte ») : markers, influence, enemy, nobarb, grid, borders ;
//               sans calques (profil) : marquages et frontières de continent seulement
//   GTMinimap.cellAt(canvas, view, event) → [x, y] de la case cliquée
//   Les canevas [data-minimap] (JSON de la vue dans l'attribut) sont dessinés automatiquement.
(function () {
  const KINDS = ['current', 'own', 'tribe', 'ally', 'nap', 'enemy', 'other', 'barb'];

  let colors = null;
  function palette() {
    if (colors) return colors;
    const css = getComputedStyle(document.documentElement);
    const token = (name) => css.getPropertyValue(`--color-mini-${name}`).trim();
    colors = {};
    for (const k of [...KINDS, 'bg', 'grass-1', 'grass-2', 'grass-low', 'grass-high', 'forest', 'forest-deep', 'water', 'grid', 'border', 'grid-5', 'influence', 'enemy-zone']) colors[k] = token(k);
    return colors;
  }

  // Terrain par plaques de quelques cases (plus grandes quand la vue est grande).
  function paintTerrain(g, c, v, cell) {
    const T = window.GTTerrain;
    g.fillStyle = c.bg;
    g.fillRect(0, 0, v.width * cell, v.height * cell);
    if (!T) return;
    const patch = Math.max(4, Math.ceil(Math.max(v.width, v.height) / 160));
    // Plaques calées sur les coordonnées du monde (multiples de `patch`), pas sur le coin de la vue : quand la
    // mini-carte glisse, le terrain glisse avec elle au lieu d'être redécoupé.
    const px0 = Math.floor(v.x0 / patch) * patch; const py0 = Math.floor(v.y0 / patch) * patch;
    for (let py = py0; py < v.y0 + v.height; py += patch) {
      for (let px = px0; px < v.x0 + v.width; px += patch) {
        const x = px + Math.floor(patch / 2); const y = py + Math.floor(patch / 2);
        const biome = T.biomeAt(x, y);
        const woods = T.forestAt(x, y);
        if (T.waterAt(x, y)) g.fillStyle = c.water;
        else if (woods > 0) g.fillStyle = woods > 0.5 ? c['forest-deep'] : c.forest;
        else if (biome < 0.38) g.fillStyle = c['grass-low'];
        else if (biome > 0.72) g.fillStyle = c['grass-high'];
        else g.fillStyle = biome < 0.54 ? c['grass-1'] : c['grass-2'];
        // Plaque découpée au bord de la vue.
        const left = Math.max(px, v.x0); const top = Math.max(py, v.y0);
        const right = Math.min(px + patch, v.x0 + v.width); const bottom = Math.min(py + patch, v.y0 + v.height);
        g.fillRect((left - v.x0) * cell, (top - v.y0) * cell, (right - left) * cell, (bottom - top) * cell);
      }
    }
  }

  // Quadrillage de 10 cases ; calques : quadrillage de 5 cases, frontières de continent (tous les 100).
  function paintGrid(g, c, v, cell, ratio, layers) {
    const W = v.width * cell; const H = v.height * cell;
    const line = (n) => (n % 100 === 0 && layers.borders ? [c.border, 2 * ratio] : n % 10 === 0 ? [c.grid, ratio] : n % 5 === 0 && layers.grid ? [c['grid-5'], ratio] : null);
    for (let i = 0; i <= v.width; i++) {
      const l = line(v.x0 + i);
      if (l) { g.fillStyle = l[0]; g.fillRect(Math.round(i * cell), 0, l[1], H); }
    }
    for (let i = 0; i <= v.height; i++) {
      const l = line(v.y0 + i);
      if (l) { g.fillStyle = l[0]; g.fillRect(0, Math.round(i * cell), W, l[1]); }
    }
  }

  // Calques « Influence de ta tribu » et « Zones ennemies » : cases voisines de ses villages (ou de sa tribu),
  // sinon d'un ennemi, comme sur la carte.
  function paintZones(g, c, v, cell, layers) {
    if (!layers.influence && !layers.enemy) return;
    const own = new Set(); const enemy = new Set();
    for (const [x, y, kind] of v.villages) {
      const set = kind === 'current' || kind === 'own' || kind === 'tribe' ? own : kind === 'enemy' ? enemy : null;
      if (!set) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set.add(`${x + dx}|${y + dy}`);
    }
    const fill = (set, color, skip) => {
      g.fillStyle = color;
      for (const k of set) {
        if (skip && skip.has(k)) continue;
        const [x, y] = k.split('|').map(Number);
        if (x >= v.x0 && y >= v.y0 && x < v.x0 + v.width && y < v.y0 + v.height) g.fillRect((x - v.x0) * cell, (y - v.y0) * cell, cell, cell);
      }
    };
    if (layers.influence) fill(own, c.influence);
    if (layers.enemy) fill(enemy, c['enemy-zone'], layers.influence ? own : null);
  }

  // Un village : carré dans sa case, même taille pour tous (marqués ou non). Calques : marquages, barbares masqués.
  function paintVillages(g, c, v, cell, ratio, layers) {
    for (const [x, y, kind, mark] of v.villages) {
      if (kind === 'barb' && layers.nobarb) continue;
      const color = kind.startsWith('#') ? kind : (layers.markers && mark) || c[kind] || c.other;
      const inset = cell > 4 ? cell * 0.07 : Math.min(cell * 0.07, ratio * 0.35);
      const side = Math.max(1, cell - 2 * inset);
      g.fillStyle = color;
      g.fillRect((x - v.x0) * cell + inset, (y - v.y0) * cell + inset, side, side);
    }
  }

  // Sans calques (profil) : marquages et frontières de continent.
  const DEFAULT_LAYERS = { markers: true, borders: true };

  function draw(canvas, v) {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * ratio);
    if (!w) return;
    const h = Math.round(w * v.height / v.width);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext('2d');
    const c = palette();
    const cell = w / v.width;
    const layers = v.layers || DEFAULT_LAYERS;
    paintTerrain(g, c, v, cell);
    paintZones(g, c, v, cell, layers);
    paintGrid(g, c, v, cell, ratio, layers);
    paintVillages(g, c, v, cell, ratio, layers);
    if (v.frame) {
      const { x, y, size } = v.frame;
      g.lineWidth = 2 * ratio; g.strokeStyle = '#000'; g.strokeRect((x - v.x0) * cell, (y - v.y0) * cell, size * cell, size * cell);
      g.lineWidth = ratio; g.strokeStyle = '#f2ece2'; g.strokeRect((x - v.x0) * cell, (y - v.y0) * cell, size * cell, size * cell);
    }
  }

  function cellAt(canvas, v, e) {
    const r = canvas.getBoundingClientRect();
    return [v.x0 + Math.floor((e.clientX - r.left) / r.width * v.width), v.y0 + Math.floor((e.clientY - r.top) / r.height * v.height)];
  }

  window.GTMinimap = { draw, cellAt };

  // Mini-cartes statiques (profil) : vue décrite dans data-minimap, redessinées au redimensionnement.
  const statics = [...document.querySelectorAll('canvas[data-minimap]')].map((canvas) => [canvas, JSON.parse(canvas.dataset.minimap)]);
  if (statics.length) {
    const drawAll = () => statics.forEach(([canvas, v]) => draw(canvas, v));
    drawAll();
    window.addEventListener('resize', drawAll);
  }
}());
