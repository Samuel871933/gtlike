'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, User, World, Village, Entitlement, AdartonTransaction } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const AccountService = require('../src/services/AccountService');
const ShopService = require('../src/services/ShopService');
const catalog = require('../src/game/shopCatalog');

const T0 = new Date('2026-10-01T12:00:00Z');
const DAY = 86400000;
let official;
let server;
let alice;
let bob;

test.before(async () => {
  await sequelize.sync({ force: true });
  official = await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  alice = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  bob = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  server = await World.create({ slug: 'priv', name: 'Serveur d’Alice', config: {}, ownerUserId: alice.id, access: 'open' });
  await WorldService.join(alice, 'w1', { now: T0 });
  await WorldService.join(bob, 'w1', { now: T0 });
  await WorldService.join(bob, 'priv', { now: T0 });
});

test.after(() => sequelize.close());

const buy = (user, itemKey, offerId, worldId, now = T0) => ShopService.purchase(user.id, { itemKey, offerId, worldId, waiver: true }, { now });

test('catalogue : thème et design par défaut gratuits, trois portées par cosmétique', () => {
  assert.ok(!catalog.item('theme:adarma') && !catalog.item('design:beige'));
  assert.deepEqual(catalog.item('theme:viking').offers.map((o) => o.scope), ['world', 'account', 'server']);
  assert.ok(catalog.item('premium').offers.some((o) => o.scope === 'server' && o.days === null));
  const rights = new ShopService.Rights([]);
  assert.ok(rights.has('theme:adarma') && rights.has('design:beige') && !rights.has('theme:viking'));
  assert.ok(new ShopService.Rights(['cosmetics:all']).has('design:noir'), 'le pack couvre les designs');
  assert.ok(!new ShopService.Rights(['cosmetics:all']).premium, 'mais pas le premium');
});

test('achat : renonciation, solde, débit et historique', async () => {
  await assert.rejects(ShopService.purchase(alice.id, { itemKey: 'theme:viking', offerId: 'account' }), /renonciation/);
  await assert.rejects(buy(alice, 'theme:viking', 'account'), /Il te manque 1200 Adartons/);
  await ShopService.credit(alice.id, 25000, 'Test');
  await buy(alice, 'theme:viking', 'account');
  assert.equal((await User.findByPk(alice.id)).adartons, 23800);
  assert.ok((await ShopService.rightsFor(alice.id, null)).has('theme:viking'));
  assert.ok((await ShopService.rightsFor(alice.id, official.id)).has('theme:viking'), 'portée compte : sur tous les mondes');
  await assert.rejects(buy(alice, 'theme:viking', 'world', official.id), /possèdes déjà/);
  const tx = await AdartonTransaction.findAll({ where: { userId: alice.id }, order: [['id', 'ASC']] });
  assert.deepEqual(tx.map((x) => x.amount), [25000, -1200]);
  assert.equal(tx[1].balanceAfter, 23800);
});

test('portée monde : seulement sur ce monde, seulement là où l’on joue', async () => {
  await ShopService.credit(bob.id, 3000, 'Test');
  await assert.rejects(buy(bob, 'design:noir', 'world', 999), /monde en cours/);
  await assert.rejects(buy(alice, 'design:noir', 'world', server.id), /ne joues pas/);
  await buy(bob, 'design:noir', 'world', official.id);
  assert.ok((await ShopService.rightsFor(bob.id, official.id)).has('design:noir'));
  assert.ok(!(await ShopService.rightsFor(bob.id, server.id)).has('design:noir'));
  assert.ok(!(await ShopService.rightsFor(bob.id, null)).has('design:noir'));
});

test('portée serveur : réservée au créateur, valable pour tous les joueurs du serveur', async () => {
  await assert.rejects(buy(bob, 'cosmetics:all', 'server', server.id), /Seul le créateur/);
  await assert.rejects(buy(alice, 'cosmetics:all', 'server', official.id), /Seul le créateur/);
  await buy(alice, 'cosmetics:all', 'server', server.id);
  assert.ok((await ShopService.rightsFor(bob.id, server.id)).has('theme:egypt'), 'Bob en profite sur le serveur d’Alice');
  assert.ok(!(await ShopService.rightsFor(bob.id, official.id)).has('theme:egypt'), 'pas ailleurs');
  const map = await ShopService.rightsByUser([bob.id], server.id);
  assert.ok(map.get(bob.id).has('design:futuriste'));
  await assert.rejects(buy(alice, 'theme:roman', 'server', server.id), /possèdes déjà/, 'déjà couvert par le pack');
});

test('premium : durées qui s’enchaînent, file de construction plus longue', async () => {
  const [village] = await Village.findAll({ where: { worldId: official.id, playerId: (await bob.getPlayers())[0].id } });
  const slots = (now) => VillageService.withVillage(village.id, async (ctx) => ctx.buildQueueSlots, { now });
  assert.equal(await slots(T0), 2);
  await buy(bob, 'premium', 'world-30', official.id);
  await buy(bob, 'premium', 'world-30', official.id);
  const rows = await Entitlement.findAll({ where: { userId: bob.id, itemKey: 'premium' }, order: [['id', 'ASC']] });
  assert.equal(new Date(rows[1].startsAt).getTime(), new Date(rows[0].endsAt).getTime(), 'le 2e mois suit le 1er');
  assert.equal(await slots(new Date(T0.getTime() + 45 * DAY)), 5);
  assert.equal(await slots(new Date(T0.getTime() + 61 * DAY)), 2, 'premium terminé');
  // Premium offert à tout le serveur, pour toute sa durée : une seule fois.
  await ShopService.credit(alice.id, 8000, 'Test');
  await buy(alice, 'premium', 'server-life', server.id);
  assert.ok(await ShopService.hasPremium(bob.id, server.id));
  await assert.rejects(buy(alice, 'premium', 'server-life', server.id), /toute sa durée/);
});

test('mondes terminés exclus ; suppression du compte : droits perdus, cadeaux au serveur gardés, historique anonymisé', async () => {
  await World.update({ endedAt: T0 }, { where: { id: official.id } });
  await assert.rejects(buy(alice, 'theme:roman', 'world', official.id), /monde en cours/);
  await World.update({ endedAt: null }, { where: { id: official.id } });

  await AccountService.deleteAccount(alice.id, 'motdepasse');
  assert.equal(await Entitlement.count({ where: { scope: 'account', itemKey: 'theme:viking' } }), 0);
  assert.ok((await ShopService.rightsFor(bob.id, server.id)).has('theme:egypt'), 'le pack offert au serveur reste');
  assert.ok(await AdartonTransaction.count({ where: { userId: null } }) >= 2, 'historique gardé sans compte');
});
