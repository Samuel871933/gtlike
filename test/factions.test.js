'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, PlayerAchievement } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const CommandService = require('../src/services/CommandService');
const VictoryService = require('../src/services/VictoryService');
const serverSettings = require('../src/game/serverSettings');

const DAY = 86400000;
let n = 0;

async function user(name) {
  return AuthService.register({ username: `${name}${n}`, email: `${name}${n}@example.com`, password: 'motdepasse' });
}

/** Monde à factions vide (sans barbares ni protection des débutants). */
async function factionWorld(config = {}) {
  n += 1;
  const slug = `f${n}`;
  const world = await WorldService.createWorld({
    slug, name: slug, config: { newbieDays: 0, placement: { emptyVillages: 0 }, factions: { active: true }, ...config },
  });
  return { world, slug };
}

test.before(() => sequelize.sync({ force: true }));
test.after(() => sequelize.close());

test('monde à factions : faction obligatoire à l’inscription, gardée pour toute la partie', async () => {
  const { slug } = await factionWorld();
  const alice = await user('Alice');
  await assert.rejects(WorldService.join(alice, slug), /Choisis ta faction/);
  await assert.rejects(WorldService.join(alice, slug, { faction: 'gobelin' }), /Choisis ta faction/);
  const { player, village } = await WorldService.join(alice, slug, { faction: 'dwarf' });
  assert.equal(player.faction, 'dwarf');

  // Après la perte de tous ses villages, on recommence dans la même faction (la nouvelle saisie est ignorée).
  await Village.update({ playerId: null }, { where: { id: village.id } });
  const again = await WorldService.join(alice, slug, { faction: 'orc' });
  assert.equal((await Player.findByPk(again.player.id)).faction, 'dwarf');
});

test('monde sans factions : aucune faction enregistrée', async () => {
  n += 1;
  await WorldService.createWorld({ slug: `c${n}`, name: `c${n}`, config: { placement: { emptyVillages: 0 } } });
  const { player } = await WorldService.join(await user('Carl'), `c${n}`, { faction: 'elf' });
  assert.equal(player.faction, null);
});

test('une tribu prend la faction de son fondateur et n’accueille qu’elle', async () => {
  const { slug } = await factionWorld();
  const { player: elf } = await WorldService.join(await user('Elf'), slug, { faction: 'elf' });
  const { player: elf2 } = await WorldService.join(await user('Elf2'), slug, { faction: 'elf' });
  const { player: orc } = await WorldService.join(await user('Orc'), slug, { faction: 'orc' });
  const tribe = await TribeService.create(elf.id, { name: `Sylve ${n}`, tag: `S${n}` });
  assert.equal(tribe.faction, 'elf');
  await assert.rejects(TribeService.invite(elf.id, orc.name), /réservée à la faction des elfes/);
  await TribeService.invite(elf.id, elf2.name);
  const invite = await require('../src/models').TribeInvite.findOne({ where: { playerId: elf2.id } });
  await TribeService.acceptInvite(elf2.id, invite.id);
  assert.equal((await Player.findByPk(elf2.id)).tribeId, tribe.id);
});

test('attaque entre membres d’une faction : réglage du monde', async () => {
  for (const noHarm of [true, false]) {
    const { slug } = await factionWorld({ factions: { active: true, noHarm } });
    const { village: a } = await WorldService.join(await user('Att'), slug, { faction: 'human' });
    const { village: b } = await WorldService.join(await user('Def'), slug, { faction: 'human' });
    await Village.update({ units: { axe: 10 }, buildings: { ...a.buildings, place: 1 } }, { where: { id: a.id } });
    const send = CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { axe: 1 } });
    if (noHarm) await assert.rejects(send, /joueur de votre faction/);
    else assert.ok(await send);
  }
});

