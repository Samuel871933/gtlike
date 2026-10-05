'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Village, Player, Seal, SealEvent, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const SealService = require('../src/services/SealService');
const CommandService = require('../src/services/CommandService');
const VillageService = require('../src/services/VillageService');
const WorldConfig = require('../src/game/WorldConfig');
const VillageState = require('../src/game/VillageState');
const seals = require('../src/game/seals');

const HOUR = 3600000;
let n = 0;

async function world({ privateServer = false, config = {} } = {}) {
  n += 1;
  return World.create({
    slug: `s${n}`, name: `s${n}`, ...(privateServer ? { access: 'open', ownerUserId: null } : {}),
    config: { newbieDays: 0, placement: { emptyVillages: 0 }, features: { seals: true }, ...config },
  });
}
async function join(w, name) {
  const user = await AuthService.register({ username: `${name}${n}`, email: `${name}${n}@example.com`, password: 'motdepasse' });
  const { player, village } = await WorldService.join(user, w.slug);
  return { user, player, village };
}
const give = (userId, type, level, count) => Seal.create({ userId, type, level, count });

test.before(() => sequelize.sync({ force: true }));
test.after(() => sequelize.close());

test('règles : bonus des 8 types (valeurs de GT), chance ramenée vers 0, module éteint sans effet', () => {
  assert.equal(seals.TYPES.length, 8);
  assert.deepEqual(seals.type('production').values, [4, 6, 8, 10, 12, 14, 16, 17, 18]);
  assert.equal(seals.value('coin', 9), 24);
  assert.ok(Math.abs(seals.reduceLuck(0.2, { type: 'luck', level: 2 }) - 0.12) < 1e-9);
  assert.equal(seals.reduceLuck(-0.05, { type: 'luck', level: 1 }), -0);
  const on = new WorldConfig({ features: { seals: true } });
  const off = new WorldConfig({});
  const data = { buildings: { wood: 10, farm: 10, barracks: 1 }, units: {}, wood: 0, stone: 0, iron: 0, resourcesAt: new Date() };
  const plain = new VillageState(data, on);
  const prod = new VillageState({ ...data, sealType: 'production', sealLevel: 9 }, on);
  assert.ok(Math.abs(prod.productionPerHour().wood / plain.productionPerHour().wood - 1.18) < 1e-9);
  assert.equal(new VillageState({ ...data, sealType: 'production', sealLevel: 9 }, off).productionPerHour().wood, plain.productionPerHour().wood);
  const farm = new VillageState({ ...data, sealType: 'population', sealLevel: 9 }, on);
  assert.equal(farm.farmCapacity(), Math.floor(plain.farmCapacity() * 1.1));
  assert.ok(Math.abs(new VillageState({ ...data, sealType: 'recruit', sealLevel: 9 }, on).recruitFactor() - 1 / 1.2) < 1e-9);
});

test('gains : succès, nobles, unités vaincues sur un monde officiel ; rien sur un serveur privé', async () => {
  const official = await world();
  const { user, player } = await join(official, 'Gain');
  const rng = () => 0; // premier type : production
  assert.deepEqual(await SealService.onAchievement(player, { name: 'Test' }, 3, { rng }), { type: 'production', level: 3 });
  await SealService.onNobles(player.id, 2, { rng });
  await player.update({ stats: { unitsKilled: SealService.killsNeeded(1) } });
  await sequelize.transaction((t) => SealService.onKills(player.id, { t, rng }));
  const inv = await SealService.inventory(user.id);
  assert.equal(inv.get('production:3').count, 1);
  assert.equal(inv.get('production:1').count, 2, 'un sceau par noble');
  assert.equal(inv.get('production:2').count, 2, 'deux paliers d’unités vaincues');
  assert.equal((await Player.findByPk(player.id)).stats.sealKillSteps, 2);
  assert.ok(await Report.findOne({ where: { playerId: player.id, title: 'Nouveau sceau : Production 3' } }));
  assert.equal(await SealEvent.count({ where: { userId: user.id } }), 5);

  const priv = await world({ privateServer: true });
  const other = await join(priv, 'Prive');
  assert.equal(await SealService.onAchievement(other.player, { name: 'Test' }, 2, { rng }), null);
  assert.equal(await Seal.count({ where: { userId: other.user.id } }), 0);
  // Module éteint sur un monde officiel : pas de gain non plus.
  const plain = await world({ config: { features: { seals: false } } });
  const third = await join(plain, 'Sans');
  assert.equal(await SealService.onAchievement(third.player, { name: 'Test' }, 2, { rng }), null);
});

