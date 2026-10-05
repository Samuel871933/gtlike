'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player } = require('../src/models');
const WorldService = require('../src/services/WorldService');
const ArmyTemplateService = require('../src/services/ArmyTemplateService');
const { hit } = require('../src/web/rateLimit');

let server;
let base;
let cookie = '';
const http = async (path, form, { json = false } = {}) => {
  const res = await fetch(base + path, {
    method: form ? 'POST' : 'GET', redirect: 'manual',
    headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(json ? { accept: 'application/json' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, location: res.headers.get('location'), html: await res.text() };
};
const token = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w', name: 'W', config: { newbieDays: 0, placement: { emptyVillages: 0 } } });
  const app = require('../src/app')();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await sequelize.close(); });

test('limite de cadence : au plus N actions par fenêtre, puis de nouveau permises', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.ok(hit('k', 5, 1000, t0 + i));
  assert.equal(hit('k', 5, 1000, t0 + 10), false);
  assert.ok(hit('k', 5, 1000, t0 + 1001), 'une seconde plus tard');
});

test('assistant de pillage : 5 attaques par seconde au plus ; collecte : choix d’un modèle d’armée', async () => {
  const reg = await http('/register');
  await http('/register', { username: 'Pilleur', email: 'p@example.com', password: 'motdepasse', _csrf: token(reg.html) });
  const lobby = await http('/worlds/w/join');
  const joined = await http('/worlds/w/join', { direction: 'random', _csrf: token(lobby.html) });
  const vid = Number(joined.location.split('/').pop());
  const village = await Village.findByPk(vid);
  await village.update({ units: { spear: 500, axe: 100, spy: 5 }, buildings: { ...village.buildings, place: 1 } });
  const player = await Player.findOne({ where: { name: 'Pilleur' } });
  const tpl = await ArmyTemplateService.create(player.id, { name: 'Raid', spear: 1, spy: 1 }, (await require('../src/models').World.findOne()).getConfig());
  const world = await require('../src/models').World.findOne();
  const targets = [];
  for (let i = 0; i < 6; i++) targets.push(await WorldService.createVillage(world, { x: village.x + 3 + i, y: village.y + 3, player: null, name: `Barbare ${i}`, buildings: { main: 1 }, now: new Date() }));

  const page = await http(`/village/${vid}/scavenge`);
  assert.match(page.html, /data-scavenge-template/);
  assert.match(page.html, />Raid</);
  assert.match(page.html, /"spear":1/);
  assert.doesNotMatch(page.html.match(/data-scavenge-templates>([^<]*)</)[1], /spy/, 'éclaireurs exclus de la collecte');

  const csrf = token(page.html);
  const statuses = [];
  for (const t of targets) statuses.push((await http(`/village/${vid}/farm/send`, { template: tpl.id, target: t.id, _csrf: csrf }, { json: true })).status);
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.equal(statuses[5], 429);
});
