'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, ShipFlight } = require('../src/models');
const createApp = require('../src/app');
const WorldService = require('../src/services/WorldService');
const AuthService = require('../src/services/AuthService');
const VillageService = require('../src/services/VillageService');
const CommandService = require('../src/services/CommandService');
const WorldConfig = require('../src/game/WorldConfig');
const serverSettings = require('../src/game/serverSettings');
const movement = require('../src/game/movement');
const FlightService = require('../src/modes/zeppelin/FlightService');

const T0 = new Date(Date.UTC(2026, 9, 9, 12));
let zep;
let other;

/** Première case libre près du village, sur la même ligne. */
async function freeNear(v, cfg) {
  for (let dx = 2; dx < 30; dx++) if (await FlightService.isFree(v.worldId, v.x + dx, v.y, cfg)) return { x: v.x + dx, y: v.y };
  throw new Error('aucune case libre');
}
const ctxOf = (villageId, now) => VillageService.withVillage(villageId, async (ctx) => ctx, { now });

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'zep', name: 'Zeppelin', config: { mode: 'zeppelin', speed: 10, newbieDays: 0, zeppelin: { maxDistance: 25 } } });
  await WorldService.createWorld({ slug: 'w1', name: 'Classique', config: { newbieDays: 0 } });
  const alice = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  const bob = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  ({ village: zep } = await WorldService.join(alice, 'zep', { now: T0 }));
  await WorldService.join(bob, 'zep', { now: T0 });
  ({ village: other } = await WorldService.join(alice, 'w1', { now: T0 }));
  await Village.update({ buildings: { main: 5, place: 1, farm: 5, storage: 5, barracks: 1 }, units: { spear: 50 } }, { where: { id: zep.id } });
});

test.after(() => sequelize.close());

test('réglages : mode classique par défaut, réglages du mode fusionnés et enregistrés seulement pour ce mode', () => {
  assert.equal(new WorldConfig({}).mode, 'classic');
  const cfg = new WorldConfig({ mode: 'zeppelin', zeppelin: { maxDistance: 5 } });
  assert.deepEqual(cfg.zeppelin, { minutesPerField: 30, maxDistance: 5, cooldownMinutes: 120 });
  const body = Object.fromEntries(serverSettings.SETTINGS.map((s) => {
    const v = serverSettings.formValue(s);
    return [s.key, s.type === 'bool' ? (v ? '1' : '') : String(v)];
  }));
  assert.equal(serverSettings.parse({ ...body, mode: 'classic' }).config.zeppelin, undefined);
  assert.equal(serverSettings.parse({ ...body, mode: 'zeppelin' }).config.zeppelin.minutesPerField, 30);
});

test('vol : durée des troupes d’Adarma, village sur sa case de départ jusqu’à l’atterrissage', async () => {
  const v = await Village.findByPk(zep.id);
  const cfg = (await VillageService.cachedWorld(v.worldId)).getConfig();
  const to = await freeNear(v, cfg);
  const p = await FlightService.launch(v.id, to, { now: T0 });
  const expected = Math.round(movement.distance(v, to) * (30 / (10 * cfg.unitSpeed)) * 60);
  assert.equal(p.seconds, expected);
  assert.equal(p.arrivesAt.getTime(), T0.getTime() + expected * 1000);

  // En vol : toujours à la case de départ, ni troupes ni nouveau vol.
  const mid = new Date(T0.getTime() + 1000);
  assert.equal(await FlightService.landDue(mid), 0);
  assert.equal((await Village.findByPk(v.id)).x, v.x);
  const ctx = await ctxOf(v.id, mid);
  await assert.rejects(CommandService.plan(ctx, { x: v.x + 1, y: v.y, units: { spear: 1 }, type: 'attack' }), /Aucun village|en vol/);
  await assert.rejects(FlightService.launch(v.id, { x: to.x + 1, y: to.y }, { now: mid }), /déjà en vol/);

  // Atterrissage : nouvelle case, puis machines au repos (120 min ÷ vitesse 10 = 12 min).
  assert.equal(await FlightService.landDue(p.arrivesAt), 1);
  const landed = await Village.findByPk(v.id);
  assert.deepEqual([landed.x, landed.y], [to.x, to.y]);
  const back = { x: v.x, y: v.y };
  await assert.rejects(FlightService.launch(v.id, back, { now: new Date(p.arrivesAt.getTime() + 60000) }), /refroidissent/);
  const later = new Date(p.arrivesAt.getTime() + 12 * 60000);
  await FlightService.launch(v.id, back, { now: later });
  assert.ok(await FlightService.inFlight(v.id));
  await FlightService.landDue(new Date(later.getTime() + 3600000));
});

