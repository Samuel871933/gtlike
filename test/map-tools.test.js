'use strict';

// Outils de la maquette GTLike : rapports non lus par catégorie, recherche de la carte, modèles d'armée,
// favoris et réinitialisation du mot de passe.

process.env.SQLITE_STORAGE = ':memory:';
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Report, MapFavorite, ArmyTemplate, PasswordReset, User } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const ReportService = require('../src/services/ReportService');
const MapService = require('../src/services/MapService');
const ArmyTemplateService = require('../src/services/ArmyTemplateService');
const FavoriteService = require('../src/services/FavoriteService');
const AccountService = require('../src/services/AccountService');
const Mailer = require('../src/services/Mailer');

const u = {};
const p = {};
const v = {};
let world;

test.before(async () => {
  await sequelize.sync({ force: true });
  world = await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  for (const name of ['Alice', 'Bob']) {
    u[name] = await AuthService.register({ username: name, email: `${name.toLowerCase()}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u[name], 'w1'));
  }
  await TribeService.create(p.Bob.id, { name: 'Les Loups', tag: 'LUP' });
});

test.after(() => sequelize.close());

test('rapports non lus par catégorie', async () => {
  const at = new Date();
  await Report.bulkCreate([
    { playerId: p.Alice.id, type: 'attack', title: 'a', data: {}, happenedAt: at },
    { playerId: p.Alice.id, type: 'attack', title: 'b', data: {}, happenedAt: at },
    { playerId: p.Alice.id, type: 'trade', title: 'c', data: {}, happenedAt: at },
    { playerId: p.Alice.id, type: 'defense', title: 'd', data: {}, happenedAt: at, isRead: true },
  ]);
  const n = await ReportService.unreadByFilter(p.Alice.id);
  assert.equal(n.all, 3);
  assert.equal(n.attack, 2);
  assert.equal(n.trade, 1);
  assert.equal(n.defense, 0);
});

test('recherche de la carte : joueur, village, tribu (sans tenir compte de la casse)', async () => {
  const players = await MapService.search(world.id, 'player', 'ALI');
  assert.deepEqual(players.map((r) => r.label), ['Alice']);
  assert.equal(players[0].x, v.Alice.x);
  const villages = await MapService.search(world.id, 'village', 'bob');
  assert.ok(villages.some((r) => r.villageId === v.Bob.id));
  const tribes = await MapService.search(world.id, 'tribe', 'lup');
  assert.equal(tribes[0].label, '[LUP] Les Loups');
  assert.equal(tribes[0].x, v.Bob.x, 'la tribu est centrée sur le village de son membre');
  assert.deepEqual(await MapService.search(world.id, 'player', 'a'), [], 'au moins deux caractères');
});

test("modèles d'armée : unités du monde uniquement, suppression par le propriétaire", async () => {
  const cfg = world.getConfig();
  const tpl = await ArmyTemplateService.create(p.Alice.id, { name: ' Pilleurs ', axe: '20', light: '5', inconnue: '9', spear: '0' }, cfg);
  assert.equal(tpl.name, 'Pilleurs');
  assert.deepEqual(tpl.units, { axe: 20, light: 5 });
  await assert.rejects(ArmyTemplateService.create(p.Alice.id, { name: 'Vide' }, cfg), /au moins une unité/);
  await assert.rejects(ArmyTemplateService.remove(p.Bob.id, tpl.id), /introuvable/);
  await ArmyTemplateService.remove(p.Alice.id, tpl.id);
  assert.equal(await ArmyTemplate.count(), 0);
});

test('favoris : ajout puis retrait du même village', async () => {
  assert.equal(await FavoriteService.toggle(p.Alice.id, world.id, v.Bob.id), true);
  assert.equal((await FavoriteService.list(p.Alice.id))[0].Village.id, v.Bob.id);
  assert.equal(await FavoriteService.toggle(p.Alice.id, world.id, v.Bob.id), false);
  assert.equal(await MapFavorite.count(), 0);
  await assert.rejects(FavoriteService.toggle(p.Alice.id, world.id, 999999), /introuvable/);
});

test('mot de passe oublié : lien unique, valable une heure, sans révéler les comptes', async () => {
  const now = new Date('2026-09-25T10:00:00Z');
  await AuthService.requestPasswordReset('inconnu@example.com', 'http://jeu', now);
  assert.equal(Mailer.outbox().length, 0, 'aucun e-mail pour une adresse inconnue');

  await AuthService.requestPasswordReset('ALICE@example.com', 'http://jeu', now);
  const mail = Mailer.outbox().at(-1);
  assert.equal(mail.to, 'alice@example.com');
  const token = /reset\/([a-f0-9]{64})/.exec(mail.text)[1];
  assert.equal((await PasswordReset.findOne()).tokenHash.length, 64);
  assert.notEqual((await PasswordReset.findOne()).tokenHash, token, 'seul le haché est stocké');

  assert.equal(await AuthService.findReset(token, new Date(now.getTime() + 2 * 3600e3)), null, 'expiré après une heure');
  await assert.rejects(AuthService.resetPassword(token, 'court', now), /8 caractères/);
  await AuthService.resetPassword(token, 'nouveaumotdepasse', now);
  await AuthService.login({ login: 'Alice', password: 'nouveaumotdepasse' });
  await assert.rejects(AuthService.resetPassword(token, 'encoreunautre', now), /invalide ou a expiré/);

  for (let i = 0; i < 5; i += 1) await AuthService.requestPasswordReset('alice@example.com', 'http://jeu', now);
  assert.equal(await PasswordReset.count({ where: { userId: u.Alice.id } }), 3, 'trois demandes par heure au plus');
});

test('suppression du compte : modèles, favoris et demandes de réinitialisation disparaissent', async () => {
  await ArmyTemplateService.create(p.Alice.id, { name: 'X', spear: 1 }, world.getConfig());
  await FavoriteService.toggle(p.Alice.id, world.id, v.Bob.id);
  await AccountService.deleteAccount(u.Alice.id, 'nouveaumotdepasse');
  assert.equal(await User.count({ where: { id: u.Alice.id } }), 0);
  assert.equal(await ArmyTemplate.count(), 0);
  assert.equal(await MapFavorite.count(), 0);
  assert.equal(await PasswordReset.count(), 0);
});
