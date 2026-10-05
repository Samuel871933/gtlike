'use strict';

// Visuel provisoire d'un sceau (en attendant les illustrations) : un cachet de cire au bord festonné, de la couleur de
// son niveau (game/seals.js LEVEL_COLORS), avec l'icône de son type au centre (icônes de web/helpers.js).

const seals = require('../game/seals');

// Contour festonné du cachet (16 lobes), calculé une fois sur une grille de 100 × 100.
const EDGE = (() => {
  const pts = [];
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    const r = 46 + 2.6 * Math.cos(a * 16);
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

/** Assombrit ou éclaircit une couleur #rrggbb (`k` < 1 : plus sombre). */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Sceau `type` de niveau `level`, en SVG. `cls` : classes de taille ; `muted` : sceau absent (cire terne, icône pâle).
 */
function sealSvg(type, level, { cls = 'size-10', muted = false, title = null } = {}) {
  const def = seals.type(type);
  const color = seals.LEVEL_COLORS[Math.max(0, Math.min(seals.MAX_LEVEL, level) - 1)] || seals.LEVEL_COLORS[0];
  const ICONS = require('./helpers').ICONS;
  const ink = level === seals.MAX_LEVEL ? '#e3c26a' : '#f6ecd6';
  const wax = muted ? '#5b574f' : color;
  const label = title || (def ? `${def.name}, niveau ${level}` : '');
  return `<svg class="${cls} shrink-0" viewBox="0 0 100 100" role="img" aria-label="${label}"${muted ? ' opacity="0.35"' : ''}>`
    + (label ? `<title>${label}</title>` : '')
    + `<path d="${EDGE}" fill="${shade(wax, 0.62)}" transform="translate(1.5 2.5)"/>`
    + `<path d="${EDGE}" fill="${wax}" stroke="${shade(wax, 0.55)}" stroke-width="1.5"/>`
    + `<circle cx="50" cy="50" r="33" fill="none" stroke="${shade(wax, 0.6)}" stroke-width="3"/>`
    + `<circle cx="50" cy="50" r="30.5" fill="${shade(wax, 0.9)}"/>`
    + `<path d="M24 36 A30 30 0 0 1 58 21" fill="none" stroke="${shade(wax, 1.45)}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`
    + `<g transform="translate(29 29) scale(1.75)" fill="none" stroke="${muted ? '#a39d90' : ink}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${def ? ICONS[def.icon] || '' : ''}</g>`
    + '</svg>';
}

module.exports = { sealSvg };
