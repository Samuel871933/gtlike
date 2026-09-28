'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, BuildOrder } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const registry = require('../src/game/registry');

const T0 = new Date('2026-09-24T12:00:00Z');
let village;
const ctxAt = (now) => VillageService.withVillage(village.id, async (c) => c, { now });

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { speed: 1, placement: { emptyVillages: 0 } } });
  const u = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  ({ village } = await WorldService.join(u, 'w1', { now: T0 }));
});

test.after(() => sequelize.close());

test('démolition : quartier général niveau 15 et loyauté à 100 % requis', async () => {
  await Village.update({ resourcesAt: T0, buildings: { main: 10, farm: 10, storage: 10, place: 1, wood: 5 } }, { where: { id: village.id } });
  const ctx = await ctxAt(T0);
  assert.match(VillageService.demolishOption(ctx, registry.building('wood')).blockers.join(), /Quartier général niveau 15/);
  await assert.rejects(VillageService.demolish(village.id, 'wood', { now: T0 }), /Quartier général niveau 15/);

  await Village.update({ buildings: { main: 15, farm: 10, storage: 10, place: 1, wood: 5 }, loyalty: 80 }, { where: { id: village.id } });
  await assert.rejects(VillageService.demolish(village.id, 'wood', { now: T0 }), /Loyauté/);
  await Village.update({ loyalty: 100 }, { where: { id: village.id } });
  // Niveau minimal : le point de ralliement ne descend pas sous 1… s'il a un minimum ; un bâtiment non construit ne se démolit pas.
  assert.match(VillageService.demolishOption(await ctxAt(T0), registry.building('farm')).blockers.join() || 'ok', /ok|Niveau minimal/);
});

test('démolition : gratuite, dans la file, le bâtiment perd un niveau à la fin', async () => {
  const before = await Village.findByPk(village.id);
  const order = await VillageService.demolish(village.id, 'wood', { now: T0 });
  assert.equal(order.demolish, true);
  assert.equal(order.level, 4);
  const after = await Village.findByPk(village.id);
  assert.equal(Math.round(after.wood), Math.round(before.wood), 'aucun coût');

  let ctx = await ctxAt(T0);
  assert.match(VillageService.buildOption(ctx, registry.building('wood')).blockers.join(), /Démolition en cours/);
  await assert.rejects(VillageService.demolish(village.id, 'wood', { now: T0 }), /Chantier en cours/);
  await assert.rejects(VillageService.finishBuild(village.id, order.id, { now: new Date(order.endsAt.getTime() - 1000) }), /démolition/);

  ctx = await ctxAt(new Date(order.endsAt.getTime() + 1));
  assert.equal(ctx.state.level('wood'), 4);
  assert.equal(ctx.buildOrders.length, 0);
});

test('démolition : annulation sans remboursement ni effet sur le bâtiment', async () => {
  const now = new Date(T0.getTime() + 86400000);
  const order = await VillageService.demolish(village.id, 'wood', { now });
  await VillageService.cancelBuild(village.id, order.id, { now });
  assert.equal(await BuildOrder.count({ where: { villageId: village.id } }), 0);
  assert.equal((await ctxAt(new Date(now.getTime() + 86400000))).state.level('wood'), 4);
});
