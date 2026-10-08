'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Village, Player, BuildReward } = require('../src/models');
const createApp = require('../src/app');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const BuildRewardService = require('../src/services/BuildRewardService');
const buildRewards = require('../src/game/buildRewards');
const registry = require('../src/game/registry');

let world;
let alice;
let home;
let server;
let base;

const later = (ms) => new Date(Date.now() + ms);
// Construit un niveau et le termine (rafraîchissement juste après la fin du chantier).
async function buildAndFinish(villageId, building) {
  const order = await VillageService.build(villageId, building);
  await VillageService.withVillage(villageId, async () => {}, { now: new Date(new Date(order.endsAt).getTime() + 1) });
  return order;
}

test.before(async () => {
  await sequelize.sync({ force: true });
  world = await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  const u = await AuthService.register({ username: 'Alice', email: 'alice@example.com', password: 'motdepasse' });
  ({ player: alice, village: home } = await WorldService.join(u, 'w1'));
  const app = createApp();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await sequelize.close();
});

test('montant : part du coût, avec un minimum et un plafond par ressource', () => {
  const cfg = world.getConfig();
  assert.deepEqual(cfg.buildRewards, { active: true, percent: 0.1, min: 100, max: 2500, days: 30 });
  // Camp de bois niveau 1 : 10 % de 50 bois, c'est moins que le minimum.
  assert.deepEqual(buildRewards.amount('wood', 1, cfg), { wood: 100, stone: 100, iron: 100 });
  // QG 20 : 10 % du coût (exemple du support de Guerre Tribale : 727 bois).
  const qg = registry.building('main').costFor(20);
  assert.equal(buildRewards.amount('main', 20, cfg).wood, Math.round(qg.wood * 0.1));
  // Niveau très cher : plafonné.
  assert.equal(buildRewards.amount('wood', 30, cfg).wood, 2500);
  assert.ok(buildRewards.active(cfg, world, later(29 * 86400000)));
  assert.ok(!buildRewards.active(cfg, world, later(31 * 86400000)), 'après 30 jours');
});

test('un niveau construit rapporte une fois par joueur, même dans un autre village ; pas une démolition', async () => {
  await Village.update({ wood: 5000, stone: 5000, iron: 5000, resourcesAt: new Date() }, { where: { id: home.id } });
  await buildAndFinish(home.id, 'wood');
  let pending = await BuildRewardService.pending(alice.id);
  assert.deepEqual(pending.map((r) => `${r.building}${r.level}`), ['wood1']);
  assert.equal(pending[0].villageId, home.id);
  assert.equal(await BuildRewardService.pendingCount(alice.id), 1);

  // Deuxième village du joueur : son camp de bois 1 ne rapporte plus rien, le niveau 2 oui.
  const other = await Village.create({ worldId: world.id, playerId: alice.id, name: 'Deux', x: 1, y: 1, buildings: { main: 1, farm: 5, storage: 5 }, wood: 5000, stone: 5000, iron: 5000, resourcesAt: new Date() });
  await buildAndFinish(other.id, 'wood');
  await buildAndFinish(other.id, 'wood');
  pending = await BuildRewardService.pending(alice.id);
  assert.deepEqual(pending.map((r) => `${r.building}${r.level}`), ['wood1', 'wood2']);
  await other.destroy();
});

