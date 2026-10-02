'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, Command, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const AccountService = require('../src/services/AccountService');
const CommandService = require('../src/services/CommandService');

const H = 3600000;
const T0 = new Date('2026-09-24T12:00:00Z');
const p = {};
const v = {};

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({
    slug: 'w1', name: 'Monde 1',
    config: { newbieDays: 0, sleep: { active: true, delayMinutes: 60, minHours: 6, maxHours: 10, minAwakeHours: 12 } },
  });
  for (const name of ['Alice', 'Bob']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u, 'w1', { now: T0 }));
    await v[name].update({ units: { axe: 100 }, buildings: { ...v[name].buildings, place: 1 } });
  }
});

test.after(() => sequelize.close());

test('programmation : délai, durée bornée, éveil minimal', async () => {
  await assert.rejects(AccountService.startSleep(p.Bob.id, 3, { now: T0 }), /entre 6 et 10/);
  const bob = await AccountService.startSleep(p.Bob.id, 8, { now: T0 });
  assert.equal(+bob.sleepStartsAt, T0.getTime() + H);
  assert.equal(+bob.sleepEndsAt, T0.getTime() + 9 * H);
  await assert.rejects(AccountService.startSleep(p.Bob.id, 8, { now: T0 }), /déjà programmé/);
  assert.equal(bob.isAsleep(new Date(T0.getTime() + 30 * 60000)), false, 'pas encore endormi pendant le délai');
  assert.equal(bob.isAsleep(new Date(T0.getTime() + 2 * H)), true);
});

test('une attaque arrivant pendant le sommeil devient une visite', async () => {
  const now = new Date(T0.getTime() + 2 * H);
  const cmd = await CommandService.send(v.Alice.id, { x: v.Bob.x, y: v.Bob.y, type: 'attack', units: { axe: 100 } }, { now });
  await CommandService.processDue(cmd.arrivesAt);
  const ret = await Command.findOne({ where: { type: 'return' } });
  assert.deepEqual(ret.units, { axe: 100 }, 'aucune perte');
  const reports = await Report.findAll({ where: { type: ['attack', 'defense'] } });
  assert.equal(reports.length, 2);
  assert.ok(reports.every((r) => r.data.visit && /rendu visite/.test(r.title)));
  await CommandService.processDue(ret.arrivesAt);
});

test('un joueur endormi ne peut pas attaquer ; réveil anticipé puis éveil minimal', async () => {
  const asleep = new Date(T0.getTime() + 3 * H);
  await assert.rejects(
    CommandService.send(v.Bob.id, { x: v.Alice.x, y: v.Alice.y, type: 'attack', units: { axe: 1 } }, { now: asleep }),
    /mode sommeil/,
  );
  await AccountService.stopSleep(p.Bob.id, { now: asleep });
  const bob = await Player.findByPk(p.Bob.id);
  assert.equal(bob.isAsleep(new Date(asleep.getTime() + 1000)), false);
  await assert.rejects(AccountService.startSleep(p.Bob.id, 6, { now: new Date(asleep.getTime() + H) }), /éveillé/);
  await AccountService.startSleep(p.Bob.id, 6, { now: new Date(asleep.getTime() + 12 * H) });
});
