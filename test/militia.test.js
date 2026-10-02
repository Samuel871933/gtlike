'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const MilitiaService = require('../src/services/MilitiaService');
const CommandService = require('../src/services/CommandService');
const registry = require('../src/game/registry');
const WorldConfig = require('../src/game/WorldConfig');

const T0 = new Date('2026-09-24T12:00:00Z');
const at = (h) => new Date(T0.getTime() + h * 3600000);
let v;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { features: { militia: true } } });
  await WorldService.createWorld({ slug: 'w2', name: 'Monde 2', config: {} });
  const u = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  ({ village: v } = await WorldService.join(u, 'w1', { now: T0 }));
  await v.update({ buildings: { ...v.buildings, farm: 17, wood: 20, stone: 20, iron: 20, storage: 25, place: 1 }, wood: 0, stone: 0, iron: 0, resourcesAt: T0 });
});

test.after(() => sequelize.close());

test('milice : 20 par niveau de ferme (plafond niveau 15), 6 h, défense seulement, hors envoi et population', async () => {
  const cfg = new WorldConfig({ features: { militia: true } });
  assert.equal(MilitiaService.size(cfg, 17), 300, 'niveau 17 : plafonné au niveau 15');
  assert.equal(MilitiaService.size(cfg, 4), 80);
  const u = registry.unit('militia');
  assert.deepEqual([u.attack, u.defense, u.defenseCavalry, u.defenseArcher, u.pop, u.carry], [0, 15, 45, 25, 0, 0]);
  assert.ok(!registry.unitsFor(cfg).some((x) => x.id === 'militia'), 'jamais proposée à l’envoi');
  assert.ok(!registry.unitsFor(new WorldConfig({})).some((x) => x.id === 'militia'));
  assert.deepEqual(CommandService.parseUnits({ militia: 10, spear: 2 }, cfg), { spear: 2 });
});

test('appel : production réduite de moitié pendant le stationnement, puis la milice repart', async () => {
  const { size, until } = await MilitiaService.call(v.id, { now: T0 });
  assert.equal(size, 300);
  assert.equal(+until, +at(6));
  await assert.rejects(MilitiaService.call(v.id, { now: at(1) }), /déjà stationnée/);

  const full = await VillageService.withVillage(v.id, (ctx) => ({ units: ctx.state.units.militia, prod: ctx.state.productionPerHour().wood, pop: ctx.popUsed() }), { now: at(3) });
  assert.equal(full.units, 300);
  const normal = new (require('../src/game/VillageState'))({ buildings: { wood: 20 }, units: {}, wood: 0, stone: 0, iron: 0, resourcesAt: T0 }, new WorldConfig({})).productionPerHour().wood;
  assert.ok(Math.abs(full.prod - normal / 2) < 1e-9, 'production × 0,5');

  // 8 h après l'appel : 6 h à mi-production puis 2 h normales.
  const later = await VillageService.withVillage(v.id, (ctx) => ({ units: ctx.state.units.militia, wood: ctx.state.resources.wood, until: ctx.state.militiaUntil }), { now: at(8) });
  assert.equal(later.units, undefined, 'la milice est repartie');
  assert.equal(later.until, null);
  assert.ok(Math.abs(later.wood - (6 * normal / 2 + 2 * normal)) < 1e-6);
  assert.equal((await Village.findByPk(v.id)).militiaUntil, null);
});

test('refus : monde sans milice, plus de 2 villages', async () => {
  const u = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  const { village: other } = await WorldService.join(u, 'w2', { now: T0 });
  await assert.rejects(MilitiaService.call(other.id, { now: T0 }), /n’existe pas/);
  // Deux villages de plus pour Alice (3 au total).
  // Coin de la carte : toujours libre (les joueurs démarrent au centre).
  for (const [x, name] of [[1, 'Deux'], [2, 'Trois']]) {
    await Village.create({ worldId: v.worldId, playerId: v.playerId, name, x, y: 1, buildings: { main: 1 }, units: {}, wood: 0, stone: 0, iron: 0, resourcesAt: T0 });
  }
  await assert.rejects(MilitiaService.call(v.id, { now: at(10) }), /plus de 2 villages/);
});

test('combat : la milice défend comme ses valeurs (même défense que des lanciers, sans attaque)', () => {
  const combat = require('../src/game/combat');
  const withMilitia = combat.resolve({ attackers: { axe: 100 }, defenders: { militia: 300 } });
  const withSpears = combat.resolve({ attackers: { axe: 100 }, defenders: { spear: 300 } });
  assert.equal(withMilitia.attackerWins, withSpears.attackerWins);
  assert.deepEqual(withMilitia.attackerLosses, withSpears.attackerLosses, 'défense d’infanterie 15 comme le lancier');
  assert.equal(withMilitia.attackerWins, false);
  const vsCavalry = combat.resolve({ attackers: { light: 50 }, defenders: { militia: 200 } });
  assert.equal(vsCavalry.attackerWins, false, 'défense contre la cavalerie 45 : 200 × 45 > 50 × 130');
});
