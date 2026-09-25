'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, User, Village, Player, Tribe, Command, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const MessageService = require('../src/services/MessageService');
const CommandService = require('../src/services/CommandService');
const AccountService = require('../src/services/AccountService');

const T0 = new Date('2026-09-24T12:00:00Z');
const u = {};
const p = {};
const v = {};

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  await WorldService.createWorld({ slug: 'w2', name: 'Monde 2', config: {} });
  for (const name of ['Alice', 'Bob']) {
    u[name] = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u[name], 'w1', { now: T0 }));
  }
  await WorldService.join(u.Alice, 'w2', { now: T0 });
  await Village.update({ units: { axe: 50, spear: 20 }, buildings: { ...v.Alice.buildings, place: 1 } }, { where: { id: v.Alice.id } });
  await TribeService.create(p.Alice.id, { name: 'Les Loups', tag: 'LUP' });
  await TribeService.invite(p.Alice.id, 'Bob');
  const [inv] = await TribeService.invitesFor(p.Bob.id);
  await TribeService.acceptInvite(p.Bob.id, inv.id);
  await MessageService.start(p.Alice.id, { to: 'Bob', subject: 'Salut', body: 'Coucou' });
  await CommandService.send(v.Alice.id, { x: v.Bob.x, y: v.Bob.y, type: 'support', units: { spear: 10 } }, { now: T0 });
});

test.after(() => sequelize.close());

test('quitter un monde demande le mot de passe', async () => {
  await assert.rejects(AccountService.leaveWorld(u.Alice.id, p.Alice.id, 'faux'), /Mot de passe incorrect/);
});

test('quitter un monde : villages barbares, tribu transmise, ordres supprimés', async () => {
  await AccountService.leaveWorld(u.Alice.id, p.Alice.id, 'motdepasse');
  const village = await Village.findByPk(v.Alice.id);
  assert.equal(village.playerId, null);
  assert.equal(village.name, 'Village barbare');
  assert.equal(village.units.axe, 50, 'les troupes restent dans le village barbare');
  assert.equal(await Command.count({ where: { originVillageId: v.Alice.id } }), 0);
  assert.equal(await Player.count({ where: { id: p.Alice.id } }), 0);

  const bob = await Player.findByPk(p.Bob.id);
  assert.equal(bob.tribeRole, 'founder', 'la tribu passe à Bob');
  assert.equal(await Tribe.count(), 1);
  assert.equal((await MessageService.inbox(p.Bob.id)).length, 1, 'Bob garde la conversation');

  // Alice peut revenir sur ce monde avec un nouveau départ.
  const { village: fresh } = await WorldService.join(u.Alice, 'w1');
  assert.notEqual(fresh.id, v.Alice.id);
});

test('supprimer le compte : tous les mondes, puis le compte ; dernier membre = tribu dissoute', async () => {
  await AccountService.deleteAccount(u.Bob.id, 'motdepasse');
  assert.equal(await User.count({ where: { id: u.Bob.id } }), 0);
  assert.equal(await Player.count({ where: { userId: u.Bob.id } }), 0);
  assert.equal(await Tribe.count(), 0);
  assert.equal(await Report.count({ where: { playerId: p.Bob.id } }), 0);
  assert.equal((await Village.findByPk(v.Bob.id)).playerId, null);

  await AccountService.deleteAccount(u.Alice.id, 'motdepasse');
  assert.equal(await Player.count(), 0, 'Alice a quitté ses deux mondes');
});
