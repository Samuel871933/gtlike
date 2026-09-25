'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, PlayerAchievement, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const CommandService = require('../src/services/CommandService');
const TribeService = require('../src/services/TribeService');
const AchievementService = require('../src/services/AchievementService');

const T0 = new Date('2026-09-24T12:00:00Z');
const p = {};
const v = {};
const tierOf = async (playerId, key) => (await PlayerAchievement.findOne({ where: { playerId, key } }))?.tier || 0;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  for (const name of ['Alice', 'Bob']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u, 'w1', { now: T0 }));
  }
});

test.after(() => sequelize.close());

test('paliers : seuils normaux et seuils de rang', () => {
  const def = { tiers: [10, 100, 1000, 10000] };
  assert.deepEqual([0, 10, 999, 20000].map((x) => AchievementService.tierFor(def, x)), [0, 1, 2, 4]);
  const rank = { rank: true, tiers: [1000, 100, 20, 1] };
  assert.deepEqual([5000, 500, 20, 1, null].map((x) => AchievementService.tierFor(rank, x)), [0, 1, 3, 4, 0]);
});

test('un pillage débloque « Brigand » et prévient le joueur', async () => {
  const barb = await Village.findOne({ where: { playerId: null } });
  await Village.update({ wood: 1000, stone: 1000, iron: 1000, resourcesAt: T0 }, { where: { id: barb.id } });
  await Village.update({ units: { light: 20 }, buildings: { ...v.Alice.buildings, place: 1 } }, { where: { id: v.Alice.id } });
  const cmd = await CommandService.send(v.Alice.id, { x: barb.x, y: barb.y, type: 'attack', units: { light: 20 } }, { now: T0 });
  await CommandService.processDue(cmd.arrivesAt, { rng: () => 0.5 });
  const alice = await Player.findByPk(p.Alice.id);
  assert.ok(alice.stats.lootTotal >= 500);
  assert.equal(alice.stats.plunders, 1);
  assert.equal(await tierOf(alice.id, 'robber'), 1);
  assert.ok(await Report.findOne({ where: { playerId: alice.id, type: 'award', title: 'Succès débloqué : Brigand (bois)' } }));
});

test('rang et tribu : paliers débloqués, jamais retirés', async () => {
  await AchievementService.evaluate(p.Bob.id);
  const before = await tierOf(p.Bob.id, 'topscorer');
  assert.ok(before >= 3, 'dans un monde de deux joueurs, on est dans le top 20');

  await TribeService.create(p.Bob.id, { name: 'Les Ours', tag: 'OURS' });
  await Player.update({ tribeJoinedAt: new Date(Date.now() - 61 * 86400000) }, { where: { id: p.Bob.id } });
  await AchievementService.evaluate(p.Bob.id);
  assert.equal(await tierOf(p.Bob.id, 'brothers'), 2, '61 jours dans la même tribu');

  await Player.update({ points: 0 }, { where: { id: p.Bob.id } });
  await AchievementService.evaluate(p.Bob.id);
  assert.equal(await tierOf(p.Bob.id, 'topscorer'), before, 'pas de retour en arrière');

  const ranking = await AchievementService.ranking(v.Alice.worldId);
  assert.equal(ranking.length, 2);
  assert.ok(ranking.every((r) => r.score >= r.count));
});
