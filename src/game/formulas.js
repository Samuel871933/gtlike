'use strict';

// Formules de Guerre Tribale. Toutes les durées sont en secondes.

/** Production horaire d'une mine au niveau donné. Niveau 0 : production minimale. */
function production(level, world) {
  if (level <= 0) return world.zeroLevelProduction * world.speed;
  return world.baseProduction * Math.pow(1.163118, level - 1) * world.speed;
}

/** Capacité de l'entrepôt (par ressource). */
function storageCapacity(level) {
  return Math.round(1000 * Math.pow(1.2294934, level - 1));
}

/** Population maximale de la ferme. */
function farmCapacity(level) {
  return Math.round(240 * Math.pow(1.172103, level - 1));
}

/** Ressources protégées par la cachette (par ressource). */
function hideCapacity(level) {
  if (level <= 0) return 0;
  return Math.round(150 * Math.pow(1.3335, level - 1));
}

/**
 * Temps de construction (buildtime_formula 2) pour atteindre `targetLevel`,
 * avec un quartier général au niveau `hqLevel`.
 * Les premiers niveaux sont très rapides grâce au plancher de l'exposant à -13.
 */
function buildTime(baseTime, timeFactor, targetLevel, hqLevel, speed) {
  const n = targetLevel - 1;
  const exponent = n === 0 ? -13 : Math.max(-13, n - 14 / n);
  return Math.round((baseTime * 1.18 * Math.pow(timeFactor, exponent) * Math.pow(1.05, -hqLevel)) / speed);
}

/**
 * Temps de recrutement d'une unité (secondes, non arrondi) selon le niveau
 * du bâtiment de recrutement : -6 % composé par niveau.
 * Vérifié en jeu : lancier caserne 5 à vitesse 1.5 = 8:29, cav. légère écurie 3 = 16:48.
 */
function recruitTime(baseTime, buildingLevel, speed) {
  return (baseTime / speed) * Math.pow(1.06, -buildingLevel);
}

/**
 * Durée d'une recherche à la forge. Le facteur de forge 1.1^-niveau est celui du wiki
 * (91 %, 83 %… 15 % au niveau 20). La durée de base n'est pas publiée : on l'estime à
 * 1.5 s par ressource du coût de la recherche (≈ 1 h pour la hache à vitesse 1).
 */
function researchTime(cost, smithLevel, speed) {
  const base = (cost.wood + cost.stone + cost.iron) * 1.5;
  return Math.round((base / speed) * Math.pow(1.1, -smithLevel));
}

// Nombre de marchands par niveau de marché (table de Guerre Tribale).
const MERCHANTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 19, 26, 35, 46, 59, 74, 91, 110, 131, 154, 179, 206, 235];

function merchantCount(marketLevel) {
  return MERCHANTS[Math.max(0, Math.min(marketLevel, MERCHANTS.length - 1))];
}

module.exports = {
  production, storageCapacity, farmCapacity, hideCapacity, buildTime, recruitTime, researchTime, merchantCount,
};
