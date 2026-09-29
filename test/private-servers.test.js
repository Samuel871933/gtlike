'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World } = require('../src/models');
const createApp = require('../src/app');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const PrivateServerService = require('../src/services/PrivateServerService');
const serverSettings = require('../src/game/serverSettings');

let server;
let base;

/** Saisie complète du formulaire avec les valeurs par défaut (comme un envoi sans rien changer). */
function defaults(extra = {}) {
  const body = {};
  for (const s of serverSettings.SETTINGS) {
    const v = serverSettings.formValue(s);
    if (s.type === 'bool') { if (v) body[s.key] = '1'; } else body[s.key] = String(v);
  }
  return { name: 'Serveur test', access: 'open', ...body, ...extra };
}

function client() {
  let cookie = '';
  return async (path, { method = 'GET', form } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
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
  const app = createApp();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await sequelize.close();
});

test('réglages : valeurs par défaut du monde, conversions d’unités, bornes refusées', () => {
  const { config, error } = serverSettings.parse(defaults({ speed: '50', luck: '10', commandCancelSeconds: '5', 'features.knight': '1', 'night.active': '1' }));
  assert.equal(error, undefined);
  assert.equal(config.speed, 50);
  assert.equal(config.luck, 0.1, '% → fraction');
  assert.equal(config.commandCancelSeconds, 300, 'minutes → secondes');
  assert.equal(config.features.knight, true);
  assert.equal(config.features.archer, false, 'case décochée');
  assert.equal(config.victory.type, 'dominance', 'seule la domination est proposée');
  assert.ok(config.victory.dominance.warningPercent < config.victory.dominance.endgamePercent);
  assert.match(serverSettings.parse(defaults({ speed: '5000' })).error, /Vitesse du monde/);
  assert.match(serverSettings.parse(defaults({ knightSystem: 'premium' })).error, /Système du paladin/);
});

test('création : serveur ouvert listé, serveur sur code caché et réservé au code', async () => {
  const owner = await AuthService.register({ username: 'Hote', email: 'h@example.com', password: 'motdepasse' });
  const open = await PrivateServerService.create(owner, defaults({ name: 'Ouvert', speed: '20' }));
  assert.equal(open.access, 'open');
  assert.equal(open.joinCode, null);
  assert.equal(open.getConfig().speed, 20);

  const secret = await PrivateServerService.create(owner, defaults({ name: 'Secret', access: 'code' }));
  assert.match(secret.joinCode, /^[A-Z2-9]{8}$/);
  assert.equal((await PrivateServerService.findByCode(secret.joinCode.toLowerCase())).id, secret.id, 'code insensible à la casse');

  assert.ok(PrivateServerService.canAccess(open, { userId: 999 }));
  assert.ok(!PrivateServerService.canAccess(secret, { userId: 999 }));
  assert.ok(PrivateServerService.canAccess(secret, { userId: 999, code: secret.joinCode }));
  assert.ok(PrivateServerService.canAccess(secret, { userId: owner.id }), 'le créateur y a toujours accès');

  // Les plus peuplés : seuls les serveurs ouverts, le plus peuplé d'abord.
  const other = await PrivateServerService.create(owner, defaults({ name: 'Peuplé' }));
  for (const name of ['Joueur1', 'Joueur2']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    await WorldService.join(u, other.slug);
  }
  const popular = await PrivateServerService.popular();
  assert.deepEqual(popular.map((p) => p.world.name), ['Peuplé', 'Ouvert']);
  assert.equal(popular[0].players, 2);

  await assert.rejects(PrivateServerService.create(owner, defaults({ name: 'Quatrième' })), /3 serveurs privés/);
  await assert.rejects(PrivateServerService.create(owner, defaults({ name: 'x' })), /3 à 32 caractères/);
});

