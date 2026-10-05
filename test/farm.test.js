'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, LastAttack, Command, Entitlement } = require('../src/models');
const createApp = require('../src/app');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const CommandService = require('../src/services/CommandService');
const ArmyTemplateService = require('../src/services/ArmyTemplateService');
const FarmService = require('../src/services/FarmService');

const T0 = new Date(Date.now() - 3600000);
let alice;
let home;
let barbs;
let server;
let base;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  const u = await AuthService.register({ username: 'Alice', email: 'alice@example.com', password: 'motdepasse' });
  ({ player: alice, village: home } = await WorldService.join(u, 'w1', { now: T0 }));
  // Trois barbares à 2, 3 et 4 cases (cases libres à l'est du village).
  barbs = [];
  for (const d of [2, 3, 4]) {
    const at = { worldId: home.worldId, x: home.x + d, y: home.y + 1 };
    await Village.destroy({ where: { ...at, playerId: null } });
    barbs.push(await Village.create({ ...at, playerId: null, name: 'Village barbare', buildings: { main: 1 }, units: {}, wood: 500, stone: 500, iron: 500, resourcesAt: T0 }));
  }
  const app = createApp();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await sequelize.close();
});

const worldCfg = async () => (await require('../src/models').World.findByPk(home.worldId)).getConfig();

test('modèles favoris : trois au plus, lettre du nom, retrait', async () => {
  const c = await worldCfg();
  const made = [];
  for (const name of ['pilleurs', 'Béliers', '2 cavaliers', 'Espions']) made.push(await ArmyTemplateService.create(alice.id, { name, light: 5 }, c));
  for (const t of made.slice(0, 3)) await ArmyTemplateService.toggleFavorite(alice.id, t.id);
  await assert.rejects(ArmyTemplateService.toggleFavorite(alice.id, made[3].id), /3 modèles favoris au maximum/);
  assert.deepEqual((await ArmyTemplateService.favorites(alice.id)).map(ArmyTemplateService.letter), ['P', 'B', '2']);
  // Un emplacement libéré est repris par le prochain favori.
  await ArmyTemplateService.toggleFavorite(alice.id, made[1].id);
  await ArmyTemplateService.toggleFavorite(alice.id, made[3].id);
  assert.deepEqual((await ArmyTemplateService.favorites(alice.id)).map((t) => [t.name, t.favorite]), [['pilleurs', 1], ['Espions', 2], ['2 cavaliers', 3]]);
});

test('assistant : barbares attaqués, filtres, attaques en route, envoi d’un favori', async () => {
  const c = await worldCfg();
  await Village.update({ units: { light: 60 }, buildings: { ...home.buildings, place: 1 } }, { where: { id: home.id } });
  // Une attaque gagnée par barbare, puis des résultats forcés pour tester les filtres.
  for (const b of barbs) {
    const cmd = await CommandService.send(home.id, { x: b.x, y: b.y, type: 'attack', units: { light: 10 } }, { now: T0 });
    await CommandService.processDue(cmd.arrivesAt, { rng: () => 0.5 });
  }
  const marks = await LastAttack.findAll({ where: { playerId: alice.id } });
  assert.equal(marks.length, 3);
  assert.ok(marks.every((m) => m.originVillageId === home.id), 'village d’où partait l’attaque');
  await LastAttack.update({ result: 'loss' }, { where: { playerId: alice.id, villageId: barbs[2].id } });

  let player = await Player.findByPk(alice.id);
  let settings = FarmService.settings(player);
  let { rows, pagination } = await FarmService.list(player, home, settings);
  assert.equal(pagination.total, 2, 'pertes totales exclues par défaut');
  assert.ok(rows[0].distance <= rows[1].distance, 'tri par distance');
  assert.ok(rows[0].report, 'rapport de la dernière attaque');

  settings = await FarmService.saveSettings(alice.id, { loss: '1', partial: '1', sort: 'date' });
  player = await Player.findByPk(alice.id);
  assert.equal((await FarmService.list(player, home, FarmService.settings(player))).pagination.total, 3);

  // Envoi d'un favori : le village visé disparaît tant que l'attaque est en route (sauf filtre « attacked »).
  const [fav] = await ArmyTemplateService.favorites(alice.id);
  const sent = await FarmService.send(home.id, alice.id, fav.id, barbs[0].id, c);
  assert.deepEqual(sent.units, { light: 5 });
  assert.equal(await Command.count({ where: { targetVillageId: barbs[0].id, type: 'attack' } }), 1);
  ({ rows } = await FarmService.list(player, home, FarmService.settings(player)));
  assert.ok(!rows.some((r) => r.village.id === barbs[0].id));
  await FarmService.saveSettings(alice.id, { loss: '1', partial: '1', attacked: '1' });
  player = await Player.findByPk(alice.id);
  ({ rows } = await FarmService.list(player, home, FarmService.settings(player)));
  assert.equal(rows.find((r) => r.village.id === barbs[0].id).attacking, 1);

  // Retirer un village de la liste.
  await FarmService.forget(alice.id, barbs[1].id);
  assert.equal((await FarmService.list(player, home, FarmService.settings(player))).pagination.total, 2);
});

