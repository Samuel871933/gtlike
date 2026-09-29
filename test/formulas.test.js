'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const formulas = require('../src/game/formulas');
const registry = require('../src/game/registry');
const WorldConfig = require('../src/game/WorldConfig');
const VillageState = require('../src/game/VillageState');
const { duration } = require('../src/web/helpers');

const world1 = new WorldConfig({ speed: 1 });
const fr104 = new WorldConfig({ speed: 1.5, unitSpeed: 0.7 });

test('coûts des bâtiments : base × facteur^(niveau-1)', () => {
  assert.deepEqual(registry.building('main').costFor(1), { wood: 90, stone: 80, iron: 70 });
  assert.deepEqual(registry.building('main').costFor(2), { wood: 113, stone: 102, iron: 88 });
  assert.deepEqual(registry.building('barracks').costFor(1), { wood: 200, stone: 170, iron: 90 });
});

test('capacités : entrepôt, ferme, production au niveau 30', () => {
  assert.ok(Math.abs(formulas.storageCapacity(30) - 400000) < 1000);
  assert.ok(Math.abs(formulas.farmCapacity(30) - 24000) < 100);
  assert.equal(formulas.storageCapacity(1), 1000);
  assert.equal(formulas.farmCapacity(1), 240);
  assert.equal(formulas.production(1, world1), 30);
  assert.ok(Math.abs(formulas.production(30, world1) - 2400) < 5);
  assert.equal(formulas.production(1, fr104), 45);
});

test("temps de recrutement : conformes aux captures d'écran (monde vitesse 1.5)", () => {
  const spear = registry.unit('spear').recruitTimeFor(5, fr104);
  const axe = registry.unit('axe').recruitTimeFor(5, fr104);
  const light = registry.unit('light').recruitTimeFor(3, fr104);
  const spy = registry.unit('spy').recruitTimeFor(3, fr104);
  assert.equal(duration(spear), '0:08:29');
  assert.equal(duration(axe), '0:10:58');
  assert.equal(duration(light), '0:16:48');
  assert.equal(duration(spy), '0:08:24');
  assert.equal(duration(light * 9), '2:31:08');
});

test('temps de construction : croît avec le niveau, baisse avec le QG', () => {
  const main = registry.building('main');
  const t = (lvl, hq) => main.buildTimeFor(lvl, hq, world1);
  assert.equal(t(2, 1), t(1, 1), 'les deux premiers niveaux ont le plancher -13');
  for (let lvl = 3; lvl <= 30; lvl++) assert.ok(t(lvl, 1) > t(lvl - 1, 1), `niveau ${lvl}`);
  assert.ok(t(10, 20) < t(10, 5));
  assert.equal(Math.round(t(10, 5) / t(10, 6) * 100), 105);
  assert.equal(main.buildTimeFor(10, 5, fr104), Math.round(900 * 1.18 * 1.2 ** (9 - 14 / 9) * 1.05 ** -5 / 1.5));
});

test('population : coût incrémental entre deux niveaux', () => {
  const barracks = registry.building('barracks');
  assert.equal(barracks.popFor(1), 7);
  assert.equal(barracks.popFor(2), Math.round(7 * 1.17) - 7);
});

test('modules du monde : chevalier, archers, église', () => {
  const classic = registry.buildingsFor(world1).map((b) => b.id);
  assert.ok(!classic.includes('statue'));
  const full = new WorldConfig({ features: { knight: true, archer: true } });
  assert.ok(registry.buildingsFor(full).some((b) => b.id === 'statue'));
  assert.ok(registry.unitsFor(full, 'barracks').some((u) => u.id === 'archer'));
  assert.ok(!registry.unitsFor(world1, 'barracks').some((u) => u.id === 'archer'));
});

test("VillageState : les ressources s'arrêtent à la capacité de l'entrepôt", () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  const s = new VillageState({ buildings: { main: 1, storage: 1, wood: 1 }, units: {}, wood: 900, stone: 0, iron: 0, resourcesAt: t0 }, world1);
  s.accrue(new Date(t0.getTime() + 2 * 3600000));
  assert.equal(s.resources.wood, 960);
  assert.equal(s.resources.stone, 10, 'niveau 0 : 5/h');
  s.accrue(new Date(t0.getTime() + 10 * 3600000));
  assert.equal(s.resources.wood, 1000);
});

test('VillageState : une mine terminée en cours de route change la production à partir de sa fin', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  const s = new VillageState({ buildings: { main: 1, storage: 10, wood: 1 }, units: {}, wood: 0, stone: 0, iron: 0, resourcesAt: t0 }, world1);
  const order = { building: 'wood', level: 2, endsAt: new Date(t0.getTime() + 3600000) };
  const done = s.applyBuildOrders([order], new Date(t0.getTime() + 2 * 3600000));
  assert.equal(done.length, 1);
  assert.equal(s.level('wood'), 2);
  assert.ok(Math.abs(s.resources.wood - (30 + 30 * 1.163118)) < 1e-6);
});

test('affordableAt : heure où la production couvre le coût, null au-delà de l\'entrepôt', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const state = new VillageState({ buildings: { wood: 1, stone: 1, iron: 1, storage: 1 }, units: {}, wood: 0, stone: 30, iron: 60, resourcesAt: now }, world1);
  const p = state.productionPerHour();
  // Le bois manque le plus : 60 à produire.
  assert.equal(state.affordableAt({ wood: 60, stone: 30, iron: 0 }, now).getTime(), now.getTime() + Math.ceil((60 / p.wood) * 3600) * 1000);
  assert.equal(state.affordableAt({ wood: 0, stone: 0, iron: 0 }, now).getTime(), now.getTime());
  assert.equal(state.affordableAt({ wood: 5000, stone: 0, iron: 0 }, now), null);
});
