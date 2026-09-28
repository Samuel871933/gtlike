'use strict';

// Rendu commun des mini-cartes : mini-carte de la page Carte, fenêtre « Carte du monde », profil d'un joueur.
// Un seul dessin (terrain, quadrillage, continents, villages) : le modifier ici le modifie partout.
// Couleurs : jetons --color-mini-* de src/styles/app.css (redéfinis par les styles de jeu).
// Terrain : src/game/terrain.js (servi en /js/terrain.js, à charger avant ce fichier).
//
//   GTMinimap.draw(canvas, { x0, y0, width, height, villages, home, frame })
//     villages  [[x, y, kind]] ; kind : current, own, tribe, ally, nap, enemy, other, barb, ou une couleur #rrggbb (marquage)
//     home      [x, y] facultatif : case entourée de blanc (le village actuel)
//     frame     { x, y, size } facultatif : zone affichée par la grande carte
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
    for (const k of [...KINDS, 'bg', 'grass-1', 'grass-2', 'grass-low', 'grass-high', 'forest', 'forest-deep', 'water', 'grid', 'border']) colors[k] = token(k);
    return colors;
  }

  // Terrain par plaques de quelques cases (plus grandes quand la vue est grande).
  function paintTerrain(g, c, v, cell) {
    const T = window.GTTerrain;
    g.fillStyle = c.bg;
    g.fillRect(0, 0, v.width * cell, v.height * cell);
    if (!T) return;
    const patch = Math.max(4, Math.ceil(Math.max(v.width, v.height) / 160));
    for (let oy = 0; oy < v.height; oy += patch) {
      for (let ox = 0; ox < v.width; ox += patch) {
        const x = v.x0 + ox + Math.floor(patch / 2); const y = v.y0 + oy + Math.floor(patch / 2);
        const biome = T.biomeAt(x, y);
        const woods = T.forestAt(x, y);
        if (T.waterAt(x, y)) g.fillStyle = c.water;
        else if (woods > 0) g.fillStyle = woods > 0.5 ? c['forest-deep'] : c.forest;
        else if (biome < 0.38) g.fillStyle = c['grass-low'];
        else if (biome > 0.72) g.fillStyle = c['grass-high'];
        else g.fillStyle = biome < 0.54 ? c['grass-1'] : c['grass-2'];
        g.fillRect(ox * cell, oy * cell, Math.min(patch, v.width - ox) * cell, Math.min(patch, v.height - oy) * cell);
      }
    }
  }

  // Quadrillage de 10 cases et frontières de continent (tous les 100).
  function paintGrid(g, c, v, cell, ratio) {
    const W = v.width * cell; const H = v.height * cell;
    for (let i = 0; i <= v.width; i++) {
      const x = v.x0 + i;
      if (x % 10 === 0) { g.fillStyle = x % 100 === 0 ? c.border : c.grid; g.fillRect(Math.round(i * cell), 0, x % 100 === 0 ? 2 * ratio : ratio, H); }
    }
    for (let i = 0; i <= v.height; i++) {
      const y = v.y0 + i;
      if (y % 10 === 0) { g.fillStyle = y % 100 === 0 ? c.border : c.grid; g.fillRect(0, Math.round(i * cell), W, y % 100 === 0 ? 2 * ratio : ratio); }
    }
  }

  // Un village : carré dans sa case, même taille pour tous (marqués ou non).
  function paintVillages(g, c, v, cell, ratio) {
    for (const [x, y, kind] of v.villages) {
      const marked = kind.startsWith('#');
      const inset = cell > 4 ? cell * 0.07 : Math.min(cell * 0.07, ratio * 0.35);
      const side = Math.max(1, cell - 2 * inset);
      g.fillStyle = marked ? kind : c[kind] || c.other;
      g.fillRect((x - v.x0) * cell + inset, (y - v.y0) * cell + inset, side, side);
    }
  }

  function draw(canvas, v) {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * ratio);
    if (!w) return;
    const h = Math.round(w * v.height / v.width);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext('2d');
    const c = palette();
    const cell = w / v.width;
    paintTerrain(g, c, v, cell);
    paintGrid(g, c, v, cell, ratio);
    paintVillages(g, c, v, cell, ratio);
    if (v.home) {
      const [hx, hy] = v.home;
      if (hx >= v.x0 && hx < v.x0 + v.width && hy >= v.y0 && hy < v.y0 + v.height) {
        g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, ratio);
        g.strokeRect((hx - v.x0) * cell - ratio, (hy - v.y0) * cell - ratio, cell + 2 * ratio, cell + 2 * ratio);
      }
    }
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
