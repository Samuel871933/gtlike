'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const CommandService = require('../src/services/CommandService');
const WorldConfig = require('../src/game/WorldConfig');
const { travelSeconds } = require('../src/game/movement');

const T0 = new Date('2026-09-24T12:00:00Z');
const v = {};

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0, features: { knight: true } } });
  for (const name of ['Alice', 'Bob']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ village: v[name] } = await WorldService.join(u, 'w1', { now: T0 }));
  }
  await Village.update({
    resourcesAt: T0, wood: 5000, stone: 5000, iron: 5000,
    buildings: { main: 5, farm: 10, storage: 10, place: 1, barracks: 1, smith: 1, statue: 1 },
  }, { where: { id: v.Alice.id } });
});

test.after(() => sequelize.close());

test('un seul paladin par joueur, même en formation', async () => {
  await assert.rejects(VillageService.recruit(v.Alice.id, 'statue', { knight: 2 }, { now: T0 }), /qu’un seul paladin/);
  const [order] = await VillageService.recruit(v.Alice.id, 'statue', { knight: 1 }, { now: T0 });
  await assert.rejects(VillageService.recruit(v.Alice.id, 'statue', { knight: 1 }, { now: T0 }), /qu’un seul paladin/);
  const ctx = await VillageService.withVillage(v.Alice.id, async (c) => c, { now: order.endsAt });
  assert.equal(ctx.state.units.knight, 1);
});

test('vitesse : un soutien avec le paladin avance à sa vitesse, pas une attaque', () => {
  const world = new WorldConfig({});
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };
  const units = { sword: 100, knight: 1 };
  assert.equal(travelSeconds(units, from, to, world, { withKnightSpeed: true }), 10 * 10 * 60);
  assert.equal(travelSeconds(units, from, to, world), 10 * 22 * 60, 'attaque : vitesse de l’épée');
  assert.equal(travelSeconds({ sword: 1 }, from, to, world, { withKnightSpeed: true }), 10 * 22 * 60);
});

test('envoi réel d’un soutien accompagné du paladin', async () => {
  const now = new Date(T0.getTime() + 86400000);
  await Village.update({ units: { sword: 50, knight: 1 } }, { where: { id: v.Alice.id } });
  const cmd = await CommandService.send(v.Alice.id, { x: v.Bob.x, y: v.Bob.y, type: 'support', units: { sword: 50, knight: 1 } }, { now });
  const expected = travelSeconds({ knight: 1 }, v.Alice, v.Bob, new WorldConfig({}));
  assert.equal(+cmd.arrivesAt - +now, expected * 1000);
});
