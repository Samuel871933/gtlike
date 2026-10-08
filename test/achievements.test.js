'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

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

test('places de rang : égalités contre soi, 10 % premiers du classement seulement', () => {
  const places = (entries) => Object.fromEntries(AchievementService.qualifiedPlaces(entries));
  assert.deepEqual(places([[1, 500]]), {}, 'seul inscrit : premier de rien');
  assert.deepEqual(places(Array.from({ length: 20 }, (_, i) => [i + 1, 26])), {}, 'tous à égalité au départ');
  const twenty = Array.from({ length: 20 }, (_, i) => [i + 1, 100 - i]);
  assert.deepEqual(places(twenty), { 1: 1, 2: 2 });
  assert.deepEqual(places([[1, 100], [2, 100], ...twenty.slice(2)]), { 1: 2, 2: 2 }, 'ex aequo : deuxièmes tous les deux');
});

test('le premier inscrit d\'un monde ne gagne pas les succès de rang', async () => {
  await WorldService.createWorld({ slug: 'w2', name: 'Monde 2', config: { newbieDays: 0 } });
  const u = await AuthService.register({ username: 'Carole', email: 'carole@example.com', password: 'motdepasse' });
  const { player } = await WorldService.join(u, 'w2', { now: T0 });
  await AchievementService.evaluate(player.id);
  assert.equal(await tierOf(player.id, 'topscorer'), 0);
  assert.equal(await tierOf(player.id, 'continent'), 0);
  const [world] = await sequelize.models.World.findAll({ where: { slug: 'w2' } });
  await AchievementService.evaluateWorld(world);
  assert.equal(await PlayerAchievement.count({ where: { playerId: player.id } }), 0, 'aucun succès à l\'inscription');
});

test('rang et tribu : paliers débloqués, jamais retirés', async () => {
  // Bob en tête d'un monde de 10 joueurs actifs : premier des 10 %.
  for (let i = 0; i < 8; i++) {
    const u = await AuthService.register({ username: `Joueur${i}`, email: `j${i}@example.com`, password: 'motdepasse' });
    await WorldService.join(u, 'w1', { now: T0 });
  }
  await Player.update({ points: 100000 }, { where: { id: p.Bob.id } });
  await AchievementService.evaluate(p.Bob.id);
  assert.equal(await tierOf(p.Bob.id, 'topscorer'), 0, `rien avant ${AchievementService.RANK_MIN_DAYS} jours de monde`);
  await sequelize.query('UPDATE Worlds SET createdAt = :at WHERE id = :id', {
    replacements: { at: new Date(Date.now() - (AchievementService.RANK_MIN_DAYS + 1) * 86400000), id: v.Bob.worldId },
  });
  await sequelize.models.World.update({ name: 'Monde 1' }, { where: { id: v.Bob.worldId } }); // vide le cache des mondes
  await AchievementService.evaluate(p.Bob.id);
  const before = await tierOf(p.Bob.id, 'topscorer');
  assert.equal(before, 4, 'premier d\'un monde de dix joueurs');

  await TribeService.create(p.Bob.id, { name: 'Les Ours', tag: 'OURS' });
  await Player.update({ tribeJoinedAt: new Date(Date.now() - 61 * 86400000) }, { where: { id: p.Bob.id } });
  await AchievementService.evaluate(p.Bob.id);
  assert.equal(await tierOf(p.Bob.id, 'brothers'), 2, '61 jours dans la même tribu');

  await Player.update({ points: 0 }, { where: { id: p.Bob.id } });
  await AchievementService.evaluate(p.Bob.id);
  assert.equal(await tierOf(p.Bob.id, 'topscorer'), before, 'pas de retour en arrière');

  const ranking = await AchievementService.ranking(v.Alice.worldId);
  assert.ok(ranking.length >= 2);
  assert.ok(ranking.every((r) => r.score >= r.count));
});
