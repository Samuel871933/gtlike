'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Knight, Command } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const CommandService = require('../src/services/CommandService');
const KnightSkillService = require('../src/services/KnightSkillService');

const T0 = new Date('2026-09-24T12:00:00Z');
let a;
let a2;
let knight;
const ctxAt = (id, now) => VillageService.withVillage(id, async (c) => c, { now });

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { knightSystem: 'skills', features: { knight: true } } });
  const u = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  let player;
  ({ village: a, player } = await WorldService.join(u, 'w1', { now: T0 }));
  const world = await (require('../src/models').World).findOne();
  // Deuxième village sur une case libre près du premier (le barbare de l'inscription tombe à 2 à 6 cases).
  let dx = 3;
  while (await Village.count({ where: { worldId: world.id, x: a.x + dx, y: a.y } })) dx++;
  a2 = await WorldService.createVillage(world, { x: a.x + dx, y: a.y, player, name: 'Second', buildings: { main: 1, farm: 5, storage: 5, statue: 1 }, now: T0 });
  await Village.update({
    resourcesAt: T0, wood: 20000, stone: 20000, iron: 20000, units: { knight: 1 },
    buildings: { main: 5, farm: 10, storage: 15, statue: 1 },
  }, { where: { id: a.id } });
  knight = await Knight.create({ playerId: player.id, homeVillageId: a.id, name: 'Lancelot' });
});

test.after(() => sequelize.close());

test('formation : le paladin quitte le village, reste à la charge de la ferme, revient avec son expérience', async () => {
  const popBefore = (await ctxAt(a.id, T0)).popUsed();
  await KnightSkillService.train(a.id, 'drill', { now: T0 });
  let ctx = await ctxAt(a.id, T0);
  assert.equal(ctx.state.units.knight, undefined, 'absent pendant la formation');
  assert.equal(ctx.popUsed(), popBefore, 'toujours compté dans la ferme');
  assert.equal(Math.round(ctx.state.resources.wood), 20000 - 1500);
  await assert.rejects(KnightSkillService.train(a.id, 'drill', { now: T0 }), /déjà en formation/);

  await knight.reload();
  ctx = await ctxAt(a.id, knight.trainingEndsAt);
  assert.equal(ctx.state.units.knight, 1);
  await knight.reload();
  assert.equal(knight.xp, 2500);
  assert.equal(knight.trainingEndsAt, null);
});

test('déménagement : voyage à la vitesse du paladin, nouveau village d’attache à l’arrivée', async () => {
  const now = new Date(T0.getTime() + 86400000);
  await assert.rejects(CommandService.relocateKnight(a.id, a.id, { now }), /autre de vos villages/);
  const cmd = await CommandService.relocateKnight(a.id, a2.id, { now });
  assert.equal(cmd.type, 'relocate');
  assert.equal(+cmd.arrivesAt - +now, 3 * 10 * 60 * 1000, '3 cases à 10 min/case');
  assert.equal((await ctxAt(a.id, now)).state.units.knight, undefined);

  await CommandService.processDue(cmd.arrivesAt);
  await knight.reload();
  assert.equal(knight.homeVillageId, a2.id);
  assert.equal((await ctxAt(a2.id, cmd.arrivesAt)).state.units.knight, 1);
  assert.equal(await Command.count(), 0);
});
