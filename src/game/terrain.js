'use strict';

// Terrain déterministe de la carte, partagé par le serveur (placement des villages : MapPlacer) et par le
// navigateur (dessin de la carte : public/js/map.js, servi en /js/terrain.js). Même coordonnées → même décor.
//
//   water   étendues d'eau, des mares d'une case aux grands lacs
//   hill    montagne (une case, sprite)
//   forêt   massifs de sapins (forestAt : 0 hors forêt, jusqu'à 1 au cœur)
//   trees, pine, rocks : petits décors, franchissables
//
// Pas de village sur l'eau, les montagnes ni le cœur des forêts (blocked).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTTerrain = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const rnd = (a, b, s) => {
    let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  const biomeAt = (x, y) => (
    rnd(Math.floor(x / 5), Math.floor(y / 5), 11)
    + rnd(Math.floor((x + 3) / 5), Math.floor((y + 3) / 5), 19)
  ) / 2;

  // Bruit lissé : valeurs aléatoires sur une grille de `step` cases, interpolées.
  const smooth = (x, y, step, seed) => {
    const gx = Math.floor(x / step); const gy = Math.floor(y / step);
    let fx = x / step - gx; let fy = y / step - gy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = rnd(gx, gy, seed); const b = rnd(gx + 1, gy, seed); const c = rnd(gx, gy + 1, seed); const d = rnd(gx + 1, gy + 1, seed);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };

  // Un grand décor n'est placé que sur le minimum local de son voisinage : des amas espacés.
  const isAnchor = (x, y, seed, radius, ceiling) => {
    const n = rnd(x, y, seed);
    if (n > ceiling) return false;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if ((dx || dy) && rnd(x + dx, y + dy, seed) < n) return false;
      }
    }
    return true;
  };

  // Grandes étendues d'eau : bruit à très grande échelle, seuil élevé (rares, de forme irrégulière).
  // Le seuil monte un peu (plafonné) au cœur des grandes zones : les plus grands lacs rétrécissent
  // (~130 cases au plus au lieu de ~200) sans se morceler, les petits restent intacts.
  const WATER = 0.8;
  const rawWater = (x, y) => {
    const coarse = smooth(x, y, 30, 301);
    return 0.78 * coarse + 0.22 * smooth(x, y, 8, 307) > WATER + Math.min(0.025, 0.5 * Math.max(0, coarse - 0.83));
  };
  // Lissage des grandes étendues : pas d'avancée isolée d'une case.
  const largeWaterAt = (x, y) => rawWater(x, y)
    && (rawWater(x + 1, y) + rawWater(x - 1, y) + rawWater(x, y + 1) + rawWater(x, y - 1)) >= 2;

  // Petits lacs : chaque bloc de 9 × 9 cases peut contenir un centre déterministe. Les rayons mélangent
  // mares d'une seule case et bassins de 2 à 5 cases de diamètre, tous rendus avec les vraies berges.
  const SMALL_WATER_STEP = 9;
  const smallWaterAt = (x, y) => {
    const gx0 = Math.floor(x / SMALL_WATER_STEP); const gy0 = Math.floor(y / SMALL_WATER_STEP);
    for (let gy = gy0 - 1; gy <= gy0 + 1; gy++) {
      for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
        if (rnd(gx, gy, 347) >= 0.48) continue;
        const cx = gx * SMALL_WATER_STEP + Math.floor(rnd(gx, gy, 349) * SMALL_WATER_STEP);
        const cy = gy * SMALL_WATER_STEP + Math.floor(rnd(gx, gy, 353) * SMALL_WATER_STEP);
        const biome = biomeAt(cx, cy);
        if (biome < 0.32 || biome > 0.72) continue;
        const size = rnd(gx, gy, 359);
        const radius = size < 0.38 ? 0.58 : size < 0.78 ? 1.35 : 2.1;
        const rx = radius * (0.82 + rnd(gx, gy, 367) * 0.36);
        const ry = radius * (0.82 + rnd(gx, gy, 373) * 0.36);
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) return true;
      }
    }
    return false;
  };
  const waterAt = (x, y) => largeWaterAt(x, y) || smallWaterAt(x, y);

  // Forêts : ~16 % de la carte, en massifs de plusieurs dizaines de cases.
  const FOREST = 0.68;
  const forestAt = (x, y) => (waterAt(x, y) ? 0
    : Math.max(0, Math.min(1, ((0.7 * smooth(x, y, 16, 201) + 0.3 * smooth(x, y, 6, 211)) - FOREST) / 0.14)));
  // Cœur de forêt (densité ≥ 0,5) : trop dense pour y bâtir ; les lisières restent constructibles.
  const DENSE_FOREST = 0.5;

  /** Décor principal d'une case : water, forest, hill, trees, pine, rocks ou null (herbe). */
  const terrain = (x, y) => {
    if (waterAt(x, y)) return 'water';
    if (forestAt(x, y) > 0) return 'forest';
    const biome = biomeAt(x, y);
    if (biome > 0.62 && isAnchor(x, y, 67, 2, 0.22)) return 'hill';
    if (biome < 0.52 && rnd(x, y, 29) < 0.22) return 'trees';
    if (biome < 0.58 && rnd(x, y, 23) < 0.11) return 'pine';
    if (rnd(x, y, 31) < 0.032) return 'rocks';
    return null;
  };

  /** La case est-elle inconstructible (eau, montagne, cœur de forêt) ? */
  const blocked = (x, y) => {
    const t = terrain(x, y);
    return t === 'water' || t === 'hill' || forestAt(x, y) >= DENSE_FOREST;
  };

  return { rnd, biomeAt, smooth, isAnchor, smallWaterAt, waterAt, forestAt, terrain, blocked, DENSE_FOREST };
}));
