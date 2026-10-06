'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Player } = require('../src/models');
const createApp = require('../src/app');
const WorldService = require('../src/services/WorldService');
const SitterService = require('../src/services/SitterService');

let server;
let base;
const accounts = {};

function client() {
  let cookie = '';
  return async (path, { method = 'GET', form } = {}) => {
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
}
const tokenOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

async function signUp(name) {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: name, email: `${name}@example.com`, password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const player = await Player.findOne({ where: { name } });
  accounts[name] = { http, village: joined.location, player };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { sitter: { allow: true, maxAccounts: 1 } } });
  const app = createApp();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const name of ['Alice', 'Bob', 'Carol']) await signUp(name);
});

test.after(async () => {
  server.close();
  await sequelize.close();
});

test('demande, acceptation, limite de comptes remplacés', async () => {
  const { Alice, Bob, Carol } = accounts;
  await assert.rejects(SitterService.invite(Alice.player.id, 'Alice'), /autre joueur/);
  await SitterService.invite(Alice.player.id, 'Bob');
  await assert.rejects(SitterService.invite(Alice.player.id, 'Carol'), /déjà un remplaçant/);

  // Tant que Bob n'a pas accepté, il n'a pas accès.
  assert.equal((await Bob.http(Alice.village)).status, 404);
  await SitterService.accept(Bob.player.id, Alice.player.id);

  await SitterService.invite(Carol.player.id, 'Bob');
  await assert.rejects(SitterService.accept(Bob.player.id, Carol.player.id), /déjà 1 comptes/);
  await SitterService.resign(Bob.player.id, Carol.player.id);
});

test('le remplaçant joue les villages, sans toucher aux réglages du compte', async () => {
  const { Alice, Bob, Carol } = accounts;
  const page = await Bob.http(Alice.village);
  assert.equal(page.status, 200);
  assert.match(page.html, /vous jouez le compte de <strong>Alice<\/strong>/);

  const main = await Bob.http(`${Alice.village}/main`);
  const built = await Bob.http(`${Alice.village}/build`, { method: 'POST', form: { building: 'wood', _csrf: tokenOf(main.html) } });
  assert.equal(built.status, 302, 'le remplaçant peut construire');

  const account = await Bob.http(`${Alice.village}/account`);
  assert.match(account.html, /réservés au titulaire du compte/);
  assert.doesNotMatch(account.html, /tab=sleep/, 'pas d’onglet Mode sommeil pour le remplaçant');
  assert.doesNotMatch((await Bob.http(`${Alice.village}/account?tab=leave`)).html, /Quitter ce monde/, 'onglet réservé : retour au thème');
  const revoke = await Bob.http(`${Alice.village}/account/sitter/revoke`, { method: 'POST', form: { _csrf: tokenOf(main.html) } });
  assert.equal(revoke.status, 302);
  assert.ok((await Player.findByPk(Alice.player.id)).sitterAcceptedAt, 'le remplaçant n’a pas pu se retirer l’accès à la place d’Alice');

  assert.equal((await Carol.http(Alice.village)).status, 404, 'un autre joueur n’a pas accès');

  const worlds = await Bob.http('/worlds');
  assert.match(worlds.html, /Vous remplacez/);
});

test('fin du remplacement par le titulaire', async () => {
  const { Alice, Bob } = accounts;
  await SitterService.revoke(Alice.player.id);
  assert.equal((await Bob.http(Alice.village)).status, 404);
});