test('parcours HTTP : formulaire, création sur code, rejoindre avec le code', async () => {
  const host = client();
  const page = await host('/register');
  await host('/register', { method: 'POST', form: { username: 'Createur', email: 'c@example.com', password: 'motdepasse', _csrf: tokenOf(page.html) } });
  const form = await host('/servers/new');
  assert.equal(form.status, 200);
  assert.match(form.html, /name="features\.knight"/);
  assert.match(form.html, /name="night\.startHour"/);

  const bad = await host('/servers', { method: 'POST', form: { ...defaults({ speed: '0' }), _csrf: tokenOf(form.html) } });
  assert.equal(bad.status, 400);
  assert.match(bad.html, /Vitesse du monde : entre/);
  assert.match(bad.html, /value="Serveur test"/, 'la saisie est conservée');

  const created = await host('/servers', { method: 'POST', form: { ...defaults({ name: 'Cercle secret', access: 'code' }), _csrf: tokenOf(form.html) } });
  assert.equal(created.status, 302);
  const world = await World.findOne({ where: { name: 'Cercle secret' } });
  assert.ok((await host(created.location)).html.includes(world.joinCode), 'le créateur voit le code à partager');

  const guest = client();
  const reg = await guest('/register');
  await guest('/register', { method: 'POST', form: { username: 'Invite', email: 'i@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const lobby = await guest('/worlds');
  assert.ok(!lobby.html.includes('Cercle secret'), 'serveur sur code absent de l’accueil');
  const refused = await guest(`/worlds/${world.slug}/join`, { method: 'POST', form: { _csrf: tokenOf(lobby.html) } });
  assert.equal(refused.status, 302, 'refusé sans le code');
  assert.equal(await sequelize.models.Player.count({ where: { worldId: world.id } }), 0);

  const found = await guest('/servers/join', { method: 'POST', form: { code: world.joinCode, _csrf: tokenOf(lobby.html) } });
  const sheet = await guest(found.location);
  assert.match(sheet.html, /Cercle secret/);
  const joined = await guest(`/worlds/${world.slug}/join`, { method: 'POST', form: { code: world.joinCode, direction: 'random', _csrf: tokenOf(sheet.html) } });
  assert.match(joined.location, /^\/village\/\d+$/);
});

test('immuable : ni nom, ni réglages, ni accès ne changent après la création ; l’état de la partie, si', async () => {
  const owner = await AuthService.register({ username: 'Fige', email: 'f@example.com', password: 'motdepasse' });
  const world = await PrivateServerService.create(owner, defaults({ name: 'Figé', speed: '10' }));
  await assert.rejects(world.update({ config: { ...world.config, speed: 500 } }), /immuable/);
  await assert.rejects(World.update({ name: 'Renommé' }, { where: { id: world.id } }), /immuable/);
  await assert.rejects(world.update({ access: 'code' }), /immuable/);
  const fresh = await World.findByPk(world.id);
  assert.equal(fresh.name, 'Figé');
  assert.equal(fresh.getConfig().speed, 10);
  // La fin de partie reste possible (VictoryService), et les mondes officiels restent réglables (scripts/seed.js).
  await fresh.update({ endedAt: new Date(), isOpen: false });
  const officiel = await WorldService.createWorld({ slug: 'off1', name: 'Officiel', config: {} });
  await officiel.update({ config: { speed: 2 } });
  assert.equal((await World.findByPk(officiel.id)).config.speed, 2);
});

test('liste des serveurs : officiels et privés ouverts, serveurs sur code cachés sauf pour leurs joueurs', async () => {
  await WorldService.createWorld({ slug: 'offl', name: 'Monde officiel liste', config: {} });
  const owner = await AuthService.register({ username: 'Listeur', email: 'l@example.com', password: 'motdepasse' });
  await PrivateServerService.create(owner, defaults({ name: 'Liste ouverte' }));
  await PrivateServerService.create(owner, defaults({ name: 'Liste cachée', access: 'code' }));

  const guest = client();
  const reg = await guest('/register');
  await guest('/register', { method: 'POST', form: { username: 'Curieux', email: 'cu@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const all = await guest('/servers');
  assert.equal(all.status, 200);
  assert.match(all.html, /Monde officiel liste/);
  assert.match(all.html, /Liste ouverte/);
  assert.ok(!all.html.includes('Liste cachée'), 'serveur sur code caché');
  const privates = await guest('/servers?type=private');
  assert.ok(!privates.html.includes('Monde officiel liste'));
  assert.match(privates.html, /Liste ouverte/);
  assert.ok(!(await guest('/servers?q=introuvable')).html.includes('Liste ouverte'));
});