test('pose : un sceau par village, verrou de 24 h, pas plus de sceaux posés que possédés', async () => {
  const w = await world();
  const { user, player, village } = await join(w, 'Pose');
  const v2 = await WorldService.createVillage(w, { x: village.x + 5, y: village.y + 5, player, name: 'B', buildings: { main: 1, farm: 1 }, now: new Date() });
  await give(user.id, 'defense', 2, 1);
  await give(user.id, 'attack', 1, 1);
  const t0 = new Date();
  await SealService.assign(player.id, village.id, { type: 'defense', level: 2 }, { now: t0 });
  await assert.rejects(SealService.assign(player.id, v2.id, { type: 'defense', level: 2 }, { now: t0 }), /pas de sceau libre/);
  await assert.rejects(SealService.assign(player.id, village.id, { type: 'attack', level: 1 }, { now: new Date(t0.getTime() + HOUR) }), /qu’à partir du/);
  await assert.rejects(SealService.remove(player.id, village.id, { now: new Date(t0.getTime() + 23 * HOUR) }), /qu’à partir du/);
  await SealService.assign(player.id, village.id, { type: 'attack', level: 1 }, { now: new Date(t0.getTime() + 25 * HOUR) });
  assert.equal((await Village.findByPk(village.id)).sealType, 'attack');
  // Le sceau de défense est redevenu libre : il peut aller sur l'autre village.
  await SealService.assign(player.id, v2.id, { type: 'defense', level: 2 }, { now: new Date(t0.getTime() + 25 * HOUR) });
  const inv = await SealService.inventory(user.id);
  assert.equal(inv.get('defense:2').available, 0);
  assert.equal(inv.get('defense:2').placed, 1);
  // Monde terminé : les sceaux posés redeviennent libres.
  await w.update({ endedAt: new Date(), isOpen: false });
  assert.equal((await SealService.inventory(user.id)).get('defense:2').available, 1);
});

test('fusion : 3 sceaux libres identiques donnent un sceau du niveau supérieur, même type', async () => {
  const w = await world();
  const { user, player, village } = await join(w, 'Fusion');
  await give(user.id, 'luck', 4, 4);
  await SealService.assign(player.id, village.id, { type: 'luck', level: 4 });
  await SealService.merge(user.id, { type: 'luck', level: 4 });
  const inv = await SealService.inventory(user.id);
  assert.equal(inv.get('luck:4').count, 1, 'reste le sceau posé');
  assert.equal(inv.get('luck:5').count, 1);
  await assert.rejects(SealService.merge(user.id, { type: 'luck', level: 4 }), /3 sceaux libres/);
  await give(user.id, 'coin', 9, 3);
  await assert.rejects(SealService.merge(user.id, { type: 'coin', level: 9 }), /ne peut plus être fusionné/);
});

