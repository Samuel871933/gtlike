'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, BuildReward, Report, World } = require('../src/models');
const createApp = require('../src/app');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TutorialService = require('../src/services/TutorialService');
const BuildRewardService = require('../src/services/BuildRewardService');
const tutorial = require('../src/game/tutorial');

let world;
let alice;
let home;
let server;
let base;

const cfg = () => world.getConfig();
const reload = async () => { alice = await Player.findByPk(alice.id); };
const setBuildings = async (b) => {
  const v = await Village.findByPk(home.id);
  await v.update({ buildings: { ...v.buildings, ...b } });
};

test.before(async () => {
  await sequelize.sync({ force: true });
  world = await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  const u = await AuthService.register({ username: 'Alice', email: 'alice@example.com', password: 'motdepasse' });
  ({ player: alice, village: home } = await WorldService.join(u, 'w1'));
  const app = createApp();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await sequelize.close();
});

test('liste : numéros uniques, quêtes retirées des mondes sans la fonctionnalité', () => {
  const ids = tutorial.QUESTS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(tutorial.quests(cfg()).some((q) => q.link === 'scavenge'));
  const noScavenge = { ...cfg(), scavenging: { ...cfg().scavenging, active: false } };
  assert.ok(!tutorial.quests(noScavenge).some((q) => q.link === 'scavenge'));
});

test('une quête à la fois, dans l’ordre ; objectif vérifié ; une seule récompense', async () => {
  let s = await TutorialService.state(alice, cfg());
  assert.equal(s.current.id, 1);
  assert.equal(s.progress.done, false);
  await assert.rejects(TutorialService.complete(alice, cfg(), 1), /pas encore atteint/);
  await assert.rejects(TutorialService.complete(alice, cfg(), 2), /déjà terminée/, 'pas la quête en cours');

  await setBuildings({ wood: 1, stone: 1, iron: 1 });
  s = await TutorialService.state(alice, cfg());
  assert.equal(s.progress.done, true);
  await TutorialService.complete(alice, cfg(), 1);
  await assert.rejects(TutorialService.complete(alice, cfg(), 1), /déjà terminée/);
  const [reward] = await BuildRewardService.pending(alice.id);
  assert.deepEqual({ building: reward.building, level: reward.level, wood: reward.wood }, { building: 'quest', level: 1, wood: 200 });

  // Objectif chiffré : progression « a / b ».
  s = await TutorialService.state(alice, cfg());
  assert.equal(s.current.id, 2);
  assert.deepEqual({ have: s.progress.goals[0].have, need: s.progress.goals[0].need }, { have: 1, need: 3 });
});

test('objectifs : village renommé, rapport lu, tribu ; troupes livrées si la ferme a la place', async () => {
  await setBuildings({ main: 3 });
  await TutorialService.complete(alice, cfg(), 2);
  assert.equal((await TutorialService.state(alice, cfg())).progress.done, false, 'nom par défaut');
  await Village.update({ name: 'Bastion' }, { where: { id: home.id } });
  await TutorialService.complete(alice, cfg(), 3);
  await setBuildings({ storage: 3, farm: 3, barracks: 2 });
  await TutorialService.complete(alice, cfg(), 4);
  await TutorialService.complete(alice, cfg(), 5);

  const troops = (await BuildRewardService.pending(alice.id)).find((r) => r.level === 5);
  assert.deepEqual(troops.units, { spear: 10, sword: 10 });
  // Ferme trop petite : la récompense attend.
  await Village.update({ buildings: { ...(await Village.findByPk(home.id)).buildings, farm: 1 }, units: { spear: 230 }, resourcesAt: new Date() }, { where: { id: home.id } });
  await assert.rejects(BuildRewardService.collect(alice.id, home.id, [troops.id]), /ferme/);
  await Village.update({ units: {}, buildings: { ...(await Village.findByPk(home.id)).buildings, farm: 3 }, wood: 0, stone: 0, iron: 0 }, { where: { id: home.id } });
  await BuildRewardService.collect(alice.id, home.id, [troops.id]);
  const v = await Village.findByPk(home.id);
  assert.equal(v.units.spear, 10);
  assert.equal(v.units.sword, 10);

  // Armée de 40 habitants : 10 lanciers + 10 porte-épées = 20, puis 20 lanciers de plus.
  let s = await TutorialService.state(alice, cfg());
  assert.equal(s.current.id, 6);
  assert.deepEqual({ have: s.progress.goals[0].have, need: s.progress.goals[0].need }, { have: 20, need: 40 });
  await v.update({ units: { spear: 30, sword: 10 } });
  await TutorialService.complete(alice, cfg(), 6);

  s = await TutorialService.state(alice, cfg());
  assert.equal(s.current.id, 7);
  await Report.create({ playerId: alice.id, type: 'attack', title: 'Attaque', data: {}, happenedAt: new Date() });
  await TutorialService.complete(alice, cfg(), 7);
  assert.equal((await TutorialService.state(alice, cfg())).progress.done, false, 'rapport pas encore lu');
  await Report.update({ isRead: true }, { where: { playerId: alice.id } });
  await TutorialService.complete(alice, cfg(), 8);
  await reload();
});

