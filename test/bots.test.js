'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const { Op } = require('sequelize');
const assert = require('node:assert/strict');
const { sequelize, Player, Bot, Village, Report, User, Command } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const CommandService = require('../src/services/CommandService');
const BotService = require('../src/services/BotService');
const SitterService = require('../src/services/SitterService');
const TribeService = require('../src/services/TribeService');
const MessageService = require('../src/services/MessageService');
const brain = require('../src/game/botBrain');

const T0 = new Date('2026-09-24T12:00:00');
let world;

test.before(async () => {
  await sequelize.sync({ force: true });
  world = await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { speed: 100, newbieDays: 0, placement: { emptyVillages: 400 }, bots: { count: 3 } } });
});

test.after(() => sequelize.close());

test('le monde garde le nombre de bots demandé, sans compte utilisateur', async () => {
  const created = await BotService.ensureBots(world, { now: T0 });
  assert.equal(created.length, 3);
  assert.equal((await BotService.ensureBots(world, { now: T0 })).length, 0, 'déjà complet');
  const bots = await Player.findAll({ where: { isBot: true } });
  assert.equal(bots.length, 3);
  assert.ok(bots.every((p) => p.userId === null && p.villageCount === 1));
  assert.equal(new Set(bots.map((p) => p.name)).size, 3, 'noms distincts');
  assert.equal(await User.count(), 0, 'aucun compte créé');
  // Les joueurs du monde (liste des serveurs) ne comptent pas les bots.
  assert.equal((await WorldService.playerCounts([world.id])).get(world.id), undefined);
});

test('un bot se développe et pille les barbares proches', async () => {
  const bot = await Bot.findOne();
  const player = await Player.findByPk(bot.playerId);
  const [village] = await Village.findAll({ where: { playerId: player.id } });
  const startPoints = village.points;
  // Une journée de jeu à vitesse 100 : réveils successifs, combats résolus au fil du temps.
  let now = T0;
  const end = new Date(T0.getTime() + 86400000);
  while (now < end) {
    await bot.reload();
    now = new Date(Math.max(now.getTime() + 60000, new Date(bot.nextActionAt).getTime()));
    await BotService.wake(bot, { now });
    await CommandService.processDue(now);
  }
  await village.reload();
  assert.ok(village.points > startPoints * 5, `points : ${startPoints} → ${village.points}`);
  assert.ok(village.buildings.barracks >= 1, 'caserne construite');
  const raids = await Report.count({ where: { playerId: player.id, type: 'attack' } });
  assert.ok(raids > 20, `pillages lancés : ${raids}`);
  assert.equal(await Report.count({ where: { playerId: player.id, happenedAt: { [Op.lt]: new Date(now - 86400000 - 60000) } } }), 0, 'vieux rapports supprimés');
});

test('un bot qui a perdu tous ses villages recommence', async () => {
  const bot = await Bot.findOne({ order: [['id', 'DESC']] });
  await Village.update({ playerId: null }, { where: { playerId: bot.playerId } });
  await BotService.wake(bot, { now: T0 });
  assert.equal(await Village.count({ where: { playerId: bot.playerId } }), 1);
});

test('on ne peut pas inviter un bot, le prendre comme remplaçant ni lui écrire', async () => {
  const user = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  const { player } = await WorldService.join(user, 'w1', { now: T0 });
  const bot = await Player.findOne({ where: { isBot: true } });
  await assert.rejects(SitterService.invite(player.id, bot.name), /bot/);
  await assert.rejects(MessageService.start(player.id, { to: bot.name, subject: 'Salut', body: 'Bonjour' }), /bots ne lisent pas/);
  await TribeService.create(player.id, { name: 'Les Alliés', tag: 'ALL' });
  await assert.rejects(TribeService.invite(player.id, bot.name), /bots ne rejoignent pas/);
  assert.equal((await WorldService.playerCounts([world.id])).get(world.id), 1, 'seule Alice compte comme joueuse');
});

test('cerveau : ferme et entrepôt d’abord quand ils bloquent, sinon le plan', () => {
  const level = (levels) => (id) => levels[id] || 0;
  assert.equal(brain.nextBuilding({ level: level({ main: 1 }), popRatio: 0.5, storageRatio: 0.2 }), 'wood');
  assert.equal(brain.nextBuilding({ level: level({ main: 1 }), popRatio: 0.9, storageRatio: 0.2 }), 'farm');
  assert.equal(brain.nextBuilding({ level: level({ main: 1 }), popRatio: 0.5, storageRatio: 0.95 }), 'storage');
  assert.deepEqual(brain.raidWaves({ light: 12, axe: 100 }, 8), [{ light: 5 }, { light: 5 }]);
  assert.deepEqual(brain.raidWaves({ spear: 40 }, 8), [{ spear: 15 }], 'la moitié des lanciers reste au village');
  // Plan : prérequis respectés (chaque bâtiment est demandé après ceux dont il dépend).
  const registry = require('../src/game/registry');
  const reached = {};
  for (const [id, l] of brain.PLAN) {
    for (const [req, rl] of Object.entries(registry.building(id).requires)) assert.ok((reached[req] || 1) >= rl, `${id} ${l} demande ${req} ${rl}`);
    reached[id] = Math.max(reached[id] || 0, l);
  }
});

