'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adarma-uploads-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { sequelize, Player, Tribe } = require('../src/models');
const createApp = require('../src/app');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const ImageService = require('../src/services/ImageService');

let server;
let base;

function client() {
  let cookie = '';
  return async (url, { method = 'GET', form, body } = {}) => {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : body,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
}
const tokenOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const upload = (csrf, buffer, type = 'image/png') => {
  const fd = new FormData();
  if (csrf) fd.append('_csrf', csrf);
  fd.append('image', new Blob([buffer], { type }), 'photo');
  return fd;
};
const files = () => (fs.existsSync(ImageService.DIR) ? fs.readdirSync(ImageService.DIR) : []);

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
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
});

test('images de profil : réduites en WebP, original non gardé, remplacées et supprimées', async () => {
  const http = client();
  const reg = await http('/register');
  await http('/register', { method: 'POST', form: { username: 'Alice', email: 'a@example.com', password: 'motdepasse', _csrf: tokenOf(reg.html) } });
  const worlds = await http('/worlds');
  const joined = await http('/worlds/w1/join', { method: 'POST', form: { direction: 'random', _csrf: tokenOf(worlds.html) } });
  const vid = joined.location.split('/').pop();
  const page = await http(`${joined.location}/tribe`);
  const csrf = tokenOf(page.html);
  const big = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#a33' } }).png().toBuffer();

  // Sans jeton CSRF : refusé, rien n'est écrit.
  assert.equal((await http(`/village/${vid}/profile/avatar`, { method: 'POST', body: upload(null, big) })).status, 403);
  assert.deepEqual(files(), []);
  // Fichier qui n'est pas une image : refusé.
  await http(`/village/${vid}/profile/avatar`, { method: 'POST', body: upload(csrf, Buffer.from('pas une image'), 'text/plain') });
  assert.deepEqual(files(), []);

  const ok = await http(`/village/${vid}/profile/avatar`, { method: 'POST', body: upload(csrf, big) });
  assert.equal(ok.status, 302);
  const player = await Player.findOne({ where: { name: 'Alice' } });
  assert.match(player.avatar, /^player-\d+-[0-9a-f]{8}\.webp$/);
  assert.deepEqual(files(), [player.avatar]);
  const meta = await sharp(path.join(ImageService.DIR, player.avatar)).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok(meta.width <= ImageService.MAX_WIDTH && meta.height <= ImageService.MAX_HEIGHT);
  assert.equal(meta.width, 360);
  const served = await fetch(`${base}/uploads/avatars/${player.avatar}`);
  assert.equal(served.headers.get('content-type'), 'image/webp');
  assert.match((await http(`/village/${vid}/players/${player.id}`)).html, new RegExp(player.avatar));

  // Remplacement : l'ancien fichier disparaît.
  await http(`/village/${vid}/profile/avatar`, { method: 'POST', body: upload(csrf, big) });
  await player.reload();
  assert.deepEqual(files(), [player.avatar]);
  await http(`/village/${vid}/profile/avatar/delete`, { method: 'POST', form: { _csrf: csrf } });
  await player.reload();
  assert.equal(player.avatar, null);
  assert.deepEqual(files(), []);

  // Tribu : image envoyée par le duc, effacée avec la tribu dissoute.
  await TribeService.create(player.id, { name: 'Les Loups', tag: 'LOUP' });
  await http(`/village/${vid}/tribe/avatar`, { method: 'POST', body: upload(csrf, big) });
  const tribe = await Tribe.findOne({ where: { tag: 'LOUP' } });
  assert.match(tribe.avatar, /^tribe-\d+-[0-9a-f]{8}\.webp$/);
  assert.match((await http(`/village/${vid}/tribes/${tribe.id}`)).html, new RegExp(tribe.avatar));
  // Listings : miniatures dans les classements des joueurs et des tribus, et dans la liste des membres.
  await http(`/village/${vid}/profile/avatar`, { method: 'POST', body: upload(csrf, big) });
  await player.reload();
  assert.match((await http(`/village/${vid}/ranking?type=players`)).html, new RegExp(player.avatar));
  assert.match((await http(`/village/${vid}/ranking?type=tribes`)).html, new RegExp(tribe.avatar));
  assert.match((await http(`/village/${vid}/tribes/${tribe.id}`)).html, new RegExp(player.avatar));
  const members = (await http(`/village/${vid}/tribe?tab=members`)).html;
  assert.match(members, new RegExp(player.avatar));
  assert.match(members, new RegExp(tribe.avatar), 'en-tête de la tribu : son image au lieu du blason');
  assert.match((await http(`/village/${vid}/players/${player.id}`)).html, new RegExp(tribe.avatar), 'profil joueur : image de sa tribu');
  await http(`/village/${vid}/profile/avatar/delete`, { method: 'POST', form: { _csrf: csrf } });
  await TribeService.leave(player.id);
  assert.deepEqual(files(), []);
});

test('images de profil : jamais de fichier orphelin (envois simultanés, compte supprimé, nettoyage)', async () => {
  const AccountService = require('../src/services/AccountService');
  const player = await Player.findOne({ where: { name: 'Alice' } });
  const small = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#3a3' } }).png().toBuffer();

  // Deux envois simultanés à partir du même enregistrement (ancien nom périmé) : un seul fichier reste.
  const a = await Player.findByPk(player.id);
  const b = await Player.findByPk(player.id);
  await Promise.all([ImageService.replaceAvatar(a, 'player', small), ImageService.replaceAvatar(b, 'player', small)]);
  await player.reload();
  assert.deepEqual(files(), [player.avatar]);

  // Enregistrement disparu entre-temps : le nouveau fichier n'est pas gardé.
  const ghost = Player.build({ id: 999999 });
  await assert.rejects(ImageService.replaceAvatar(ghost, 'player', small));
  assert.deepEqual(files(), [player.avatar]);

  // Nettoyage : un fichier non référencé est supprimé passé le délai de grâce, pas avant ; l'image utilisée reste.
  fs.writeFileSync(path.join(ImageService.DIR, 'player-1-deadbeef.webp'), 'x');
  assert.equal(await ImageService.sweepOrphans(), 0);
  assert.equal(await ImageService.sweepOrphans({ now: Date.now() + 2 * 60 * 60000 }), 1);
  assert.deepEqual(files(), [player.avatar]);

  // Compte supprimé : son image part avec lui.
  await AccountService.deleteAccount(player.userId, 'motdepasse');
  assert.deepEqual(files(), []);
});