test('indications : un niveau en construction les éteint, construit il rend la quête prête', async () => {
  const p = await WorldService.join(await AuthService.register({ username: 'Bea', email: 'bea@example.com', password: 'motdepasse' }), 'w1');
  await BuildReward.create({ playerId: p.player.id, building: 'quest', level: 1, wood: 1, stone: 1, iron: 1, earnedAt: new Date() });
  let h = await TutorialService.hints(p.player, cfg());
  assert.equal(h.id, 2);
  assert.ok(h.targets.includes('[data-build-row="main"]') && !h.ready);
  // QG 2 puis 3 en file : plus rien à cliquer, la quête n'est pas encore prête.
  const { BuildOrder } = require('../src/models');
  for (const level of [2, 3]) await BuildOrder.create({ villageId: p.village.id, building: 'main', level, startsAt: new Date(), endsAt: new Date(Date.now() + 60000), wood: 0, stone: 0, iron: 0 });
  h = await TutorialService.hints(p.player, cfg());
  assert.deepEqual({ targets: h.targets, ready: h.ready }, { targets: [], ready: false });
  // Construit : prête aussitôt (pas de cache).
  await BuildOrder.destroy({ where: { villageId: p.village.id } });
  await Village.update({ buildings: { ...p.village.buildings, main: 3 } }, { where: { id: p.village.id } });
  h = await TutorialService.hints(p.player, cfg());
  assert.equal(h.ready, true);
});

test('bulle d’accueil : à la première arrivée, jusqu’à l’ouverture des quêtes ou sa fermeture', async () => {
  const { player, village } = await WorldService.join(await AuthService.register({ username: 'Cyr', email: 'cyr@example.com', password: 'motdepasse' }), 'w1');
  let h = await TutorialService.hints(player, cfg());
  assert.deepEqual({ intro: h.intro, targets: h.targets }, { intro: true, targets: [] }, 'rien d’autre ne clignote');
  await TutorialService.markSeen(player);
  h = await TutorialService.hints(await Player.findByPk(player.id), cfg());
  assert.equal(h.intro, false);
  assert.ok(h.targets.length > 0);
  // Un joueur qui a déjà terminé une quête ne la voit pas.
  await Player.update({ tutorialSeenAt: null }, { where: { id: player.id } });
  await BuildReward.create({ playerId: player.id, building: 'quest', level: 1, wood: 1, stone: 1, iron: 1, earnedAt: new Date() });
  assert.equal((await TutorialService.hints(await Player.findByPk(player.id), cfg())).intro, false);
  assert.ok(village);
});

