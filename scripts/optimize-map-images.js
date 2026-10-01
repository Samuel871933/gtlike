'use strict';

// Images de la carte allégées (WebP, ombres des décors incluses), à relancer après l'ajout ou la retouche d'une image :
//   node scripts/optimize-map-images.js
//
// - Décors uniques de la carte (berges, eau, colline) : réduits à environ deux fois leur taille affichée
//   (écrans haute densité). Les sources font plus de 1 200 px pour une case de 53 × 38 : le navigateur les
//   décodait en entier (~6 Mo de mémoire chacune) et les réduisait à chaque image pendant un glisser.
// - Villages (public/img/map/villages/<design>/level-N.png) : même taille (la boutique les montre en grand),
//   simplement convertis en WebP, ~5 à 10 fois plus légers. Les PNG restent les sources.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAP = path.join(__dirname, '..', 'public', 'img', 'map');

// [source, cible, largeur maximale]
const DECOR = [
  ['shore-straight-v2.png', 'shore-straight-v3.webp', 192],
  ['shore-corner-v1.png', 'shore-corner-v2.webp', 192],
  // Texture d'eau : 6 cases de large (318 px) ; 640 px pour les écrans haute densité.
  ['water-seamless-v1.png', 'water-seamless-v2.webp', 640],
  ['decor-hill-v5.png', 'decor-hill-v6.webp', 220],
];

// Petits décors semés par centaines sur la carte : l'ombre portée est dessinée dans l'image. En CSS
// (filter: drop-shadow sur chaque élément), elle coûtait un rendu hors écran par arbre à chaque glisser.
// Même ombre qu'avant, drop-shadow(0 2px 1px rgb(0 0 0 / .48)) à l'écran, ramenée à l'échelle de l'image :
// `ratio` = pixels de l'image par pixel affiché (taille CSS de .map-decor--<kind> > span, case de 38 px).
const SHADOWED = [
  ['decor-pine-v4.png', 'decor-pine-v5.webp', 3.96],
  ['decor-trees-v4.png', 'decor-trees-v5.webp', 3.55],
  ['decor-rocks-v4.png', 'decor-rocks-v5.webp', 12],
  ['decor-hill-v6.webp', 'decor-hill-v7.webp', 3.5],
];

async function convert(src, dest, width) {
  let img = sharp(src);
  if (width) img = img.resize({ width, withoutEnlargement: true, kernel: 'lanczos3' });
  await img.webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(dest);
  return [fs.statSync(src).size, fs.statSync(dest).size];
}

async function shadowed(src, dest, ratio) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const offset = Math.round(2 * ratio);
  // Silhouette noire à 48 %, décalée vers le bas puis floutée (rayon CSS de 1 px ≈ écart type de 0,5 px).
  const shadow = Buffer.alloc(width * height * 4);
  for (let y = offset; y < height; y++) {
    for (let x = 0; x < width; x++) shadow[(y * width + x) * 4 + 3] = Math.round(data[((y - offset) * width + x) * 4 + 3] * 0.48);
  }
  const blurred = await sharp(shadow, { raw: { width, height, channels: 4 } }).blur(Math.max(0.3, 0.5 * ratio)).png().toBuffer();
  await sharp(blurred).composite([{ input: data, raw: { width, height, channels: 4 } }])
    .webp({ quality: 88, alphaQuality: 92, effort: 6 }).toFile(dest);
  return [fs.statSync(src).size, fs.statSync(dest).size];
}

(async () => {
  let before = 0;
  let after = 0;
  const add = ([a, b]) => { before += a; after += b; };
  for (const [src, dest, width] of DECOR) add(await convert(path.join(MAP, src), path.join(MAP, dest), width));
  for (const [src, dest, ratio] of SHADOWED) add(await shadowed(path.join(MAP, src), path.join(MAP, dest), ratio));
  const villages = path.join(MAP, 'villages');
  for (const design of fs.readdirSync(villages)) {
    const dir = path.join(villages, design);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/^level-\d\.png$/.test(file)) continue;
      add(await convert(path.join(dir, file), path.join(dir, file.replace(/\.png$/, '.webp'))));
    }
  }
  const mo = (n) => `${(n / 1024 / 1024).toFixed(1)} Mo`;
  console.log(`Images de la carte : ${mo(before)} → ${mo(after)}`);
})().catch((err) => { console.error(err); process.exit(1); });
