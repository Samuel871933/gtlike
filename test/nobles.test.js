'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Village, Player, Report, SupportStack } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const CommandService = require('../src/services/CommandService');
const NobleService = require('../src/services/NobleService');
const VillageState = require('../src/game/VillageState');
const WorldConfig = require('../src/game/WorldConfig');

const T0 = new Date('2026-09-24T12:00:00Z');
const maxLoss = { rng: () => 0.999 }; // chance maximale, perte de loyauté maximale (35)
let alice;
let bob;
let a;
let b;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  alice = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  bob = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  ({ village: a } = await WorldService.join(alice, 'w1', { now: T0 }));
  ({ village: b } = await WorldService.join(bob, 'w1', { now: T0 }));
  await Village.update({
    resourcesAt: T0, wood: 400000, stone: 400000, iron: 400000,
    buildings: { main: 20, smith: 20, market: 10, snob: 1, farm: 30, storage: 30, place: 1, barracks: 1 },
  }, { where: { id: a.id } });
});

test.after(() => sequelize.close());

test('pièces d’or : 1, 3, 6… pièces pour 1, 2, 3 nobles', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 10].map(NobleService.maxNobles), [0, 1, 1, 2, 2, 3, 4]);
});

test('loyauté : remonte de 1 par heure × vitesse, jusqu’à 100', () => {
  const s = new VillageState({ buildings: {}, units: {}, wood: 0, stone: 0, iron: 0, resourcesAt: T0, loyalty: 50 }, new WorldConfig({ speed: 2 }));
  s.accrue(new Date(T0.getTime() + 10 * 3600000));
  assert.equal(s.loyalty, 70);
  s.accrue(new Date(T0.getTime() + 100 * 3600000));
  assert.equal(s.loyalty, 100);
});

test('académie : un noble demande une pièce d’or', async () => {
  await assert.rejects(VillageService.recruit(a.id, 'snob', { snob: 1 }, { now: T0 }), /pièces d'or/);
  await NobleService.mint(a.id, 1, { now: T0 });
  const player = await Player.findByPk(a.playerId);
  assert.equal(player.coins, 1);
  await VillageService.recruit(a.id, 'snob', { snob: 1 }, { now: T0 });
  await assert.rejects(VillageService.recruit(a.id, 'snob', { snob: 1 }, { now: T0 }), /pièces d'or/);
  const slots = await NobleService.slots(a.playerId);
  assert.equal(slots.used, 1);
  assert.equal(slots.free, 0);
});

test('conquête : trois attaques avec noble font tomber la loyauté à 0, la suivante devient un soutien', async () => {
  await Player.update({ coins: 10 }, { where: { id: a.playerId } });
  await Village.update({ units: { axe: 8000, snob: 4 } }, { where: { id: a.id } });

  // Train de nobles : quatre attaques à une seconde d'écart (la loyauté n'a pas le temps de remonter).
  const start = T0.getTime() + 86400000;
  let last;
  for (let i = 0; i < 4; i++) {
    last = await CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { axe: 2000, snob: 1 } }, { now: new Date(start + i * 1000) });
  }
  await CommandService.processDue(last.arrivesAt, maxLoss);

  const conquered = await Village.findByPk(b.id);
  assert.equal(conquered.playerId, a.playerId);
  assert.equal(conquered.loyalty, 25);
  const reports = await Report.findAll({ where: { playerId: a.playerId }, order: [['id', 'ASC']] });
  const conquest = reports.find((r) => r.data.conquered);
  assert.match(conquest.title, /a conquis/);
  assert.match(reports[reports.length - 1].title, /soutien est arrivé/);

  const stack = await SupportStack.findOne({ where: { villageId: b.id, originVillageId: a.id } });
  assert.ok(stack.units.axe > 1900, 'les haches restent dans le village conquis');
  assert.equal(stack.units.snob, 1, 'le noble de la conquête est consommé, celui de la 4e attaque arrive en soutien');
  assert.ok(stack.units.axe > 3900, 'la 4e attaque ne combat pas ses propres troupes');

  assert.equal((await Player.findByPk(a.playerId)).villageCount, 2);
  assert.equal((await Player.findByPk(b.playerId)).villageCount, 0);
  const slots = await NobleService.slots(a.playerId);
  assert.equal(slots.conquered, 1);
});

test('le joueur qui a tout perdu peut recommencer', async () => {
  const { village } = await WorldService.join(bob, 'w1', { now: T0 });
  assert.notEqual(village.id, b.id);
  assert.equal((await Player.findByPk(village.playerId)).villageCount, 1);
});

test('portée des nobles limitée', async () => {
  const world = await World.findOne({ where: { slug: 'w1' } });
  await WorldService.createVillage(world, { x: 900, y: 900, player: null, name: 'Village barbare', buildings: { main: 1 }, now: T0 });
  await Village.update({ units: { axe: 10, snob: 1 } }, { where: { id: a.id } });
  await assert.rejects(
    CommandService.send(a.id, { x: 900, y: 900, type: 'attack', units: { axe: 10, snob: 1 } }),
    /plus de 70 cases/,
  );
});
