'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, World } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const registry = require('../src/game/registry');
const formulas = require('../src/game/formulas');

const T0 = new Date('2026-09-24T12:00:00Z');
let v;

const ctxAt = (now) => VillageService.withVillage(v.id, async (c) => c, { now });

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  const u = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  ({ village: v } = await WorldService.join(u, 'w1', { now: T0 }));
  await Village.update({
    resourcesAt: T0, wood: 20000, stone: 20000, iron: 20000,
    buildings: { main: 5, farm: 10, storage: 15, barracks: 5, smith: 1, stable: 3 },
  }, { where: { id: v.id } });
});

test.after(() => sequelize.close());

test('facteur de forge : 91 %, 83 %, 75 %… 15 % au niveau 20 (wiki)', () => {
  const cost = { wood: 1000, stone: 0, iron: 0 };
  const base = formulas.researchTime(cost, 0, 1);
  assert.deepEqual([1, 2, 3, 20].map((l) => Math.round((100 * formulas.researchTime(cost, l, 1)) / base)), [91, 83, 75, 15]);
});

test('la hache doit être recherchée, et demande la forge 2', async () => {
  let ctx = await ctxAt(T0);
  const axe = VillageService.recruitOptions(ctx, 'barracks').find((o) => o.type.id === 'axe');
  assert.ok(axe.locked);
  assert.ok(axe.reasons.includes('Recherche à la forge'));
  assert.ok(axe.reasons.includes('Forge niveau 2'));
  await assert.rejects(VillageService.recruit(v.id, 'barracks', { axe: 1 }, { now: T0 }), /Forge niveau 2/);
  await assert.rejects(VillageService.research(v.id, 'axe', { now: T0 }), /Forge niveau 2/);

  const spear = VillageService.recruitOptions(ctx, 'barracks').find((o) => o.type.id === 'spear');
  assert.equal(spear.locked, false, 'le lancier ne se recherche pas');

  await Village.update({ buildings: { main: 5, farm: 10, storage: 15, barracks: 5, smith: 2, stable: 3 } }, { where: { id: v.id } });
  const order = await VillageService.research(v.id, 'axe', { now: T0 });
  assert.equal(+order.endsAt - +T0, registry.unit('axe').researchTimeFor(2, (await World.findOne()).getConfig()) * 1000);
  await assert.rejects(VillageService.research(v.id, 'light', { now: T0 }), /déjà en cours/);
  await assert.rejects(VillageService.recruit(v.id, 'barracks', { axe: 1 }, { now: T0 }), /forge/);

  ctx = await ctxAt(order.endsAt);
  assert.equal(ctx.state.research.axe, true);
  assert.equal(ctx.researchOrders.length, 0);
  await VillageService.recruit(v.id, 'barracks', { axe: 5 }, { now: order.endsAt });
});

test('annulation : 90 % remboursés', async () => {
  const now = new Date(T0.getTime() + 86400000);
  const before = (await ctxAt(now)).state.resources.wood;
  const order = await VillageService.research(v.id, 'light', { now });
  await VillageService.cancelResearch(v.id, order.id, { now });
  const after = (await ctxAt(now)).state.resources.wood;
  assert.equal(Math.round(before - after), 2200 - Math.floor(2200 * 0.9));
});

test('monde sans recherche : les unités sont disponibles directement', async () => {
  const world = await World.findOne();
  await world.update({ config: { ...world.config, tech: 'none' } });
  const ctx = await ctxAt(new Date(T0.getTime() + 2 * 86400000));
  const light = VillageService.recruitOptions(ctx, 'stable').find((o) => o.type.id === 'light');
  assert.equal(light.locked, false);
  assert.equal(VillageService.researchOptions(ctx).length, 0);
});
