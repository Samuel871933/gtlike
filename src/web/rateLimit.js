'use strict';

// Limite de cadence en mémoire du processus (fenêtre glissante), contre les scripts qui enchaînent les actions :
// `hit(key, max, windowMs)` compte une action pour `key` et dit si elle est permise (au plus `max` par `windowMs`).
// Avec plusieurs processus (pm2 -i N), chaque processus compte de son côté.

const hits = new Map();

function hit(key, max, windowMs, now = Date.now()) {
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  const ok = list.length < max;
  if (ok) list.push(now);
  hits.set(key, list);
  return ok;
}

// Ménage des clés inactives, une fois par minute.
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) if (!list.length || now - list[list.length - 1] > 60000) hits.delete(k);
}, 60000).unref();

module.exports = { hit };