test('difficulté : un bot normal attaque un joueur proche avec son armée, un bot paisible jamais', async () => {
  const w = await WorldService.createWorld({ slug: 'w2', name: 'Monde 2', config: { newbieDays: 0, placement: { emptyVillages: 0 }, bots: { count: 1, difficulty: 'normal' } } });
  const user = await AuthService.register({ username: 'Gaston', email: 'g@example.com', password: 'motdepasse' });
  const { village: target } = await WorldService.join(user, 'w2', { now: T0 });
  const [bot] = await BotService.ensureBots(w, { now: T0 });
  const home = await Village.findOne({ where: { playerId: bot.playerId } });
  await home.update({ x: target.x + 3, y: target.y, units: { axe: 400, light: 20 }, buildings: { ...home.buildings, place: 1 } });
  await BotService.wake(bot, { now: T0 });
  const strike = await Command.findOne({ where: { originVillageId: home.id, targetVillageId: target.id, type: 'attack' } });
  assert.ok(strike, 'attaque lancée');
  assert.equal(strike.units.axe, 400, 'toute l’armée offensive');
  // Pas de nouvelle attaque avant le délai du profil.
  await home.update({ units: { axe: 400 } });
  await bot.update({ nextActionAt: T0 });
  await BotService.wake(bot, { now: new Date(T0.getTime() + 60000) });
  assert.equal(await Command.count({ where: { originVillageId: home.id, targetVillageId: target.id } }), 1);

  const calm = await WorldService.createWorld({ slug: 'w3', name: 'Monde 3', config: { newbieDays: 0, placement: { emptyVillages: 0 }, bots: { count: 1, difficulty: 'peaceful' } } });
  const { village: t3 } = await WorldService.join(user, 'w3', { now: T0 });
  const [peaceful] = await BotService.ensureBots(calm, { now: T0 });
  const h3 = await Village.findOne({ where: { playerId: peaceful.playerId } });
  await h3.update({ x: t3.x + 3, y: t3.y, units: { axe: 400 } });
  await BotService.wake(peaceful, { now: T0 });
  assert.equal(await Command.count({ where: { originVillageId: h3.id } }), 0);
});

test('difficulté : la protection des débutants s’applique aux bots', async () => {
  const w = await WorldService.createWorld({ slug: 'w4', name: 'Monde 4', config: { newbieDays: 5, placement: { emptyVillages: 0 }, bots: { count: 1, difficulty: 'aggressive' } } });
  const user = await AuthService.register({ username: 'Hector', email: 'h@example.com', password: 'motdepasse' });
  const { village: target } = await WorldService.join(user, 'w4', { now: T0 });
  const [bot] = await BotService.ensureBots(w, { now: T0 });
  const home = await Village.findOne({ where: { playerId: bot.playerId } });
  await home.update({ x: target.x + 3, y: target.y, units: { axe: 400 } });
  await BotService.wake(bot, { now: T0 });
  assert.equal(await Command.count({ where: { originVillageId: home.id } }), 0);
});

test('conquête : les nobles partent escortés vers un village barbare et le prennent', async () => {
  const w = await WorldService.createWorld({ slug: 'w5', name: 'Monde 5', config: { newbieDays: 0, luck: 0, placement: { emptyVillages: 0 }, bots: { count: 1, difficulty: 'normal' } } });
  const [bot] = await BotService.ensureBots(w, { now: T0 });
  const home = await Village.findOne({ where: { playerId: bot.playerId } });
  const barb = await WorldService.createVillage(w, { x: home.x + 4, y: home.y, player: null, name: 'Village barbare', buildings: { main: 10, farm: 10, storage: 10, wood: 10, stone: 10, iron: 10 }, now: T0 });
  await barb.update({ loyalty: 5 });
  await home.update({ units: { snob: 1, axe: 300 } });
  await BotService.wake(bot, { now: T0 });
  const wave = (await Command.findAll({ where: { originVillageId: home.id, targetVillageId: barb.id } })).find((c) => c.units.snob);
  assert.ok(wave, 'noble envoyé');
  assert.deepEqual(wave.units, { snob: 1, axe: 100 });
  await CommandService.processDue(new Date(wave.arrivesAt));
  await barb.reload();
  assert.equal(barb.playerId, bot.playerId, 'village conquis');
});
