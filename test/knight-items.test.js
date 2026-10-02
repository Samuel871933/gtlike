'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const KnightService = require('../src/services/KnightService');
const CommandService = require('../src/services/CommandService');
const combat = require('../src/game/combat');

const DAY = 86400000;
const T0 = new Date('2026-09-24T12:00:00Z');
const p = {};
const v = {};

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0, moral: false, features: { knight: true } } });
  for (const name of ['Alice', 'Bob']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u, 'w1', { now: T0 }));
  }
});

test.after(() => sequelize.close());

test('bonus d’armes : +30 % en attaque, +20 % en défense, une même arme compte une fois', () => {
  const base = combat.resolve({ attackers: { axe: 100 }, defenders: { sword: 10 } });
  const axe = combat.resolve({ attackers: { axe: 100 }, defenders: { sword: 10 }, attackerItems: ['waraxe'] });
  assert.ok(Math.abs(axe.attackStrength - base.attackStrength * 1.3) < 1e-9);
  const def = combat.resolve({ attackers: { axe: 100 }, defenders: { sword: 10 }, defenderItems: ['longsword', 'longsword'] });
  assert.ok(Math.abs((def.defenseStrength - (20 * 1.037 ** 0)) - 500 * 1.2) < 1e-6);
  const rams = combat.resolve({ attackers: { axe: 5000, ram: 20 }, defenders: {}, wall: 20 });
  const star = combat.resolve({ attackers: { axe: 5000, ram: 20 }, defenders: {}, wall: 20, attackerItems: ['morningstar'] });
  assert.ok(star.wallAfter < rams.wallAfter, 'étoile du matin : béliers plus efficaces');
});

test('jauge : 3 %/jour depuis la statue, armes seulement après un premier paladin, excédent conservé', async () => {
  let alice = await Player.findByPk(p.Alice.id);
  await KnightService.startClock(alice.id, T0);
  alice = await Player.findByPk(p.Alice.id);
  assert.deepEqual(await KnightService.sync(alice, { now: new Date(T0.getTime() + 40 * DAY) }), [], 'pas de paladin recruté');
  assert.equal(Math.round(alice.knightProgress), 120);

  await alice.update({ knightRecruited: true });
  const found = await KnightService.sync(alice, { now: new Date(T0.getTime() + 40 * DAY), rng: () => 0 });
  assert.equal(found.length, 1);
  assert.equal(alice.knightItem, found[0].id, 'la première arme est équipée d’office');
  assert.equal(Math.round(alice.knightProgress), 20);

  await KnightService.addKills(alice.id, 8000, { hasFeature: () => true, knightSystem: 'items', knightItems: { active: true, killPointsPerPercent: 100 } });
  await alice.reload();
  assert.equal(Math.round(alice.knightProgress), 100, '8 000 points d’adversaires = +80 %');
});

test('sceptre de Vasco : la loyauté baisse d’au moins 30', async () => {
  await Player.update({ knightItems: ['scepter'], knightItem: 'scepter', coins: 10 }, { where: { id: p.Alice.id } });
  await Village.update({ units: { axe: 3000, snob: 1, knight: 1 }, buildings: { main: 1, farm: 30, storage: 1, place: 1 } }, { where: { id: v.Alice.id } });
  const cmd = await CommandService.send(v.Alice.id, { x: v.Bob.x, y: v.Bob.y, type: 'attack', units: { axe: 3000, snob: 1, knight: 1 } }, { now: T0 });
  await CommandService.processDue(cmd.arrivesAt, { rng: () => 0 }); // tirage minimal : 20 sans le sceptre
  const report = await Report.findOne({ where: { playerId: p.Alice.id, type: 'attack' } });
  assert.equal(report.data.loyalty.before - report.data.loyalty.after, 30);
  assert.equal(report.data.attackerItem, 'Sceptre de Vasco');
});
