'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, ScavengeRun, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const ScavengeService = require('../src/services/ScavengeService');
const WorldConfig = require('../src/game/WorldConfig');
const scavenging = require('../src/game/scavenging');

const T0 = new Date('2026-09-24T12:00:00Z');
let v;
const ctxAt = (now) => VillageService.withVillage(v.id, async (c) => c, { now });

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  const u = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  ({ village: v } = await WorldService.join(u, 'w1', { now: T0 }));
  await Village.update({
    resourcesAt: T0, wood: 2000, stone: 2000, iron: 2000, units: { spear: 100, light: 10, spy: 5 },
    buildings: { main: 3, farm: 10, storage: 10, place: 1 },
  }, { where: { id: v.id } });
});

test.after(() => sequelize.close());

test('formules : durée communautaire, butin réparti, capacité sans éclaireurs', () => {
  const w = new WorldConfig({ speed: 1 });
  assert.equal(scavenging.capacity({ spear: 100, light: 10, spy: 5 }), 100 * 25 + 10 * 80);
  assert.equal(scavenging.duration(1000, 0.1, w), Math.round(Math.pow(1000 * 1000 * 100 * 0.01, 0.45) + 1800));
  assert.ok(scavenging.duration(1000, 0.75, w) > scavenging.duration(1000, 0.1, w));
  assert.ok(scavenging.duration(1000, 0.1, new WorldConfig({ speed: 4 })) < scavenging.duration(1000, 0.1, w));
  assert.deepEqual(scavenging.haul(1000, 0.25), { wood: 84, stone: 83, iron: 83 });
});

test('expédition : troupes absentes, retour avec le butin et un rapport', async () => {
  await assert.rejects(ScavengeService.send(v.id, 2, { spear: 10 }, { now: T0 }), /non débloquée/);
  await assert.rejects(ScavengeService.send(v.id, 1, { spy: 5 }, { now: T0 }), /transporter/);
  const run = await ScavengeService.send(v.id, 1, { spear: 100 }, { now: T0 });
  assert.deepEqual(run.resources, scavenging.haul(2500, 0.1));
  await assert.rejects(ScavengeService.send(v.id, 1, { light: 1 }, { now: T0 }), /déjà en cours/);
  let ctx = await ctxAt(T0);
  assert.equal(ctx.state.units.spear, undefined);
  assert.equal(ctx.awayUnits.spear, 100, 'toujours à la charge de la ferme');

  const woodBefore = ctx.state.resourcesAtTime(run.endsAt).wood;
  ctx = await ctxAt(run.endsAt);
  assert.equal(ctx.state.units.spear, 100);
  assert.ok(Math.abs(ctx.state.resources.wood - (woodBefore + run.resources.wood)) < 1e-6);
  assert.equal(await ScavengeRun.count(), 0);
  assert.ok(await Report.findOne({ where: { type: 'scavenge' } }));
});

test('déblocage : dans l’ordre, payé, effectif à la fin du délai', async () => {
  const now = new Date(T0.getTime() + 86400000);
  await assert.rejects(ScavengeService.unlock(v.id, 3, { now }), /d'abord « Collecteurs modestes »/);
  await ScavengeService.unlock(v.id, 2, { now });
  await assert.rejects(ScavengeService.unlock(v.id, 3, { now }), /déjà en cours/);
  const village = await Village.findByPk(v.id);
  const endsAt = new Date(village.scavenging.unlocking.endsAt);
  assert.equal(+endsAt - +now, 3600000);
  const ctx = await ctxAt(endsAt);
  assert.deepEqual([...ScavengeService.unlocked(ctx.village, ctx.cfg)].sort(), [1, 2]);
  await ScavengeService.send(v.id, 2, { light: 10 }, { now: endsAt });
});
