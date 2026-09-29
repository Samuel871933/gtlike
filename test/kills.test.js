'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, SupportStack } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const CommandService = require('../src/services/CommandService');
const MapService = require('../src/services/MapService');
const combat = require('../src/game/combat');

const T0 = new Date('2026-09-24T12:00:00Z');
const p = {};
const v = {};
const noLuck = { rng: () => 0.5 };

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0, moral: false } });
  for (const name of ['Alice', 'Bob', 'Carol']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u, 'w1', { now: T0 }));
  }
  await Village.update({ units: { axe: 1000 }, buildings: { main: 1, farm: 30, storage: 1, place: 1 } }, { where: { id: v.Alice.id } });
  await Village.update({ units: { spear: 100 } }, { where: { id: v.Bob.id } });
  // Carol soutient Bob avec autant de lanciers : elle partage les points de défense.
  await SupportStack.create({ villageId: v.Bob.id, originVillageId: v.Carol.id, units: { spear: 100 } });
});

test.after(() => sequelize.close());

test('points des unités (wiki) : lancier 4 / 1, cavalerie légère 5 / 13, noble 200 / 200', () => {
  assert.equal(combat.killPoints({ spear: 10 }, 'att'), 40);
  assert.equal(combat.killPoints({ spear: 10 }, 'def'), 10);
  assert.equal(combat.killPoints({ light: 1, snob: 1 }, 'def'), 213);
});

test('ODA pour l’attaquant, ODD pour le défenseur, ODS pour le soutien au prorata', async () => {
  const cmd = await CommandService.send(v.Alice.id, { x: v.Bob.x, y: v.Bob.y, type: 'attack', units: { axe: 1000 } }, { now: T0 });
  await CommandService.processDue(cmd.arrivesAt, noLuck);
  const [alice, bob, carol] = await Promise.all(['Alice', 'Bob', 'Carol'].map((n) => Player.findByPk(p[n].id)));

  assert.equal(alice.killsAttacker, 200 * 4, 'les 200 lanciers (village + soutien) tués');
  const ret = await (require('../src/models').Command).findOne({ where: { type: 'return' } });
  const axesLost = 1000 - ret.units.axe;
  assert.ok(axesLost > 0);
  assert.equal(bob.killsDefender + carol.killsSupporter, axesLost * 4);
  assert.ok(Math.abs(bob.killsDefender - carol.killsSupporter) <= 1, 'moitié-moitié');
  assert.equal(bob.killsSupporter, 0);

  const ranking = await MapService.killRanking(v.Alice.worldId, 'all');
  assert.equal(ranking[0].player.name, 'Alice');
  const sup = await MapService.killRanking(v.Alice.worldId, 'sup');
  assert.deepEqual(sup.map((r) => r.player.name), ['Carol']);

  // Par tribu : somme des membres (Bob et Carol dans la même tribu).
  const TribeService = require('../src/services/TribeService');
  const tribe = await TribeService.create(p.Bob.id, { name: 'Les Remparts', tag: 'REMP' });
  await Player.update({ tribeId: tribe.id, tribeRole: 'member' }, { where: { id: p.Carol.id } });
  const [row] = await MapService.tribeKillRanking(v.Alice.worldId, 'all');
  assert.equal(row.tribe.tag, 'REMP');
  assert.equal(row.members, 2);
  assert.equal(row.score, bob.killsDefender + carol.killsSupporter);
  assert.deepEqual((await MapService.tribeKillRanking(v.Alice.worldId, 'att')), [], 'aucune attaque de la tribu');
});

test('classement par continent : points des villages situés dans le continent', async () => {
  const MapServiceC = require('../src/services/MapService');
  const k = `K${Math.floor(v.Alice.y / 100)}${Math.floor(v.Alice.x / 100)}`;
  const rows = await MapServiceC.continentRanking(v.Alice.worldId, k);
  const alice = rows.find((r) => r.player.name === 'Alice');
  assert.equal(alice.points, (await Village.findByPk(v.Alice.id)).points);
  assert.deepEqual(MapServiceC.continentBounds('K54'), { x: [400, 499], y: [500, 599] });
  assert.equal(MapServiceC.continentBounds('K5'), null);
  assert.ok((await MapServiceC.continents(v.Alice.worldId)).includes(k));
});
