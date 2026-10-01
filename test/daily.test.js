'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, DailyStat, DailyAward, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const CommandService = require('../src/services/CommandService');
const DailyService = require('../src/services/DailyService');
const AchievementService = require('../src/services/AchievementService');

const T0 = new Date('2026-09-24T12:00:00');
const p = {};
const v = {};

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  for (const name of ['Alice', 'Bob', 'Carol']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u, 'w1', { now: T0 }));
  }
});

test.after(() => sequelize.close());

test('les combats alimentent les compteurs du jour', async () => {
  const barb = await Village.findOne({ where: { playerId: null } });
  await Village.update({ wood: 1000, stone: 1000, iron: 1000, resourcesAt: T0 }, { where: { id: barb.id } });
  await Village.update({ units: { light: 20 }, buildings: { ...v.Alice.buildings, place: 1 } }, { where: { id: v.Alice.id } });
  const cmd = await CommandService.send(v.Alice.id, { x: barb.x, y: barb.y, type: 'attack', units: { light: 20 } }, { now: T0 });
  await CommandService.processDue(cmd.arrivesAt, { rng: () => 0.5 });
  const row = await DailyStat.findOne({ where: { playerId: p.Alice.id } });
  assert.equal(row.day, DailyService.dayKey(cmd.arrivesAt));
  assert.equal(row.plunders, 1);
  assert.ok(row.loot > 0);
});

test('gagnant unique uniquement, attribution une seule fois, 4 points au classement', async () => {
  const day = '2026-09-20';
  await DailyStat.bulkCreate([
    { worldId: v.Alice.worldId, playerId: p.Bob.id, day, loot: 5000, plunders: 3 },
    { worldId: v.Alice.worldId, playerId: p.Carol.id, day, loot: 4000, plunders: 3 },
  ]);
  const awarded = await DailyService.awardDay(v.Alice.worldId, day);
  assert.deepEqual(awarded.map((a) => a.def.key), ['dailyRobber'], 'égalité aux pillages : pas de pillard du jour');
  assert.equal(awarded[0].playerId, p.Bob.id);
  assert.equal((await DailyService.awardDay(v.Alice.worldId, day)).length, 0, 'déjà attribué');
  assert.ok(await Report.findOne({ where: { playerId: p.Bob.id, title: `Succès du jour : Brigand du jour (${day})` } }));

  const counts = await DailyService.countsFor(p.Bob.id);
  assert.equal(counts.find((c) => c.def.key === 'dailyRobber').count, 1);
  const bob = (await AchievementService.ranking(v.Alice.worldId)).find((r) => r.player.id === p.Bob.id);
  assert.ok(bob.score >= 4);
});

test('awardPending traite les journées terminées, pas la journée en cours', async () => {
  const now = new Date();
  await DailyStat.create({ worldId: v.Alice.worldId, playerId: p.Carol.id, day: DailyService.dayKey(now), conquests: 2 });
  await DailyStat.create({ worldId: v.Alice.worldId, playerId: p.Carol.id, day: DailyService.dayKey(new Date(now.getTime() - 86400000)), conquests: 1 });
  await DailyService.awardPending(now);
  const awards = await DailyAward.findAll({ where: { key: 'dailyConqueror' } });
  assert.deepEqual(awards.map((a) => a.day), [DailyService.dayKey(new Date(now.getTime() - 86400000))]);
});

test('record journalier : meilleure journée de chaque joueur, la première en cas d’égalité', async () => {
  const worldId = v.Alice.worldId;
  await DailyStat.bulkCreate([
    { worldId, playerId: p.Bob.id, day: '2026-09-10', unitsKilledAttacker: 80 },
    { worldId, playerId: p.Bob.id, day: '2026-09-11', unitsKilledAttacker: 120 },
    { worldId, playerId: p.Bob.id, day: '2026-09-12', unitsKilledAttacker: 120 },
    { worldId, playerId: p.Carol.id, day: '2026-09-10', unitsKilledAttacker: 90 },
  ]);
  const rows = await DailyService.records(worldId, 'att');
  assert.deepEqual(rows.map((r) => [r.player.name, r.score, r.day]), [['Bob', 120, '2026-09-11'], ['Carol', 90, '2026-09-10']]);

  const counts = await DailyService.countsFor(p.Bob.id);
  assert.equal(counts.find((c) => c.def.key === 'dailyRobber').last, '2026-09-20');
});
