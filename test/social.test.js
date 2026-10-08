'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Conversation } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const MessageService = require('../src/services/MessageService');
const VillageState = require('../src/game/VillageState');
const WorldConfig = require('../src/game/WorldConfig');
const barbarian = require('../src/game/barbarian');

const T0 = new Date('2026-09-24T12:00:00Z');
const day = 86400000;
const p = {};
const v = {};

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { barbarian: { growthPerDay: 100, maxPoints: 300 } } });
  for (const name of ['Alice', 'Bob', 'Carol']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u, 'w1', { now: T0 }));
  }
});

test.after(() => sequelize.close());

test('barbares : croissance au rythme configuré, réserve des points non dépensés, plafond', () => {
  const world = new WorldConfig({ barbarian: { growthPerDay: 100, maxPoints: 500 } });
  const state = new VillageState({ buildings: { main: 1, farm: 1, storage: 1 }, units: {}, wood: 0, stone: 0, iron: 0, resourcesAt: T0 }, world);
  const start = state.points();

  // Une minute ne suffit pas pour un niveau : rien ne bouge, la réserve est conservée.
  const tiny = barbarian.grow(state, T0, new Date(T0.getTime() + 60000), world, () => 0.5);
  assert.equal(state.points(), start);
  assert.equal(+tiny, +T0);

  const next = barbarian.grow(state, T0, new Date(T0.getTime() + 2 * day), world, () => 0.5);
  const gained = state.points() - start;
  assert.ok(gained > 150 && gained <= 200, `gagné ${gained} points en 2 jours à 100/jour`);
  assert.ok(next <= new Date(T0.getTime() + 2 * day));

  barbarian.grow(state, T0, new Date(T0.getTime() + 365 * day), world, () => 0.5);
  assert.ok(state.points() <= 500 && state.points() > 450);
});

test('barbares : un village barbare grandit quand il est rafraîchi, pas un village de joueur', async () => {
  const barb = await Village.findOne({ where: { playerId: null } });
  const before = barb.points;
  const created = new Date(barb.createdAt).getTime();
  const ctx = await VillageService.withVillage(barb.id, async (c) => c, { now: new Date(created + 30 * day) });
  assert.ok(ctx.village.points > before && ctx.village.points <= 300);
  const mine = await VillageService.withVillage(v.Alice.id, async (c) => c, { now: new Date(created + 30 * day) });
  assert.equal(mine.village.points, v.Alice.points);
});

test('renommer un village', async () => {
  await VillageService.rename(v.Alice.id, '  Forteresse   du Nord ');
  assert.equal((await Village.findByPk(v.Alice.id)).name, 'Forteresse du Nord');
  await assert.rejects(VillageService.rename(v.Alice.id, ''), /1 à 32/);
});

test('messagerie : conversation à plusieurs, non-lus, réponses, départ', async () => {
  await assert.rejects(MessageService.start(p.Alice.id, { to: 'Alice', subject: 'x', body: 'y' }), /vous-même/);
  await assert.rejects(MessageService.start(p.Alice.id, { to: 'Inconnu', subject: 'x', body: 'y' }), /introuvable : Inconnu/);

  const conv = await MessageService.start(p.Alice.id, { to: 'Bob, Carol', subject: 'Plan', body: 'On attaque ce soir ?' }, { now: T0 });
  assert.equal(await MessageService.unreadCount(p.Alice.id), 0);
  assert.equal(await MessageService.unreadCount(p.Bob.id), 1);

  const read = await MessageService.read(p.Bob.id, conv.id, { now: new Date(T0.getTime() + 1000) });
  assert.equal(read.messages.length, 1);
  assert.equal(await MessageService.unreadCount(p.Bob.id), 0);

  await MessageService.reply(p.Bob.id, conv.id, 'Oui !', { now: new Date(T0.getTime() + 2000) });
  assert.equal(await MessageService.unreadCount(p.Alice.id), 1);
  const { rows: [entry] } = await MessageService.inbox(p.Alice.id);
  assert.equal(entry.unread, true);
  assert.equal(entry.count, 2);
  assert.equal(entry.author.name, 'Alice');
  assert.deepEqual(entry.others.map((o) => o.name).sort(), ['Bob', 'Carol']);
  assert.equal((await MessageService.inbox(p.Alice.id, { search: 'ATTAQUE' })).total, 1, 'recherche dans le texte');
  assert.equal((await MessageService.inbox(p.Alice.id, { search: 'plan' })).total, 1, "recherche dans l'objet");
  assert.equal((await MessageService.inbox(p.Alice.id, { search: 'rien' })).total, 0);
  // Les derniers messages seulement, du plus ancien au plus récent, et le nombre des plus anciens.
  const last = await MessageService.read(p.Alice.id, conv.id, { limit: 1 });
  assert.deepEqual(last.messages.map((m) => m.body), ['Oui !']);
  assert.equal(last.olderCount, 1);
  const whole = await MessageService.read(p.Alice.id, conv.id, { limit: null });
  assert.deepEqual(whole.messages.map((m) => m.body), ['On attaque ce soir ?', 'Oui !']);
  assert.equal(whole.olderCount, 0);

  await assert.rejects(MessageService.read(p.Carol.id, 999), /introuvable/);
  for (const name of ['Alice', 'Bob', 'Carol']) await MessageService.leave(p[name].id, conv.id);
  assert.equal(await Conversation.count(), 0, 'supprimée quand tout le monde est parti');
});

test('courrier circulaire : groupes de la tribu, droit requis pour la tribu entière, liste des envois', async () => {
  const TribeService = require('../src/services/TribeService');
  const { Player } = require('../src/models');
  await TribeService.create(p.Alice.id, { name: 'Les Hiboux', tag: 'HIB' });
  for (const name of ['Bob', 'Carol']) {
    await TribeService.invite(p.Alice.id, name);
    const [inv] = await TribeService.invitesFor(p[name].id);
    await TribeService.acceptInvite(p[name].id, inv.id);
  }
  const bob = await Player.findByPk(p.Bob.id);
  assert.deepEqual(MessageService.groupsFor(bob).filter((g) => !g.blocker).map((g) => g.id), ['duke', 'baron', 'diplomacy'], 'sans le droit : pas de tribu entière');
  assert.ok(MessageService.groupsFor({ tribeId: null }).every((g) => g.blocker), 'sans tribu : menu grisé');
  await assert.rejects(MessageService.start(p.Bob.id, { group: 'tribe', subject: 'x', body: 'y' }), /courrier circulaire/);
  await assert.rejects(MessageService.start(p.Bob.id, { group: 'diplomacy', subject: 'x', body: 'y' }), /Aucun autre membre/);

  const toDuke = await MessageService.start(p.Bob.id, { group: 'duke', subject: 'Question', body: 'Qui attaque ?' }, { now: T0 });
  assert.equal(await MessageService.unreadCount(p.Alice.id), 1);
  assert.equal(await MessageService.unreadCount(p.Carol.id), 0);

  const all = await MessageService.start(p.Alice.id, { group: 'tribe', subject: 'Opération', body: 'Tous à 20h' }, { now: T0 });
  assert.equal(await MessageService.unreadCount(p.Carol.id), 1);
  const sent = await MessageService.circulars(p.Alice.id);
  assert.deepEqual(sent.map((c) => [c.conversation.id, c.group, c.others.length]), [[all.id, 'Tribu entière', 2]]);

  assert.equal(await MessageService.leaveMany(p.Alice.id, [toDuke.id, all.id, 999]), 2);
  assert.equal((await MessageService.inbox(p.Alice.id)).total, 0);
});