test('récupération : dans le village courant, rien ne déborde de l’entrepôt', async () => {
  await BuildReward.destroy({ where: { playerId: alice.id } });
  await BuildReward.bulkCreate([
    { playerId: alice.id, villageId: home.id, building: 'farm', level: 2, wood: 100, stone: 200, iron: 300, earnedAt: new Date(Date.now() - 2000) },
    { playerId: alice.id, villageId: home.id, building: 'farm', level: 3, wood: 900, stone: 900, iron: 900, earnedAt: new Date(Date.now() - 1000) },
  ]);
  const cap = (await VillageService.withVillage(home.id, async (ctx) => ctx.state.storageCapacity()));
  // Assez de place pour la première seulement.
  await Village.update({ wood: cap - 500, stone: cap - 500, iron: cap - 500, resourcesAt: new Date() }, { where: { id: home.id } });
  const res = await BuildRewardService.collect(alice.id, home.id);
  assert.deepEqual({ collected: res.collected, left: res.left }, { collected: 1, left: 1 });
  const v = await Village.findByPk(home.id);
  assert.ok(Math.floor(v.wood) >= cap - 400 && Math.floor(v.iron) <= cap, 'première récompense versée');
  assert.deepEqual((await BuildRewardService.pending(alice.id)).map((r) => r.level), [3]);
  await assert.rejects(BuildRewardService.collect(alice.id, home.id), /entrepôt/);

  // Avec de la place, la dernière passe ; une récompense déjà récupérée ne se récupère pas deux fois.
  await Village.update({ wood: 0, stone: 0, iron: 0, resourcesAt: new Date() }, { where: { id: home.id } });
  const [last] = await BuildRewardService.pending(alice.id);
  assert.equal((await BuildRewardService.collect(alice.id, home.id, [last.id])).collected, 1);
  await assert.rejects(BuildRewardService.collect(alice.id, home.id, [last.id]), /déjà été récupérée/);
  assert.equal(await BuildRewardService.pendingCount(alice.id), 0);
  assert.equal(await BuildRewardService.collectedCount(alice.id), 2);
});

test('pas de récompense pour un bot, ni après la période, ni sur un monde qui les désactive', async () => {
  await BuildReward.destroy({ where: { playerId: alice.id } });
  await Village.update({ wood: 5000, stone: 5000, iron: 5000, resourcesAt: new Date() }, { where: { id: home.id } });
  await Player.update({ isBot: true }, { where: { id: alice.id } });
  await buildAndFinish(home.id, 'stone');
  assert.equal(await BuildRewardService.pendingCount(alice.id), 0, 'bot');
  await Player.update({ isBot: false }, { where: { id: alice.id } });

  // Monde ouvert il y a 31 jours : la période est finie.
  await World.update({ createdAt: new Date(Date.now() - 31 * 86400000) }, { where: { id: world.id }, silent: true });
  const old = await World.findByPk(world.id);
  assert.ok(!buildRewards.active(old.getConfig(), old, new Date()));
  await BuildRewardService.onBuilt(await Village.findByPk(home.id), old, old.getConfig(), [{ building: 'iron', level: 1, endsAt: new Date() }]);
  assert.equal(await BuildRewardService.pendingCount(alice.id), 0, 'période terminée');

  const off = await WorldService.createWorld({ slug: 'w2', name: 'Monde 2', config: { buildRewards: { active: false } } });
  assert.ok(!buildRewards.active(off.getConfig(), off, new Date()));
  await World.update({ createdAt: new Date() }, { where: { id: world.id }, silent: true });
});

test('pages : bouton de la barre du village, liste et récupération', async () => {
  let cookie = '';
  const http = async (path, { method = 'GET', form } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
  const tokenOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  const login = await http('/login');
  await http('/login', { method: 'POST', form: { login: 'Alice', password: 'motdepasse', _csrf: tokenOf(login.html) } });

  await BuildReward.create({ playerId: alice.id, villageId: home.id, building: 'main', level: 2, wood: 100, stone: 100, iron: 100, earnedAt: new Date() });
  await Village.update({ wood: 0, stone: 0, iron: 0, resourcesAt: new Date() }, { where: { id: home.id } });
  const overview = await http(`/village/${home.id}`);
  assert.equal(overview.status, 200);
  assert.match(overview.html, new RegExp(`href="/village/${home.id}/rewards(\\?tab=quests)?"[^>]*title="Quêtes et récompenses : 1 à récupérer"`));

  const page = await http(`/village/${home.id}/rewards`);
  assert.equal(page.status, 200);
  assert.match(page.html, /Quartier général/);
  assert.match(page.html, /Tout récupérer ici/);
  const done = await http(`/village/${home.id}/rewards/collect`, { method: 'POST', form: { _csrf: tokenOf(page.html) } });
  assert.equal(done.status, 302);
  const after = await http(done.location);
  assert.match(after.html, /Récompense récupérée/);
  assert.match(after.html, /Aucune récompense en attente/);
});