test('échange en tribu : 1 contre 1 au même niveau, mondes officiels seulement', async () => {
  const w = await world();
  const a = await join(w, 'Troc');
  const b = await join(w, 'Troque');
  await give(a.user.id, 'attack', 3, 1);
  await give(b.user.id, 'haul', 3, 1);
  await assert.rejects(SealService.propose(a.player.id, { to: b.player.id, giveType: 'attack', wantType: 'haul', level: 3 }), /membre de sa tribu/);
  const tribe = await TribeService.create(a.player.id, { name: `Troc ${n}`, tag: `T${n}` });
  await b.player.update({ tribeId: tribe.id, tribeRole: 'member' });
  const trade = await SealService.propose(a.player.id, { to: b.player.id, giveType: 'attack', wantType: 'haul', level: 3 });
  await SealService.accept(b.player.id, trade.id);
  const ia = await SealService.inventory(a.user.id);
  const ib = await SealService.inventory(b.user.id);
  assert.equal(ia.get('haul:3').count, 1);
  assert.equal(ia.get('attack:3')?.count || 0, 0);
  assert.equal(ib.get('attack:3').count, 1);

  const priv = await world({ privateServer: true });
  const c = await join(priv, 'TrocPrive');
  await give(c.user.id, 'attack', 1, 1);
  await assert.rejects(SealService.propose(c.player.id, { to: c.player.id, giveType: 'attack', wantType: 'haul', level: 1 }), /mondes officiels/);
});

test('combat : sceau d’attaque dans le rapport, conquête qui libère le sceau du village', async () => {
  const w = await world();
  const att = await join(w, 'Att');
  const def = await join(w, 'Def');
  await give(att.user.id, 'attack', 9, 1);
  await give(def.user.id, 'defense', 1, 1);
  await SealService.assign(att.player.id, att.village.id, { type: 'attack', level: 9 });
  await SealService.assign(def.player.id, def.village.id, { type: 'defense', level: 1 });
  await Village.update({ units: { axe: 30 }, buildings: { ...att.village.buildings, place: 1 } }, { where: { id: att.village.id } });
  const cmd = await CommandService.send(att.village.id, { x: def.village.x, y: def.village.y, type: 'attack', units: { axe: 30 } });
  await CommandService.processDue(new Date(new Date(cmd.arrivesAt).getTime() + 1000));
  const report = await Report.findOne({ where: { playerId: att.player.id, type: 'attack' }, order: [['id', 'DESC']] });
  assert.deepEqual(report.data.seals, { attacker: 'Attaque 9', defender: 'Défense 1' });

  // Conquête : le sceau du défenseur quitte le village et redevient libre.
  const target = await Village.findByPk(def.village.id);
  await sequelize.transaction(async (t) => {
    await CommandService.handOver(target, t);
    target.playerId = att.player.id;
    await target.save({ transaction: t });
  });
  assert.equal((await Village.findByPk(def.village.id)).sealType, null);
  assert.equal((await SealService.inventory(def.user.id)).get('defense:1').available, 1);
  void VillageService;
});

test('page des sceaux : grille, sceau du village, pose depuis la page', async () => {
  const createApp = require('../src/app');
  const w = await world();
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
    await http('/register', { username: `Page${n}`, email: `page${n}@example.com`, password: 'motdepasse', _csrf: token(reg.html) });
    const lobby = await http(`/worlds/${w.slug}/join`);
    const joined = await http(`/worlds/${w.slug}/join`, { direction: 'random', _csrf: token(lobby.html) });
    const vid = joined.location.split('/').pop();
    const player = await Player.findOne({ where: { name: `Page${n}` } });
    await give(player.userId, 'production', 2, 1);
    const page = await http(`/village/${vid}/seals?t=production&l=2`);
    assert.equal(page.status, 200);
    assert.match(page.html, /Production de ressources/);
    assert.match(page.html, /Poser sur/);
    const done = await http(`/village/${vid}/seals/assign`, { type: 'production', level: '2', _csrf: token(page.html) });
    assert.equal(done.status, 302);
    assert.equal((await Village.findByPk(vid)).sealType, 'production');
    assert.match((await http(`/village/${vid}`)).html, /Production 2/, 'case Sceau de l’aperçu');
    const off = await world({ config: { features: { seals: false } } });
    void off;
  } finally {
    server.close();
  }
});
