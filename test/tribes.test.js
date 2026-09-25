'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Village, Player, Tribe, TribeInvite } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const CommandService = require('../src/services/CommandService');

const T0 = new Date('2026-09-24T12:00:00Z');
const players = {};
const villages = {};
let tribe;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0, tribe: { memberLimit: 2 } } });
  for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    const { player, village } = await WorldService.join(u, 'w1', { now: T0 });
    players[name] = player;
    villages[name] = village;
    await village.update({ units: { axe: 10, spear: 10 }, buildings: { ...village.buildings, place: 1 } });
  }
});

test.after(() => sequelize.close());

const reload = async (name) => (players[name] = await Player.findByPk(players[name].id));

test('fonder une tribu : nom et tag uniques', async () => {
  tribe = await TribeService.create(players.Alice.id, { name: 'Les Loups', tag: 'LUP' });
  assert.equal((await reload('Alice')).tribeRole, 'founder');
  await assert.rejects(TribeService.create(players.Bob.id, { name: 'Autre', tag: 'LUP' }), /tag est déjà pris/);
  await assert.rejects(TribeService.create(players.Alice.id, { name: 'Encore', tag: 'ENC' }), /déjà dans une tribu/);
  await assert.rejects(TribeService.create(players.Bob.id, { name: 'Okay', tag: 'TROPLONG' }), /tag/);
});

test('invitations : réservées aux chefs, limite de membres', async () => {
  await TribeService.invite(players.Alice.id, 'Bob');
  await assert.rejects(TribeService.invite(players.Alice.id, 'Bob'), /déjà invité/);
  const [inv] = await TribeService.invitesFor(players.Bob.id);
  await TribeService.acceptInvite(players.Bob.id, inv.id);
  assert.equal((await reload('Bob')).tribeId, tribe.id);
  assert.equal(players.Bob.tribeRole, 'member');

  await assert.rejects(TribeService.invite(players.Bob.id, 'Carol'), /chefs/);
  await TribeService.invite(players.Alice.id, 'Carol');
  const [invC] = await TribeService.invitesFor(players.Carol.id);
  await assert.rejects(TribeService.acceptInvite(players.Carol.id, invC.id), /complète/);
  await TribeService.declineInvite(players.Carol.id, invC.id);
  assert.equal(await TribeInvite.count(), 0);
});

test('pas d’attaque entre membres ; soutien réservé à la tribu si le monde l’exige', async () => {
  await assert.rejects(
    CommandService.send(villages.Alice.id, { x: villages.Bob.x, y: villages.Bob.y, type: 'attack', units: { axe: 1 } }),
    /membre de votre tribu/,
  );
  const world = await World.findOne({ where: { slug: 'w1' } });
  await world.update({ config: { ...world.config, tribe: { memberLimit: 2, supportOnlyTribe: true } } });
  await CommandService.send(villages.Alice.id, { x: villages.Bob.x, y: villages.Bob.y, type: 'support', units: { spear: 1 } });
  await assert.rejects(
    CommandService.send(villages.Alice.id, { x: villages.Carol.x, y: villages.Carol.y, type: 'support', units: { spear: 1 } }),
    /réservé à votre tribu/,
  );

  // Carol fonde une tribu, Alice la déclare alliée : le soutien devient possible.
  await TribeService.create(players.Carol.id, { name: 'Les Ours', tag: 'OURS' });
  await TribeService.setRelation(players.Alice.id, 'OURS', 'ally');
  await CommandService.send(villages.Alice.id, { x: villages.Carol.x, y: villages.Carol.y, type: 'support', units: { spear: 1 } });
  assert.equal((await TribeService.relationsOf(tribe.id)).get((await reload('Carol')).tribeId), 'ally');
});

test('rôles : le fondateur promeut, passe la main ; exclusion selon le rang', async () => {
  await assert.rejects(TribeService.kick(players.Bob.id, players.Alice.id), /chefs/);
  await TribeService.setRole(players.Alice.id, players.Bob.id, 'leader');
  await assert.rejects(TribeService.kick(players.Bob.id, players.Alice.id), /ne pouvez pas exclure/);
  await assert.rejects(TribeService.leave(players.Alice.id), /autre fondateur/);

  await TribeService.setRole(players.Alice.id, players.Bob.id, 'founder');
  assert.equal((await reload('Alice')).tribeRole, 'leader');
  assert.equal((await reload('Bob')).tribeRole, 'founder');
  await TribeService.kick(players.Bob.id, players.Alice.id);
  assert.equal((await reload('Alice')).tribeId, null);
});

test('mur, classement, dissolution quand le dernier membre part', async () => {
  const msg = await TribeService.post(players.Bob.id, 'Rendez-vous à 20h');
  await assert.rejects(TribeService.deleteMessage(players.Alice.id, msg.id), /introuvable/);

  const ranking = await TribeService.ranking(villages.Alice.worldId);
  assert.equal(ranking.length, 2);
  assert.ok(ranking.every((r) => r.members === 1));

  await TribeService.leave(players.Bob.id);
  assert.equal(await Tribe.count({ where: { id: tribe.id } }), 0, 'tribu dissoute');
});
