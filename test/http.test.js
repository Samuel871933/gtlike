'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize } = require('../src/models');
const createApp = require('../src/app');
const WorldService = require('../src/services/WorldService');

let server;
let base;

/** Petit client HTTP qui garde le cookie de session. */
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

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  const app = createApp();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await sequelize.close();
});

test('CSRF : un formulaire sans jeton est refusé, avec le jeton il passe', async () => {
  const http = client();
  const page = await http('/register');
  const form = { username: 'Alice', email: 'a@example.com', password: 'motdepasse' };

  const refused = await http('/register', { method: 'POST', form });
  assert.equal(refused.status, 403);
  const wrong = await http('/register', { method: 'POST', form: { ...form, _csrf: 'faux' } });
  assert.equal(wrong.status, 403);

  const ok = await http('/register', { method: 'POST', form: { ...form, _csrf: tokenOf(page.html) } });
  assert.equal(ok.status, 302);
  assert.equal(ok.location, '/worlds');
});

test('parcours complet : inscription, entrée dans un monde, construction', async () => {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Bob', email: 'b@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });

  // Le jeton change à la connexion (nouvelle session) : on le relit sur la page suivante.
  const worlds = await http('/worlds');
  assert.equal(worlds.status, 200);
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  assert.match(joined.location, /^\/village\/\d+$/);

  const main = await http(`${joined.location}/main`);
  const built = await http(`${joined.location}/build`, { method: 'POST', form: { building: 'wood', _csrf: tokenOf(main.html) } });
  assert.equal(built.status, 302);
  const after = await http(`${joined.location}/main`);
  assert.match(after.html, /Camp de bois <span class="font-medium text-parchment-500">niveau 1<\/span>/);

  // Style de jeu : romain par défaut en jeu, choix enregistré sur le compte, page d'accueil jamais stylée.
  assert.match(after.html, /data-game-style="roman"/);
  const styled = await http(`${joined.location}/account/game-style`, { method: 'POST', form: { style: 'viking', _csrf: tokenOf(after.html) } });
  assert.equal(styled.status, 302);
  assert.match((await http(joined.location)).html, /class="h-full scheme-dark game_style" data-game-style="viking"/);
  assert.doesNotMatch((await http('/worlds')).html, /data-game-style/);
  const unknown = await http(`${joined.location}/account/game-style`, { method: 'POST', form: { style: 'inconnu', _csrf: tokenOf(after.html) } });
  assert.equal(unknown.status, 302);
  assert.match((await http(joined.location)).html, /data-game-style="viking"/);

  for (const page of ['', '/place', '/map', '/reports', '/messages', '/tribe', '/market', '/ranking', '/ranking?type=continent', '/victory']) {
    const r = await http(joined.location + page);
    assert.ok([200, 302].includes(r.status), `${page} → ${r.status}`);
  }
});
