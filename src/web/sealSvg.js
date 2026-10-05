'use strict';

const seals = require('../game/seals');

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

/**
 * Cachet de cire coloré par niveau, avec un sigle indépendant pour chaque bonus. `blank` : la cire seule, sans sigle
 * (case vide de la grille, comme les drapeaux sans motif de GT).
 */
function sealSvg(type, level, { cls = 'size-10', muted = false, title = null, blank = false } = {}) {
  const def = seals.type(type);
  const safeLevel = seals.isLevel(Number(level)) ? Number(level) : 1;
  const label = title || (def ? `${def.name}, niveau ${safeLevel}` : 'Sceau');
  return `<span class="seal-art ${escapeHtml(cls)}" role="img" aria-label="${escapeHtml(label)}"${muted ? ' data-muted="true"' : ''}>`
    + `<img class="seal-art__wax" src="/img/seals/wax-${safeLevel}.webp" alt="" aria-hidden="true">`
    + (def && !blank ? `<img class="seal-art__sigil" src="/img/seals/sigil-${def.id}.png" alt="" aria-hidden="true">` : '')
    + '</span>';
}

module.exports = { sealSvg };
