'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GAME_STYLES, DEFAULT_GAME_STYLE, gameStyleFor } = require('../src/web/gameStyles');

const styles = path.join(__dirname, '..', 'src', 'styles');
const read = (f) => fs.readFileSync(path.join(styles, f), 'utf8');
const tokens = (css) => Object.fromEntries([...css.matchAll(/^\s*(--(?:color|font)-[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));

test('styles de jeu : Adarma par défaut, chaque style a son fichier et son fond de village', () => {
  assert.equal(DEFAULT_GAME_STYLE, 'adarma');
  assert.equal(gameStyleFor(null).id, 'adarma');
  assert.equal(gameStyleFor({ gameStyle: 'roman' }).id, 'roman');
  assert.equal(gameStyleFor({ gameStyle: 'medieval' }).id, 'medieval');
  // Anciens noms du style Adarma.
  assert.equal(gameStyleFor({ gameStyle: 'basic' }).id, 'adarma');
  assert.equal(gameStyleFor({ gameStyle: 'brume' }).id, 'adarma');
  assert.equal(gameStyleFor({ gameStyle: 'inconnu' }).id, 'adarma');
  for (const id of Object.keys(GAME_STYLES)) {
    assert.match(read('app.css'), new RegExp(`@import "./game-styles/${id}.css";`));
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'game-styles', id, 'village.svg')), `${id} : village.svg`);
  }
});

test('style romain : les jetons redéfinis par les autres styles reprennent exactement les valeurs de @theme', () => {
  const app = read('app.css');
  const defaults = {};
  for (const m of app.matchAll(/@theme(?: static)? \{([\s\S]*?)\n\}/g)) Object.assign(defaults, tokens(m[1]));
  const roman = tokens(read('game-styles/roman.css'));
  for (const id of Object.keys(GAME_STYLES).filter((s) => s !== 'roman')) {
    for (const key of Object.keys(tokens(read(`game-styles/${id}.css`)))) {
      assert.ok(key in defaults, `${key} (${id}) absent de @theme`);
      assert.equal(roman[key], defaults[key], `${key} : roman.css doit reprendre la valeur de @theme`);
    }
  }
});

test('designs des villages : beige par défaut, 6 images et règles CSS pour chaque design', () => {
  const { VILLAGE_DESIGNS, villageDesignFor } = require('../src/web/villageDesigns');
  assert.equal(villageDesignFor(null).id, 'beige');
  assert.equal(villageDesignFor({ villageDesign: 'noir' }).id, 'noir');
  assert.equal(villageDesignFor({ villageDesign: 'inconnu' }).id, 'beige');
  const css = read('app.css');
  for (const id of Object.keys(VILLAGE_DESIGNS)) {
    for (let level = 1; level <= 6; level++) {
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'map', 'villages', id, `level-${level}.png`)), `${id} : niveau ${level}`);
      // Le CSS sert la version WebP (scripts/optimize-map-images.js).
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'map', 'villages', id, `level-${level}.webp`)), `${id} : niveau ${level} en WebP`);
      assert.ok(css.includes(`/img/map/villages/${id}/level-${level}.webp`), `${id} : règle CSS du niveau ${level}`);
    }
  }
});

test('design futuriste : les 6 sprites transparents gardent les dimensions de la carte', () => {
  const sizes = [[224, 146], [265, 214], [304, 234], [307, 235], [332, 257], [325, 258]];
  sizes.forEach(([width, height], index) => {
    const image = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'map', 'villages', 'futuriste', `level-${index + 1}.png`));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
    assert.equal(image[25], 6, 'PNG RGBA, donc transparence disponible');
  });
});

test('carte et mini-carte : aucun style ne redéfinit leurs couleurs', () => {
  const MAP = /^--color-(mini-|map-|grass-|forest|hill|water)/;
  for (const id of Object.keys(GAME_STYLES).filter((s) => s !== 'roman')) {
    const redefined = Object.keys(tokens(read(`game-styles/${id}.css`))).filter((k) => MAP.test(k));
    assert.deepEqual(redefined, [], `${id} redéfinit ${redefined.join(', ')}`);
  }
});