test('un vaisseau en vol n’envoie pas de troupes vers un village existant', async () => {
  const v = await Village.findByPk(zep.id);
  const bob = await Village.findOne({ where: { worldId: v.worldId, id: { [require('sequelize').Op.ne]: v.id }, playerId: { [require('sequelize').Op.ne]: null } } });
  const cfg = (await VillageService.cachedWorld(v.worldId)).getConfig();
  const ready = (await FlightService.status(v.id, cfg)).flight;
  const start = new Date(new Date(ready.landedAt).getTime() + 3600000);
  await FlightService.launch(v.id, await freeNear(v, cfg), { now: start });
  const ctx = await ctxOf(v.id, new Date(start.getTime() + 1000));
  await assert.rejects(CommandService.plan(ctx, { x: bob.x, y: bob.y, units: { spear: 1 }, type: 'attack' }), /en vol/);
  await FlightService.landDue(new Date(start.getTime() + 86400000));
});

test('règles du vol : case prise, trop loin, monde classique', async () => {
  const v = await Village.findByPk(zep.id);
  const cfg = (await VillageService.cachedWorld(v.worldId)).getConfig();
  const later = new Date(T0.getTime() + 10 * 86400000);
  const bob = await Village.findOne({ where: { worldId: v.worldId, playerId: { [require('sequelize').Op.ne]: v.playerId } } });
  await assert.rejects(FlightService.launch(v.id, { x: bob.x, y: bob.y }, { now: later }), /pas libre/);
  await assert.rejects(FlightService.launch(v.id, { x: v.x + 40, y: v.y }, { now: later }), /Trop loin/);
  await assert.rejects(FlightService.launch(other.id, { x: other.x + 2, y: other.y }, { now: later }), /mode Zeppelin/);
  assert.equal(cfg.zeppelin.maxDistance, 25);
  assert.equal(await ShipFlight.count({ where: { villageId: other.id } }), 0);
});

test('pages : habillage Zeppelin sur son monde, jeu de base inchangé ailleurs', async () => {
  const app = createApp();
  await app.sessionStore.sync();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const http = async (path, { method = 'GET', form, json } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(json ? { accept: 'application/json' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
  try {
    const login = await http('/login');
    const token = login.html.match(/name="_csrf" value="([^"]+)"/)[1];
    await http('/login', { method: 'POST', form: { login: 'Alice', password: 'motdepasse', _csrf: token } });

    const page = await http(`/village/${zep.id}`);
    assert.equal(page.status, 200);
    assert.match(page.html, /data-mode="zeppelin"/);
    assert.match(page.html, /data-game-style="roman"/);
    assert.match(page.html, /Poste de pilotage/);
    assert.match(page.html, /Salle des machines/);
    assert.match(page.html, /zeppelin\/move/);
    assert.match(page.html, /zeppelin-resource--wood/);
    assert.doesNotMatch(page.html, /Camp de bois/);

    const map = await http(`/village/${zep.id}/map`);
    assert.match(map.html, /\/js\/modes\/zeppelin-map\.js/);
    const flights = JSON.parse((await http(`/village/${zep.id}/zeppelin/flights`, { json: true })).html);
    assert.ok(Array.isArray(flights.flights));

    const classic = await http(`/village/${other.id}`);
    assert.equal(classic.status, 200);
    assert.doesNotMatch(classic.html, /data-mode=/);
    assert.match(classic.html, /Quartier général/);
    assert.match(classic.html, /Camp de bois/);
    assert.equal((await http(`/village/${other.id}/zeppelin/flights`, { json: true })).status, 404);
    assert.doesNotMatch((await http(`/village/${other.id}/map`)).html, /zeppelin-map/);

    // Lobby : sous-sélecteur des modes, liste filtrée, mode affiché sur la fiche.
    const all = await http('/worlds');
    assert.match(all.html, /href="\/worlds\?mode=zeppelin"/);
    const onlyZep = (await http('/worlds?mode=zeppelin')).html;
    assert.match(onlyZep, /Zeppelin · Vitesse ×10/);
    assert.doesNotMatch(onlyZep, />Classique<\/span>/);
    assert.match((await http('/worlds?w=zep')).html, /vaisseau à 30 min par case/);
  } finally {
    server.close();
  }
});