test('monde sans quêtes : rien à terminer', async () => {
  const off = await WorldService.createWorld({ slug: 'w2', name: 'Monde 2', config: { tutorial: { active: false } } });
  assert.equal(TutorialService.enabled(off.getConfig()), false);
  await assert.rejects(TutorialService.complete(alice, off.getConfig(), 9), /Pas de quêtes/);
  await World.destroy({ where: { id: off.id } });
});

test('page : onglet Quêtes, objectif atteint et quête terminée d’un clic', async () => {
  let cookie = '';
  const http = async (path, { method = 'GET', form } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  };
  const tokenOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  const login = await http('/login');
  await http('/login', { method: 'POST', form: { login: 'Alice', password: 'motdepasse', _csrf: tokenOf(login.html) } });

  await BuildReward.update({ collectedAt: new Date() }, { where: { playerId: alice.id } });
  const page = await http(`/village/${home.id}/rewards`);
  assert.equal(page.status, 200);
  assert.match(page.html, /Pillage/, 'quête 9 en cours, onglet Quêtes par défaut');
  assert.match(page.html, /Y aller/);
  assert.match(page.html, /0 \/ 5/);
  assert.match(page.html, /\/img\/quests\/9\.webp/);

  await sequelize.models.DailyStat.create({ worldId: world.id, playerId: alice.id, day: '2026-10-08', plunders: 5 });
  const ready = await http(`/village/${home.id}/rewards?tab=quests`);
  assert.match(ready.html, /Terminer la quête/);
  const done = await http(`/village/${home.id}/quests/9/complete`, { method: 'POST', form: { _csrf: tokenOf(ready.html) } });
  assert.equal(done.status, 302);
  const after = await http(done.location);
  assert.match(after.html, /Quête « Pillage » terminée/);
  assert.match(after.html, /La collecte/);
  const rewards = await http(`/village/${home.id}/rewards?tab=rewards`);
  assert.match(rewards.html, /Quête du tutoriel/);

  // Indications : la quête 10 (collecte) fait clignoter ses liens et boutons ; prête, c'est le bouton des quêtes.
  const main = await http(`/village/${home.id}/main`);
  assert.match(main.html, /data-quest-hints="[^"]*link:scavenge[^"]*\[data-scavenge-send\]/);
  assert.match(main.html, /data-build-row="main"/);
  await sequelize.models.ScavengeRun.create({ villageId: home.id, option: 1, units: { spear: 1 }, resources: {}, startsAt: new Date(), endsAt: new Date(Date.now() + 3600000) });
  // Encart de quête sur les pages concernées seulement (collecte : point de ralliement, collecte), pas au QG ;
  // collecte lancée : il propose de terminer la quête.
  assert.doesNotMatch(main.html, /data-quest-tracker/);
  const place = await http(`/village/${home.id}/scavenge`);
  assert.equal(place.status, 200, place.location);
  assert.match(place.html, /data-quest-tracker[\s\S]*La collecte[\s\S]*Terminer la quête/);
  // Rappels masqués au compte (Compte → Quêtes, carte « Sans rappels ») : plus d'encart ; puis de nouveau affichés.
  const account = await http(`/village/${home.id}/account?tab=quests`);
  assert.match(account.html, /Avec rappels[\s\S]*Actif[\s\S]*name="reminders" value="off"/);
  await http(`/village/${home.id}/account/quest-reminders`, { method: 'POST', form: { _csrf: tokenOf(account.html), reminders: 'off' } });
  assert.doesNotMatch((await http(`/village/${home.id}/scavenge`)).html, /data-quest-tracker/);
  await http(`/village/${home.id}/account/quest-reminders`, { method: 'POST', form: { _csrf: tokenOf(account.html), reminders: 'on' } });
  assert.match((await http(`/village/${home.id}/scavenge`)).html, /data-quest-tracker/);
  const complete = await http(`/village/${home.id}/main`);
  assert.doesNotMatch(complete.html, /data-quest-hints=/);
  assert.match(complete.html, /rewards\?tab=quests" class="[^"]*quest-hint/);
});
