'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, BuildOrder, RecruitOrder, Player } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const GameError = require('../src/services/GameError');

const T0 = new Date('2026-09-24T12:00:00Z');
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);

let user;
let village;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { speed: 1 } });
  user = await AuthService.register({ username: 'Samuel', email: 'test@example.com', password: 'motdepasse' });
  ({ village } = await WorldService.join(user, 'w1', { now: T0 }));
});

test.after(() => sequelize.close());

test('inscription : pseudo unique et connexion', async () => {
  await assert.rejects(AuthService.register({ username: 'Samuel', email: 'x@example.com', password: 'motdepasse' }), GameError);
  const logged = await AuthService.login({ login: 'test@example.com', password: 'motdepasse' });
  assert.equal(logged.id, user.id);
  await assert.rejects(AuthService.login({ login: 'Samuel', password: 'faux' }), GameError);
});

test('rejoindre un monde crée le village près du centre et un village barbare', async () => {
  assert.deepEqual(village.buildings, { main: 1, farm: 1, storage: 1, place: 1 });
  assert.ok(Math.abs(village.x - 500) < 10 && Math.abs(village.y - 500) < 10);
  assert.equal(await Village.count({ where: { playerId: null } }), 1);
  const player = await Player.findOne({ where: { userId: user.id } });
  assert.equal(player.points, village.points);
  await assert.rejects(WorldService.join(user, 'w1'), /déjà/);
});

test('construction : paiement, file de 2, puis niveau appliqué à la fin', async () => {
  const o1 = await VillageService.build(village.id, 'main', { now: T0 });
  assert.equal(o1.level, 2);
  const o2 = await VillageService.build(village.id, 'main', { now: T0 });
  assert.equal(o2.level, 3);
  assert.equal(+o2.startsAt, +o1.endsAt, 'le 2e ordre démarre à la fin du 1er');
  await assert.rejects(VillageService.build(village.id, 'wood', { now: T0 }), /file/);

  const v = await Village.findByPk(village.id);
  assert.equal(Math.round(v.wood), 500 - 113 - 143);

  const ctx = await VillageService.withVillage(village.id, async (c) => c, { now: new Date(o1.endsAt.getTime() + 1) });
  assert.equal(ctx.state.level('main'), 2);
  assert.equal(ctx.buildOrders.length, 1);
});

test('annulation : remboursement de 90 % et file avancée', async () => {
  const later = new Date((await BuildOrder.findOne({ where: { villageId: village.id } })).startsAt.getTime() + 1000);
  const wood = await VillageService.build(village.id, 'wood', { now: later });
  const main3 = await BuildOrder.findOne({ where: { villageId: village.id, building: 'main' } });
  const before = await Village.findByPk(village.id);
  await VillageService.cancelBuild(village.id, main3.id, { now: later });
  const after = await Village.findByPk(village.id);
  assert.equal(Math.round(after.wood - before.wood), Math.floor(main3.wood * 0.9));
  const moved = await BuildOrder.findByPk(wood.id);
  assert.equal(+moved.startsAt, +later, 'le camp de bois démarre tout de suite');
});

test('terminer gratuitement : construction en cours à moins de 3 minutes, file avancée', async () => {
  const wood = await BuildOrder.findOne({ where: { villageId: village.id, building: 'wood' } });
  const start = new Date(wood.startsAt);
  // Chantier de 10 minutes (les premiers niveaux durent moins de 3 minutes à vitesse 1).
  await wood.update({ endsAt: new Date(start.getTime() + 600 * 1000) });
  const storage = await VillageService.build(village.id, 'storage', { now: start });
  const tooEarly = new Date(wood.endsAt.getTime() - 181 * 1000);
  assert.ok(tooEarly > start, 'la construction dure plus de 3 minutes');
  await assert.rejects(VillageService.finishBuild(village.id, wood.id, { now: tooEarly }), /plus de 3 minutes/);
  await assert.rejects(VillageService.finishBuild(village.id, storage.id, { now: tooEarly }), /en cours/);

  const now = new Date(wood.endsAt.getTime() - 120 * 1000);
  assert.ok(VillageService.canFinishFree(wood, { freeFinishSeconds: 180 }, now));
  await VillageService.finishBuild(village.id, wood.id, { now });
  const ctx = await VillageService.withVillage(village.id, async (c) => c, { now });
  assert.equal(ctx.state.level('wood'), 1, 'niveau appliqué tout de suite');
  const moved = await BuildOrder.findByPk(storage.id);
  assert.equal(+moved.startsAt, +now, "l'entrepôt démarre tout de suite");
  assert.equal(+moved.endsAt - +moved.startsAt, +storage.endsAt - +storage.startsAt, 'même durée');
});

test('recrutement : caserne requise, unités livrées une par une', async () => {
  await assert.rejects(VillageService.recruit(village.id, 'barracks', { spear: 1 }, { now: T0 }), /non construit/);

  await Village.update(
    { buildings: { main: 3, farm: 5, storage: 5, place: 1, barracks: 1 }, wood: 5000, stone: 5000, iron: 5000 },
    { where: { id: village.id } },
  );
  await BuildOrder.destroy({ where: { villageId: village.id } });

  const now = at(100000);
  await Village.update({ resourcesAt: now }, { where: { id: village.id } });
  const [order] = await VillageService.recruit(village.id, 'barracks', { spear: 3 }, { now });
  assert.equal(order.unitDurationMs, Math.round((1020 / 1.06) * 1000));

  await assert.rejects(VillageService.recruit(village.id, 'barracks', { sword: 1 }, { now }), /Forge/);

  const mid = new Date(now.getTime() + order.unitDurationMs * 2 + 10);
  let ctx = await VillageService.withVillage(village.id, async (c) => c, { now: mid });
  assert.equal(ctx.state.units.spear, 2);
  assert.equal(ctx.recruitOrders[0].done, 2);

  ctx = await VillageService.withVillage(village.id, async (c) => c, { now: order.endsAt });
  assert.equal(ctx.state.units.spear, 3);
  assert.equal(await RecruitOrder.count(), 0);
});

test('la ferme bloque le recrutement', async () => {
  const now = at(200000);
  await assert.rejects(VillageService.recruit(village.id, 'barracks', { spear: 10000 }, { now }), /(Ressources|ferme)/);
});

test('croissance des barbares : un village sans un point de croissance accumulé n’est pas lu, les autres grandissent', async () => {
  const { World } = require('../src/models');
  const world = await World.findOne({ where: { slug: 'w1' } });
  const cfg = world.getConfig();
  const barb = await Village.findOne({ where: { playerId: null } });
  const perMs = (cfg.barbarian.growthPerDay * cfg.speed) / 86400000;
  const before = barb.points;
  // Moins d'un point de croissance depuis la dernière : rien ne change.
  await barb.update({ grownAt: T0 });
  assert.equal(await VillageService.growBarbarians(world, new Date(T0.getTime() + 0.5 / perMs)), 0);
  assert.equal((await barb.reload()).points, before);
  // Une journée plus tard : il grandit.
  assert.equal(await VillageService.growBarbarians(world, new Date(T0.getTime() + 86400000)), 1);
  assert.ok((await barb.reload()).points > before);
});
