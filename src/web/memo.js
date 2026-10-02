'use strict';

// Résultats recalculés au plus une fois par période et partagés par toutes les requêtes du processus : classements
// (tous les joueurs du monde, triés) et exports publics de la carte. Les appels simultanés attendent le même calcul.

const entries = new Map();

/** @template T @param {string} key @param {number} ttlMs @param {() => Promise<T>} compute @returns {Promise<T>} */
function memo(key, ttlMs, compute) {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expires > now) return hit.value;
  for (const [k, e] of entries) if (e.expires <= now) entries.delete(k);
  const value = Promise.resolve().then(compute);
  entries.set(key, { value, expires: now + ttlMs });
  value.catch(() => entries.delete(key));
  return value;
}

module.exports = { memo };
