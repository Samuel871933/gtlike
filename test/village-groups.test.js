'use strict';

// Groupes de villages (comme sur Guerre Tribale) : gestion, groupe actif comme contexte (aperçus, gestionnaire,
// flèches de l'en-tête), conquête, et marquages de carte (groupe, icône d'unité).

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, VillageGroupMember, MapMarker, Entitlement, ManagerVillage } = require('../src/models');
const createApp = require('../src/app');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageGroupService = require('../src/services/VillageGroupService');
const MarkerService = require('../src/services/MarkerService');
const CommandService = require('../src/services/CommandService');

let alice;
let bob;
let home;
const extra = [];
let server;
let base;

function client() {
  let cookie = '';
  const call = async (path, { method = 'GET', form } = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
  return call;
}
const tokenOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  const u = await AuthService.register({ username: 'Alice', email: 'alice@example.com', password: 'motdepasse' });
  ({ player: alice, village: home } = await WorldService.join(u, 'w1'));
  const b = await AuthService.register({ username: 'Bob', email: 'bob@example.com', password: 'motdepasse' });
  ({ player: bob } = await WorldService.join(b, 'w1'));
  // Alice : Aa (home renommé), Bb, Cc, Dd.
  await home.update({ name: 'Aa' });
  for (const [i, name] of ['Bb', 'Cc', 'Dd'].entries()) {
    const at = { worldId: home.worldId, x: home.x - 4 - i, y: home.y - 4 };
    await Village.destroy({ where: at });
    extra.push(await Village.create({ ...at, playerId: alice.id, name, buildings: { main: 1, farm: 1, storage: 1 }, units: {}, wood: 0, stone: 0, iron: 0, resourcesAt: new Date() }));
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

test('service : création, villages, renommage, suppression', async () => {
  const front = await VillageGroupService.create(alice.id, '  Front   nord ');
  assert.equal(front.name, 'Front nord');
  await assert.rejects(VillageGroupService.create(alice.id, 'Front nord'), /déjà un groupe/);
  await assert.rejects(VillageGroupService.create(alice.id, ''), /nom/);
  // Grille : les villages d'un autre joueur et les villages non affichés sont ignorés.
  const bobVillage = await Village.findOne({ where: { playerId: bob.id } });
  const pair = (v) => `${front.id}:${v.id}`;
  await VillageGroupService.setMatrix(alice.id, [extra[0].id, extra[1].id, bobVillage.id], [pair(extra[0]), pair(extra[1]), pair(bobVillage)]);
  assert.deepEqual((await VillageGroupService.villageIds(alice.id, front.id)).sort(), [extra[0].id, extra[1].id].sort());
  await assert.rejects(VillageGroupService.rename(bob.id, front.id, 'X'), /introuvable/);
  // Décocher Bb (affiché) le retire ; Aa, non affiché, n'est pas touché.
  const counts = await VillageGroupService.setMatrix(alice.id, [extra[1].id], []);
  assert.deepEqual(counts, [{ id: front.id, count: 1 }]);

  const def = await VillageGroupService.create(alice.id, 'Défense');
  await VillageGroupService.setForVillage(alice.id, home.id, [front.id, def.id]);
  const membership = await VillageGroupService.membership(alice.id);
  assert.deepEqual(membership.get(home.id).sort(), [front.id, def.id].sort());
  await VillageGroupService.setForVillage(alice.id, home.id, [def.id]);
  assert.deepEqual((await VillageGroupService.membership(alice.id)).get(home.id), [def.id]);

  await VillageGroupService.rename(alice.id, def.id, 'Défense sud');
  const list = await VillageGroupService.list(alice.id);
  assert.deepEqual(list.map((g) => [g.name, g.count]), [['Défense sud', 1], ['Front nord', 1]]);

  // Suppression : membres, marquage et groupe actif s'en vont avec le groupe.
  await MarkerService.set(alice.id, home.worldId, { type: 'group', targetId: def.id, color: '#00ff00' });
  await VillageGroupService.select(alice.id, def.id);
  await VillageGroupService.remove(alice.id, def.id);
  assert.equal(await VillageGroupMember.count({ where: { groupId: def.id } }), 0);
  assert.equal(await MapMarker.count({ where: { targetType: 'group', targetId: def.id } }), 0);
  assert.equal((await Player.findByPk(alice.id)).villageGroupId, null);
});

test('pages : groupe actif comme contexte (aperçu filtré, flèches, gestionnaire)', async () => {
  const front = (await VillageGroupService.list(alice.id)).find((g) => g.name === 'Front nord');
  await VillageGroupService.setMatrix(alice.id, [extra[0].id, extra[2].id], [`${front.id}:${extra[0].id}`, `${front.id}:${extra[2].id}`]); // Bb et Dd
  const http = client();
  const login = await http('/login');
  await http('/login', { method: 'POST', form: { login: 'Alice', password: 'motdepasse', _csrf: tokenOf(login.html) } });
  const v = `/village/${home.id}`;

  // Sans groupe : tous les villages.
  let page = await http(`${v}/villages`);
  assert.equal(page.status, 200);
  assert.match(page.html, /Villages \(4\)/);

  // ?group= choisit le groupe actif : l'aperçu ne montre que ses villages, et le choix est mémorisé.
  page = await http(`${v}/villages?mode=prod&group=${front.id}`);
  assert.match(page.html, /Villages \(2 · Front nord\)/);
  assert.doesNotMatch(page.html, />Cc</);
  assert.equal((await Player.findByPk(alice.id)).villageGroupId, front.id);
  page = await http(`${v}/villages?mode=units`);
  assert.match(page.html, /Villages \(2 · Front nord\)/);

  // Flèches de l'en-tête : Aa n'est pas dans le groupe, elles mènent au dernier et au premier village du groupe.
  page = await http(v);
  assert.match(page.html, new RegExp(`href="/village/${extra[2].id}" data-village-link[^>]*title="Village précédent : Dd"`));
  assert.match(page.html, new RegExp(`href="/village/${extra[0].id}" data-village-link[^>]*title="Village suivant : Bb"`));
  // Liste de l'en-tête : « Tous », les groupes du village courant et le groupe actif ; pas Production (vide).
  assert.match(page.html, /aria-label="Groupe de villages">[\s\S]*?Front nord[\s\S]*?<\/div>/);
  // Depuis Bb, le suivant est Dd (Cc, hors du groupe, est sauté).
  page = await http(`/village/${extra[0].id}`);
  assert.match(page.html, /title="Village suivant : Dd"/);
  assert.match(page.html, /title="Village précédent : Dd"/);

  // Onglet Groupes et encart de l'aperçu du village.
  page = await http(`${v}/villages?mode=groups`);
  assert.equal(page.status, 200);
  assert.match(page.html, /data-group-matrix/);
  assert.match(page.html, /Villages \(4\)/, 'tous les villages, quel que soit le groupe actif');

  assert.match(page.html, /Mes groupes/);
  assert.match(page.html, /data-group-apply/);

  // Nouveau groupe, puis grille appliquée.
  let res = await http(`${v}/groups`, { method: 'POST', form: { _csrf: tokenOf(page.html), name: 'Production' } });
  assert.equal(res.status, 302);
  const prod = (await VillageGroupService.list(alice.id)).find((g) => g.name === 'Production');
  res = await http(`${v}/groups/matrix`, { method: 'POST', form: [['_csrf', tokenOf(page.html)], ['shown', String(extra[1].id)], ['m', `${prod.id}:${extra[1].id}`]] });
  assert.equal(res.status, 302);
  assert.equal((await VillageGroupService.list(alice.id)).find((g) => g.id === prod.id).count, 1);
  await VillageGroupService.setMatrix(alice.id, [extra[1].id], []);

  // Groupe vide : aperçu vide, sans erreur.
  page = await http(`${v}/villages?group=${prod.id}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /Aucun village dans ce groupe/);

  // Gestionnaire : liste filtrée par le groupe, action « tout le groupe » au-delà des cases cochées.
  await Entitlement.create({ scope: 'account', userId: alice.userId, itemKey: 'premium', startsAt: new Date(Date.now() - 60000), source: 'gift' });
  page = await http(`${v}/manager?tab=buildings&group=${front.id}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /tout le groupe « Front nord » \(2\)/);
  assert.doesNotMatch(page.html, /aria-label="Cc"/);
  res = await http(`${v}/manager/apply`, { method: 'POST', form: { _csrf: tokenOf(page.html), op: 'build:use', buildTemplate: 'sys:resources', scope: 'group' } });
  assert.equal(res.status, 302);
  const managed = (await ManagerVillage.findAll({ where: { buildTemplate: 'sys:resources' } })).map((m) => m.villageId).sort();
  assert.deepEqual(managed, [extra[0].id, extra[2].id].sort());

  // Arrivant : même menu « Aperçu » (onglet Groupes), filtre de groupe, puce active.
  page = await http(`${v}/incomings?group=${front.id}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /villages\?mode=groups"[^>]*>Groupes</);
  assert.match(page.html, /aria-current="true" title="Front nord"><span class="truncate">Front nord<\/span><span class="shrink-0 tabular-nums">\(2\)/);

  // Pagination des aperçus : réglage « villages par page » en pied de liste.
  await VillageGroupService.select(alice.id, '');
  page = await http(`${v}/villages?mode=prod`);
  assert.match(page.html, /Villages par page/);
  const rowNames = [...page.html.matchAll(/max-w-44 truncate font-semibold">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(rowNames, ['Aa', 'Bb', 'Cc', 'Dd']);

  // Groupe inconnu : retour à tous les villages.
  page = await http(`${v}/villages?group=999999`);
  assert.match(page.html, /Villages \(4\)/);
});

test('marquages : groupe de villages, icône d’unité seule ou sur une couleur', async () => {
  const front = (await VillageGroupService.list(alice.id)).find((g) => g.name === 'Front nord');
  await assert.rejects(MarkerService.set(alice.id, home.worldId, { type: 'village', target: `${home.x}|${home.y}` }), /couleur, une icône/);
  await assert.rejects(MarkerService.set(alice.id, home.worldId, { type: 'village', target: `${home.x}|${home.y}`, icon: 'dragon' }), /Icône inconnue/);
  await assert.rejects(MarkerService.set(bob.id, home.worldId, { type: 'group', target: 'Front nord', color: '#ff0000' }), /Aucun de tes groupes/);
  await MarkerService.set(alice.id, home.worldId, { type: 'group', target: 'front nord', icon: 'axe' });
  await MarkerService.set(alice.id, home.worldId, { type: 'player', targetId: alice.id, color: '#123456', icon: 'spear' });
  const markers = await MarkerService.list(alice.id, home.worldId);
  const maps = MarkerService.colorMaps(markers);
  // Le groupe passe avant le joueur ; hors du groupe, le marquage du joueur.
  assert.deepEqual(MarkerService.styleOf(maps, { id: extra[0].id, playerId: alice.id }), { color: null, icon: 'axe' });
  assert.deepEqual(MarkerService.styleOf(maps, { id: extra[1].id, playerId: alice.id }), { color: '#123456', icon: 'spear' });
  assert.equal(MarkerService.colorOf(maps, { id: extra[0].id, playerId: alice.id }), null);
  assert.equal(markers.find((m) => m.targetType === 'group').label, front.name);

  // Page de la carte : formulaire (icônes), liste et lien de modification pré-rempli.
  const http = client();
  const login = await http('/login');
  await http('/login', { method: 'POST', form: { login: 'Alice', password: 'motdepasse', _csrf: tokenOf(login.html) } });
  const map = `/village/${home.id}/map`;
  let page = await http(map);
  assert.equal(page.status, 200);
  assert.match(page.html, /name="icon" value="axe"/);
  assert.match(page.html, /"unitIcons":\{/);
  page = await http(`${map}?mark=group:${front.id}`);
  assert.match(page.html, /Modifier le marquage/);
  assert.match(page.html, /name="icon" value="axe" class="peer sr-only" checked/);
  assert.doesNotMatch(page.html, /name="withColor" value="1" class="[^"]*" checked/);
  // Case Couleur décochée : icône seule ; cochée : couleur et icône.
  await http(`${map}/markers`, { method: 'POST', form: { _csrf: tokenOf(page.html), styleForm: '1', type: 'village', targetId: String(extra[1].id), color: '#00aa00', icon: 'snob' } });
  let marker = await MapMarker.findOne({ where: { targetType: 'village', targetId: extra[1].id } });
  assert.equal(marker.color, null);
  assert.equal(marker.icon, 'snob');
  await http(`${map}/markers`, { method: 'POST', form: { _csrf: tokenOf(page.html), styleForm: '1', withColor: '1', type: 'village', targetId: String(extra[1].id), color: '#00aa00', icon: 'snob' } });
  marker = await marker.reload();
  assert.equal(marker.color, '#00aa00');
  // Données d'un secteur : couleur et icône du marquage du village.
  const { x, y } = extra[1];
  const sectors = JSON.parse((await http(`${map}/sectors?s=${Math.floor(x / 20)}.${Math.floor(y / 20)}`)).html);
  const cell = sectors[0].cells.find((c) => c.id === extra[1].id);
  assert.equal(cell.mark, '#00aa00');
  assert.equal(cell.markIcon, 'snob');
});

test('conquête : le village quitte les groupes de l’ancien propriétaire', async () => {
  const front = (await VillageGroupService.list(alice.id)).find((g) => g.name === 'Front nord');
  const village = await Village.findByPk(extra[0].id);
  await sequelize.transaction((t) => CommandService.handOver(village, t));
  assert.equal(await VillageGroupMember.count({ where: { groupId: front.id, villageId: extra[0].id } }), 0);
});
