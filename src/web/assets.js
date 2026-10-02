'use strict';

// Adresses versionnées des CSS et JS (`/css/app.css?v=…`, d'après la date de modification du fichier) : le
// navigateur les garde un an sans les redemander, et une nouvelle version change l'adresse d'elle-même.

const fs = require('fs');
const path = require('path');
const config = require('../config');

const ROOT = path.join(__dirname, '..', '..');
// Fichiers servis ailleurs que dans public/ (voir app.js).
const SOURCES = { '/js/terrain.js': path.join(ROOT, 'src', 'game', 'terrain.js') };
const versions = new Map();

function fileOf(url) {
  return SOURCES[url] || path.join(ROOT, 'public', url);
}

/** `/css/app.css` → `/css/app.css?v=…` ; relu à chaque appel en dev (CSS recompilé par Tailwind en continu). */
function asset(url) {
  if (config.isProduction && versions.has(url)) return versions.get(url);
  let versioned = url;
  try {
    versioned = `${url}?v=${Math.floor(fs.statSync(fileOf(url)).mtimeMs).toString(36)}`;
  } catch {
    // fichier absent : adresse sans version
  }
  versions.set(url, versioned);
  return versioned;
}

/** En-têtes de cache : un an pour une adresse versionnée, revalidation sinon. */
function cacheHeaders(req, res, next) {
  res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  next();
}

module.exports = { asset, cacheHeaders };