test('domination par faction : villages additionnés, victoire et succès pour toute la faction', async () => {
  const { world, slug } = await factionWorld({
    victory: { type: 'dominance', dominance: { warningPercent: 30, warningWorldAgeDays: 0, endgamePercent: 60, minWorldAgeDays: 0, holdDays: 1 } },
  });
  // Deux nains dans deux tribus différentes (et un sans tribu) contre un orque : la faction naine détient 3 villages sur 4.
  const { player: d1 } = await WorldService.join(await user('Nain1'), slug, { faction: 'dwarf' });
  const { player: d2 } = await WorldService.join(await user('Nain2'), slug, { faction: 'dwarf' });
  const { player: d3 } = await WorldService.join(await user('Nain3'), slug, { faction: 'dwarf' });
  const { player: orc } = await WorldService.join(await user('Orque'), slug, { faction: 'orc' });
  await TribeService.create(d1.id, { name: `Forge ${n}`, tag: `F${n}` });
  await TribeService.create(d2.id, { name: `Enclume ${n}`, tag: `E${n}` });
  await TribeService.create(orc.id, { name: `Horde ${n}`, tag: `H${n}` });

  const now = new Date();
  const s = await VictoryService.standings(world, now);
  assert.equal(s.leader.id, 'dwarf');
  assert.equal(s.leader.name, 'Nains');
  assert.equal(s.leader.percent, 75);
  assert.ok(s.met);

  await VictoryService.check(world.id, now);
  await world.reload();
  assert.equal(world.victoryState.holderName, 'Nains');
  const { Report } = require('../src/models');
  assert.ok(await Report.findOne({ where: { playerId: orc.id, title: 'Les Nains approchent de la victoire' } }));
  const started = await Report.findOne({ where: { playerId: orc.id, title: 'Fin de partie enclenchée : Nains' } });
  assert.match(started.data.text, /^Les Nains remplissent la condition de victoire\. S'ils la tiennent/);
  await VictoryService.check(world.id, new Date(now.getTime() + 2 * DAY));
  await world.reload();
  assert.ok(world.endedAt);
  assert.equal(world.winnerFaction, 'dwarf');
  assert.equal(world.winnerTribeId, null);
  assert.ok(await Report.findOne({ where: { playerId: orc.id, title: 'Les Nains ont gagné le monde !' } }));
  for (const p of [d1, d2, d3]) assert.ok(await PlayerAchievement.findOne({ where: { playerId: p.id, key: 'worldWinner' } }), p.name);
  assert.equal(await PlayerAchievement.count({ where: { playerId: orc.id, key: 'worldWinner' } }), 0);
});

test('les bots rejoignent la faction la moins peuplée', async () => {
  const { world, slug } = await factionWorld();
  for (const f of ['elf', 'dwarf', 'orc']) await WorldService.join(await user(`J${f}`), slug, { faction: f });
  const { player } = await WorldService.joinBot(world, { name: `Bot${n}` });
  assert.equal(player.faction, 'human');
});

test('création de serveur : réglages des factions', () => {
  const body = {};
  for (const s of serverSettings.SETTINGS) body[s.key] = serverSettings.formValue(s);
  for (const [k, v] of Object.entries(body)) if (typeof v === 'boolean') body[k] = v ? '1' : '';
  body['factions.active'] = '1';
  body['factions.noHarm'] = '1';
  const { config, error } = serverSettings.parse(body);
  assert.equal(error, undefined);
  assert.deepEqual(config.factions, { active: true, noHarm: true });
});

test('pages : choix de la faction à l’inscription, création de serveur, fin du monde et profils', async () => {
  const createApp = require('../src/app');
  const { slug } = await factionWorld({ factions: { active: true, noHarm: true } });
  const app = createApp();
  await app.sessionStore.sync();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const http = async (path, form) => {
    const res = await fetch(base + path, {
      method: form ? 'POST' : 'GET', redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
  const token = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  try {
    const reg = await http('/register');
    await http('/register', { username: `Web${n}`, email: `web${n}@example.com`, password: 'motdepasse', _csrf: token(reg.html) });
    // La fiche du monde mène à la page d'entrée, une étape par choix : faction, puis position de départ.
    const sheet = await http(`/worlds?w=${slug}`);
    assert.match(sheet.html, new RegExp(`href="/worlds/${slug}/join"`));
    const step1 = await http(`/worlds/${slug}/join`);
    assert.match(step1.html, /Choisis ton peuple/);
    assert.match(step1.html, /étape 1 sur 2/);
    assert.match(step1.html, /name="faction" value="orc"/);
    // Étape 2 sans faction choisie : retour à l'étape 1.
    assert.match((await http(`/worlds/${slug}/join?step=1`)).html, /Choisis ton peuple/);
    const step2 = await http(`/worlds/${slug}/join?step=1&faction=orc`);
    assert.match(step2.html, /Où fonder ton village/);
    assert.match(step2.html, /<input type="hidden" name="faction" value="orc">/);
    assert.match(step2.html, /Faction <span[^>]*>Orques<\/span>/);
    // Faction manquante à l'envoi : retour à la page d'entrée avec l'erreur.
    const refused = await http(`/worlds/${slug}/join`, { direction: 'ne', _csrf: token(step2.html) });
    assert.equal(refused.location, `/worlds/${slug}/join?direction=ne`);
    const joined = await http(`/worlds/${slug}/join`, { direction: 'random', faction: 'orc', _csrf: token(step2.html) });
    assert.equal(joined.status, 302);
    assert.match(joined.location, /^\/village\/\d+$/);
    // Déjà en jeu : la page d'entrée renvoie dans le monde.
    assert.equal((await http(`/worlds/${slug}/join`)).location, `/worlds/${slug}/play`);
    const vid = joined.location.split('/').pop();

    const victory = await http(`/village/${vid}/ranking?type=victory`);
    assert.equal(victory.status, 200);
    assert.match(victory.html, /Top des factions par dominance/);
    assert.match(victory.html, /Votre faction/);
    const player = await Player.findOne({ where: { name: `Web${n}` } });
    assert.match((await http(`/village/${vid}/players/${player.id}`)).html, /Orques/);
    const tribe = await TribeService.create(player.id, { name: `Clan ${n}`, tag: `K${n}` });
    assert.match((await http(`/village/${vid}/tribes/${tribe.id}`)).html, /Faction des orques/);
    assert.match((await http(`/worlds/${slug}/info`)).html, /Attaque dans sa faction/);
    assert.match((await http('/servers/new')).html, /Attaque interdite entre membres d’une faction/);
  } finally {
    server.close();
  }
});

test('monde officiel LOTR 1 : monde à factions', async () => {
  const { WORLDS } = require('../scripts/seed');
  const lotr = WORLDS.find((w) => w.slug === 'lotr1');
  assert.equal(lotr.name, 'LOTR 1');
  assert.equal(new (require('../src/game/WorldConfig'))(lotr.config).factions.active, true);
});

test('monde sans factions : une seule étape, la position de départ', async () => {
  const createApp = require('../src/app');
  n += 1;
  await WorldService.createWorld({ slug: `s${n}`, name: `s${n}`, config: { placement: { emptyVillages: 0 } } });
  const app = createApp();
  await app.sessionStore.sync();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const http = async (path, form) => {
    const res = await fetch(base + path, {
      method: form ? 'POST' : 'GET', redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
  try {
    const reg = await http('/register');
    await http('/register', { username: `Solo${n}`, email: `solo${n}@example.com`, password: 'motdepasse', _csrf: reg.html.match(/name="_csrf" value="([^"]+)"/)[1] });
    const page = (await http(`/worlds/s${n}/join`)).html;
    assert.match(page, /Où fonder ton village/);
    assert.match(page, /étape 1 sur 1/);
    assert.match(page, /Fonder mon village/);
    assert.doesNotMatch(page, /name="faction"/);
  } finally {
    server.close();
  }
});

test('designs des factions : offerts et par défaut sur un monde à factions, en vente ailleurs', async () => {
  const ShopService = require('../src/services/ShopService');
  const catalog = require('../src/game/shopCatalog');
  const { villageDesignFor } = require('../src/web/villageDesigns');
  for (const id of ['humains', 'elfes', 'nains', 'orques']) assert.ok(catalog.item(`design:${id}`), id);

  const { world, slug } = await factionWorld();
  n += 1;
  const other = await WorldService.createWorld({ slug: `o${n}`, name: `o${n}`, config: { placement: { emptyVillages: 0 } } });
  const u = await user('Gimli');
  const { player } = await WorldService.join(u, slug, { faction: 'dwarf' });
  await WorldService.join(u, other.slug);

  const here = await ShopService.rightsFor(u.id, world.id);
  assert.ok(here.has('design:nains'));
  assert.ok(!here.has('design:elfes'));
  assert.ok(!(await ShopService.rightsFor(u.id, other.id)).has('design:nains'), 'pas offert hors du monde à factions');
  assert.ok((await ShopService.rightsByUser([u.id], world.id)).get(u.id).has('design:nains'));

  // Design par défaut : celui de la faction (même si le compte a choisi Beige), un design acheté et choisi reste prioritaire.
  assert.equal(villageDesignFor(u, here, player.faction).id, 'nains');
  assert.equal(villageDesignFor({ villageDesign: 'beige' }, here, 'dwarf').id, 'nains');
  assert.equal(villageDesignFor({ villageDesign: 'noir' }, here, 'dwarf').id, 'nains', 'non possédé : design de la faction');
  assert.equal(villageDesignFor({ villageDesign: 'noir' }, new (here.constructor)(['design:noir']), 'dwarf').id, 'noir');
  assert.equal(villageDesignFor(null, null, 'orc').id, 'orques', 'bots');
  assert.equal(villageDesignFor({ villageDesign: 'nains' }, await ShopService.rightsFor(u.id, other.id), null).id, 'beige');
});

test('carte : les villages de ta faction alimentent le calque « Influence de ta faction »', async () => {
  const mapView = require('../src/web/mapView');
  const { slug, world } = await factionWorld();
  const me = await WorldService.join(await user('CarteA'), slug, { faction: 'elf' });
  const ally = await WorldService.join(await user('CarteB'), slug, { faction: 'elf' });
  const foe = await WorldService.join(await user('CarteC'), slug, { faction: 'orc' });
  const vc = await mapView.viewContext(me.village, world.getConfig());
  const cellAt = async (v) => {
    const data = await mapView.sector(vc, Math.floor(v.x / mapView.SECTOR), Math.floor(v.y / mapView.SECTOR));
    const sectors = Array.isArray(data) ? data : data.sectors || [data];
    return sectors.flatMap((s) => s.cells || []).find((c) => c.x === v.x && c.y === v.y);
  };
  assert.equal((await cellAt(ally.village)).faction, 1);
  assert.equal((await cellAt(foe.village)).faction, '');
  assert.equal((await cellAt(me.village)).faction, '', 'ses propres villages relèvent du calque de la tribu');
});