test('pages : assistant réservé au premium, envoi rapide en JSON (raccourcis de la carte)', async () => {
  let cookie = '';
  const http = async (path, { method = 'GET', form, json } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(json ? { accept: 'application/json' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
  const token = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  const login = await http('/login');
  await http('/login', { method: 'POST', form: { login: 'Alice', password: 'motdepasse', _csrf: token(login.text) } });
  const v = `/village/${home.id}`;

  const locked = await http(`${v}/farm`);
  assert.equal(locked.status, 200);
  assert.match(locked.text, /réservé au premium/);
  assert.doesNotMatch(locked.text, /Derniers pillages/);

  await Entitlement.create({ scope: 'account', userId: alice.userId, itemKey: 'premium', startsAt: new Date(Date.now() - 60000), source: 'gift' });
  const page = await http(`${v}/farm`);
  assert.match(page.text, /Derniers pillages/);
  assert.match(page.text, /data-farm-send/);
  assert.match(page.text, /data-farm-unit="light"/, 'troupes dans le tableau commun');
  assert.match(page.text, /Retirer des favoris/, 'tous les modèles, avec leur étoile');
  // Filtres enregistrés sans recharger la page (game.js relit ensuite la liste).
  const saved = await http(`${v}/farm/settings`, { method: 'POST', json: true, form: { partial: '1', sort: 'date', _csrf: token(page.text) } });
  assert.equal(JSON.parse(saved.text).sort, 'date');

  // Carte : les favoris dans les données du menu ; point de ralliement : étoile des favoris.
  assert.match((await http(`${v}/map`)).text, /"farm":\[\{"id":\d+,"name":"pilleurs","letter":"P"\}/);
  assert.match((await http(`${v}/place`)).text, /Retirer des favoris/);

  // Favori d'un onglet : « Pillage » du point de ralliement dans la barre d'accès rapide, à côté du bâtiment.
  await http(`${v}/buildings/place/favorite`, { method: 'POST', form: { tab: 'farm', _csrf: token(page.text) } });
  assert.ok((await Player.findByPk(alice.id)).favoriteBuildings.includes('place:farm'));
  const bar = (await http(`${v}/farm`)).text.match(/<nav[^>]*data-quickbar[\s\S]*?<\/nav>/)[0];
  assert.match(bar, new RegExp(`href="${v}/farm"[^>]*aria-current="page"`));
  await http(`${v}/buildings/place/favorite`, { method: 'POST', form: { tab: 'inconnu', _csrf: token(page.text) } });
  // Onglet inconnu : c'est le bâtiment qui bascule (il était dans la barre par défaut, il en sort).
  const keys = (await Player.findByPk(alice.id)).favoriteBuildings;
  assert.ok(!keys.includes('place') && !keys.some((k) => k.endsWith(':inconnu')) && keys.includes('place:farm'));

  // Barre des favoris déplacée (réglage du compte) : colonne hors de l'en-tête ; emplacement inconnu refusé.
  await http(`${v}/account/quickbar-position`, { method: 'POST', form: { position: 'left', _csrf: token(page.text) } });
  assert.match((await http(`${v}/farm`)).text, /class="quickbar-dock" data-pos="left"[^>]*data-quickbar/);
  await http(`${v}/account/quickbar-position`, { method: 'POST', form: { position: 'milieu', _csrf: token(page.text) } });
  assert.match((await http(`${v}/account`)).text, /id="barre-favoris"/);
  assert.match((await http(`${v}/farm`)).text, /data-pos="left"/);

  const [fav] = await ArmyTemplateService.favorites(alice.id);
  const ok = await http(`${v}/farm/send`, { method: 'POST', json: true, form: { template: fav.id, target: barbs[2].id, _csrf: token(page.text) } });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.text).units, { light: 5 });
  const refused = await http(`${v}/farm/send`, { method: 'POST', json: true, form: { template: fav.id, target: home.id, _csrf: token(page.text) } });
  assert.equal(refused.status, 400);
  assert.match(JSON.parse(refused.text).error, /propre village/);
});
