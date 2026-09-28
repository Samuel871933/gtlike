'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const terrain = require('../src/game/terrain');
const { MapPlacer } = require('../src/game/MapPlacer');
const WorldConfig = require('../src/game/WorldConfig');

test('terrain : déterministe, avec eau, petites mares, forêts et montagnes', () => {
  const kinds = new Set();
  let smallWater = 0;
  for (let y = 400; y < 600; y += 3) for (let x = 400; x < 600; x += 3) kinds.add(terrain.terrain(x, y));
  for (let y = 400; y < 600; y++) for (let x = 400; x < 600; x++) if (terrain.smallWaterAt(x, y)) smallWater++;
  for (const k of ['water', 'forest', 'hill', null]) assert.ok(kinds.has(k), `décor ${k} présent`);
  assert.ok(smallWater > 100, `petites cases d'eau présentes (${smallWater})`);
  assert.equal(terrain.terrain(512, 487), terrain.terrain(512, 487));
  assert.equal(terrain.forestAt(123, 456), terrain.forestAt(123, 456));
});

test('placement : jamais de village sur l’eau, une montagne ou au cœur d’une forêt', () => {
  const cfg = new WorldConfig({});
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const placer = new MapPlacer(cfg, new Set(), rng);
  for (let i = 0; i < 600; i++) {
    const { x, y } = placer.findSpot({ margin: i % 3 ? 1 : 0 });
    assert.equal(terrain.blocked(x, y), false, `${x}|${y} (${terrain.terrain(x, y)})`);
  }
});

test('villages barbares à l’inscription : placement.emptyVillages en %, comme coord.empty_villages de GT', () => {
  assert.equal(MapPlacer.barbariansOnJoin(0, () => 0), 0);
  assert.equal(MapPlacer.barbariansOnJoin(100, () => 0.99), 1);
  assert.equal(MapPlacer.barbariansOnJoin(170, () => 0.69), 2);
  assert.equal(MapPlacer.barbariansOnJoin(170, () => 0.7), 1);
  assert.equal(MapPlacer.barbariansOnJoin(2000, () => 0.5), 20);
  assert.equal(MapPlacer.barbariansOnJoin(30, () => 0.29), 1);
  assert.equal(MapPlacer.barbariansOnJoin(30, () => 0.3), 0);
  assert.equal(new WorldConfig({}).placement.emptyVillages, 100);
});

test('villages barbares d’un nouveau joueur : placés près de lui, sur des cases libres', () => {
  const cfg = new WorldConfig({});
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const placer = new MapPlacer(cfg, new Set(), rng);
  const home = placer.findSpot();
  for (let i = 0; i < 20; i++) {
    const b = placer.findNear(home);
    const d = Math.hypot(b.x - home.x, b.y - home.y);
    assert.ok(d >= 1.4 && d <= 12, `barbare à ${d.toFixed(1)} cases`);
    assert.ok(!terrain.blocked(b.x, b.y));
  }
  assert.equal(placer.occupied.size, 21);
});

// Comme WorldService.join : bord de la zone peuplée, puis bandes de MapPlacer.BAND cases, une lecture par bande.
function joinLikeService(cfg, full, last, rng) {
  const c = cfg.center;
  let read = 0;
  for (let r = MapPlacer.startRadius(cfg, full.occupied.size, last); r <= MapPlacer.edge(cfg); r += MapPlacer.BAND) {
    const ring = MapPlacer.bandRing(r);
    const subset = new Set([...full.occupied].filter((k) => {
      const [x, y] = k.split('|').map(Number);
      const d = Math.hypot(x - c, y - c);
      return d >= Math.floor(ring.min) && d <= Math.ceil(ring.max) + 1;
    }));
    read += subset.size;
    const placer = new MapPlacer(cfg, subset, rng, { count: full.occupied.size, ring });
    const spot = placer.trySpot({ radius: r, until: r + MapPlacer.BAND });
    if (spot) return { spot, barb: placer.findNear(spot), read };
  }
  throw new Error('carte pleine');
}

test('inscription : seules les bandes de l’anneau sont lues, sans collision, même sur une grande carte', () => {
  const cfg = new WorldConfig({});
  let seed = 11;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Carte déjà remplie (20 000 villages), en partant du bord réel comme le service.
  const full = new MapPlacer(cfg, new Set(), rng);
  let last = null;
  while (full.occupied.size < 20000) {
    last = full.findSpot({ radius: MapPlacer.startRadius(cfg, full.occupied.size, last) });
    full.findNear(last);
  }
  let read = 0;
  for (let i = 0; i < 50; i++) {
    const joined = joinLikeService(cfg, full, last, rng);
    assert.ok(full.isFree(joined.spot.x, joined.spot.y, 1), `joueur en ${joined.spot.x}|${joined.spot.y} : case et voisines libres sur la carte complète`);
    full.take(joined.spot.x, joined.spot.y);
    assert.ok(full.isFree(joined.barb.x, joined.barb.y, 0), `barbare en ${joined.barb.x}|${joined.barb.y} libre sur la carte complète`);
    full.take(joined.barb.x, joined.barb.y);
    last = joined.spot;
    read = Math.max(read, joined.read);
  }
  // Une bande de l'anneau, pas le disque.
  assert.ok(read < full.occupied.size * 0.2, `${read} villages lus sur ${full.occupied.size}`);
});
