'use strict';

// Illustrations des quêtes du tutoriel (game/tutorial.js), à relancer après l'ajout ou la retouche d'une quête :
//   node scripts/generate-quest-art.js
//
// Une image par quête, public/img/quests/<id>.webp, toutes au même format (960 × 400) :
// - quête de bâtiments (`art: { building, level }` ou `{ buildings }`) : leurs sprites du village posés sur le décor
//   du village, flouté ;
// - autre quête (`art: { src }`) : la scène recadrée. Les sources (scènes des rapports, ~2,5 Mo) restent telles quelles.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { QUESTS } = require('../src/game/tutorial');
const { buildingSprite } = require('../src/web/helpers');

const PUBLIC = path.join(__dirname, '..', 'public');
const OUT = path.join(PUBLIC, 'img', 'quests');
const W = 960;
const H = 400;
const file = (url) => path.join(PUBLIC, url.split('?')[0]);

// Un ou plusieurs bâtiments, côte à côte et centrés, sur le décor du village flouté.
async function sceneWithSprites(list) {
  const backdrop = await sharp(file('/img/village/medieval/background-v2.png'))
    .resize(W, H, { fit: 'cover', position: 'centre' }).blur(6).modulate({ brightness: 0.68 }).toBuffer();
  const height = list.length > 2 ? 300 : 360;
  const sprites = await Promise.all(list.map(async ([id, level]) => {
    const input = await sharp(file(buildingSprite(id, level))).resize({ height, fit: 'inside' }).toBuffer();
    return { input, width: (await sharp(input).metadata()).width };
  }));
  const gap = -20;
  let left = Math.round((W - sprites.reduce((n, s) => n + s.width, 0) - gap * (sprites.length - 1)) / 2);
  const layers = sprites.map((s) => {
    const layer = { input: s.input, left, top: H - height - 16 };
    left += s.width + gap;
    return layer;
  });
  return sharp(backdrop).composite(layers);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const q of QUESTS) {
    const img = q.art.building || q.art.buildings
      ? await sceneWithSprites(q.art.buildings || [[q.art.building, q.art.level]])
      : sharp(file(q.art.src)).resize(W, H, { fit: 'cover', position: 'attention' });
    const out = path.join(OUT, `${q.id}.webp`);
    await img.webp({ quality: 78 }).toFile(out);
    console.log(`${q.id}.webp`, `${Math.round(fs.statSync(out).size / 1024)} Ko`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
