'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sequelize, World, Village, Player, BuildOrder, RecruitOrder, ResearchOrder, Transport, Command, Entitlement, ManagerVillage, TradeRoute,
} = require('../src/models');
const createApp = require('../src/app');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const AccountManagerService = require('../src/services/AccountManagerService');
const Mailer = require('../src/services/Mailer');
const managerTemplates = require('../src/game/managerTemplates');

const T0 = new Date(Date.now() - 3600000);
let alice;
let home;
let bob;
let server;
let base;

const cfg = async () => (await World.findByPk(home.worldId)).getConfig();
const premium = (userId) => Entitlement.create({ scope: 'account', userId, itemKey: 'premium', startsAt: new Date(T0.getTime() - 60000), source: 'gift' });
// Village à un état donné (ressources pleines par défaut), production arrêtée pour des tests exacts.
const setVillage = (id, patch) => Village.update({ resourcesAt: new Date(), ...patch }, { where: { id } });
const plain = { wood: 0, stone: 0, iron: 0 };

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  const u = await AuthService.register({ username: 'Alice', email: 'alice@example.com', password: 'motdepasse' });
  ({ player: alice, village: home } = await WorldService.join(u, 'w1', { now: T0 }));
  const b = await AuthService.register({ username: 'Bob', email: 'bob@example.com', password: 'motdepasse' });
  ({ player: bob } = await WorldService.join(b, 'w1', { now: T0 }));
  const app = createApp();
  await app.sessionStore.sync();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await sequelize.close();
});

test('modèles système : niveaux visés et niveaux par étape', () => {
  const res = managerTemplates.system('sys:resources');
  const t = managerTemplates.targets(res.steps);
  assert.equal(t.wood, 30);
  assert.equal(t.storage, 30);
  const steps = managerTemplates.withLevels([{ building: 'main', level: 3 }, { building: 'main', level: 2 }, { building: 'main', level: 5 }], { main: 1 });
  assert.deepEqual(steps.map((s) => s.levels), [2, 0, 2]);
  // Points et population après chaque étape, et au bout de la liste.
  const QG = require('../src/game/registry').building('main');
  assert.equal(steps[2].points, QG.pointsAt(5));
  assert.equal(steps[2].pop, QG.popAt(5));
  const full = managerTemplates.stats(t);
  assert.ok(full.points > 6000 && full.pop > 0 && full.free === full.farm - full.pop);
  assert.deepEqual(managerTemplates.troopStats({ spear: 10, light: 2 }), { pop: 18, wood: 750, stone: 500, iron: 600 });
});

test('modèles système des forums : plus de 9 000 points, armées qui tiennent dans la ferme', async () => {
  const base = { main: 1, farm: 1, storage: 1, place: 1 };
  const free = {};
  for (const tpl of managerTemplates.SYSTEM) {
    const st = managerTemplates.stats(managerTemplates.targets(tpl.steps, base));
    assert.ok(st.points > 9000, `${tpl.name} : ${st.points} points`);
    free[tpl.key] = st.free;
  }
  assert.equal(managerTemplates.stats(managerTemplates.targets(managerTemplates.system('sys:defensive').steps, base)).points, 9716);
  for (const t of managerTemplates.TROOPS) {
    const room = t.key.startsWith('sys:nuke') ? free['sys:offensive'] : free['sys:defensive'];
    assert.ok(managerTemplates.troopStats(t.units).pop <= room, `${t.name} tient dans la ferme`);
  }
  // Un monde sans archers ne propose pas les armées à archers.
  const c = await cfg();
  const has = new Set(require('../src/game/registry').unitsFor(c).map((u) => u.id));
  const offered = managerTemplates.troopsFor(c).map((t) => t.key);
  assert.equal(offered.includes('sys:def-archers'), has.has('archer'));
  assert.ok(offered.includes('sys:nuke') && offered.includes('sys:def'));
});

test('édition d’un modèle : ajout, ordre, suppression ; copie d’un modèle système', async () => {
  const c = await cfg();
  const tpl = await AccountManagerService.createBuildTemplate(alice.id, { name: 'Mon modèle' });
  await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'add', building: 'main', levels: 2 }, c);
  await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'add', building: 'wood', levels: 3 }, c);
  // Deux niveaux de plus : depuis le niveau visé jusque-là (QG 3), pas depuis le départ.
  let view = await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'add', building: 'main', levels: 2 }, c);
  assert.deepEqual(view.steps, [{ building: 'main', level: 3 }, { building: 'wood', level: 3 }, { building: 'main', level: 5 }]);
  view = await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'add', building: 'stone', levels: 1, at: '0' }, c);
  assert.equal(view.steps[0].building, 'stone');
  view = await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'down', index: '0' }, c);
  assert.deepEqual(view.steps.slice(0, 2).map((s) => s.building), ['main', 'stone']);
  view = await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'remove', index: '1' }, c);
  assert.equal(view.steps.length, 3);
  await assert.rejects(AccountManagerService.editBuildSteps(bob.id, tpl.id, { op: 'clear' }, c), /introuvable/);

  const copy = await AccountManagerService.createBuildTemplate(alice.id, { name: 'Copie', from: 'sys:offensive' });
  assert.equal(copy.data.steps.length, managerTemplates.system('sys:offensive').steps.length);
  await AccountManagerService.deleteTemplate(alice.id, copy.id);
  const { build } = await AccountManagerService.templates(alice.id);
  assert.deepEqual(build.map((t) => t.name), ['Ressources', 'Défensif', 'Offensif', 'Mon modèle']);
});

test('gestionnaire de villages : file au prix normal, entrepôt et bâtiments requis ajoutés d’eux-mêmes', async () => {
  const c = await cfg();
  await premium(alice.userId);
  // Modèle : écurie niveau 1 (QG 10, caserne 5, forge 5 requis).
  const tpl = await AccountManagerService.createBuildTemplate(alice.id, { name: 'Cavalerie' });
  await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'add', building: 'stable', levels: 1 }, c);
  await setVillage(home.id, { buildings: { main: 1, farm: 10, storage: 10 }, wood: 20000, stone: 20000, iron: 20000 });
  await AccountManagerService.applyBuild(alice.id, [home.id], { action: 'use', template: `tpl:${tpl.id}` });

  await AccountManagerService.runDue(new Date());
  const orders = await BuildOrder.findAll({ where: { villageId: home.id }, order: [['endsAt', 'ASC']] });
  // Premium : 2 + 3 emplacements au prix normal, aucun ordre avec surcoût.
  assert.equal(orders.length, 5);
  assert.deepEqual(orders.map((o) => `${o.building}${o.level}`), ['main2', 'main3', 'main4', 'main5', 'main6']);
  const row = await ManagerVillage.findOne({ where: { villageId: home.id } });
  assert.equal(row.status.build.reason, 'File de construction pleine');
  assert.equal(row.status.built, 5);
  assert.ok(new Date(row.checkAt) > new Date(), 'prochaine vérification plus tard');

  // Entrepôt trop petit pour la prochaine étape : il passe d'abord.
  await BuildOrder.destroy({ where: { villageId: home.id } });
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  const big = await AccountManagerService.createBuildTemplate(alice.id, { name: 'Gros QG' });
  await AccountManagerService.editBuildSteps(alice.id, big.id, { op: 'add', building: 'main', levels: 25 }, c);
  await setVillage(home.id, { buildings: { main: 25, farm: 30, storage: 1 }, wood: 1000, stone: 1000, iron: 1000 });
  await AccountManagerService.applyBuild(alice.id, [home.id], { action: 'use', template: `tpl:${big.id}` });
  await AccountManagerService.runDue(new Date());
  const first = await BuildOrder.findOne({ where: { villageId: home.id }, order: [['endsAt', 'ASC']] });
  assert.equal(first.building, 'storage');
});

test('gestionnaire de villages : démolition, y compris des bâtiments absents du modèle', async () => {
  const c = await cfg();
  await BuildOrder.destroy({ where: { villageId: home.id } });
  const tpl = await AccountManagerService.createBuildTemplate(alice.id, { name: 'Sans cachette' });
  for (const [building, levels] of [['main', 15], ['farm', 10], ['storage', 10]]) {
    await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'add', building, levels }, c);
  }
  await AccountManagerService.editBuildSteps(alice.id, tpl.id, { op: 'demolish', on: '1' }, c);
  // Liste terminée ; la cachette n'est pas dans le modèle : elle doit descendre à 0.
  const targets = managerTemplates.targets((await AccountManagerService.buildTemplate(alice.id, `tpl:${tpl.id}`)).steps);
  assert.ok(targets.main >= c.demolishMainLevel && !targets.hide);
  await setVillage(home.id, { buildings: { ...targets, hide: 3 }, loyalty: 100, ...plain });
  await AccountManagerService.applyBuild(alice.id, [home.id], { action: 'use', template: `tpl:${tpl.id}` });
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  await AccountManagerService.runDue(new Date());
  const orders = await BuildOrder.findAll({ where: { villageId: home.id } });
  assert.deepEqual(orders.map((o) => `${o.building}${o.level}${o.demolish ? '-' : ''}`), ['hide2-']);
  await BuildOrder.destroy({ where: { villageId: home.id } });
});

test('gestionnaire de villages : pause, sans premium rien ne se construit, conquête', async () => {
  await BuildOrder.destroy({ where: { villageId: home.id } });
  await AccountManagerService.applyBuild(alice.id, [home.id], { action: 'use', template: 'sys:resources' });
  await AccountManagerService.applyBuild(alice.id, [home.id], { action: 'pause' });
  await setVillage(home.id, { buildings: { main: 5, farm: 10, storage: 10 }, wood: 20000, stone: 20000, iron: 20000 });
  await AccountManagerService.runDue(new Date());
  assert.equal(await BuildOrder.count({ where: { villageId: home.id } }), 0, 'en pause');

  await AccountManagerService.applyBuild(alice.id, [home.id], { action: 'resume' });
  await Entitlement.destroy({ where: { userId: alice.userId } });
  await AccountManagerService.runDue(new Date());
  assert.equal(await BuildOrder.count({ where: { villageId: home.id } }), 0, 'sans premium');
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).status.premium, false);

  await premium(alice.userId);
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  await AccountManagerService.runDue(new Date());
  assert.ok(await BuildOrder.count({ where: { villageId: home.id } }) > 0, 'reprend avec le premium');

  // Village pris par un autre : la ligne du gestionnaire disparaît.
  await BuildOrder.destroy({ where: { villageId: home.id } });
  await Village.update({ playerId: bob.id }, { where: { id: home.id } });
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  await AccountManagerService.runDue(new Date());
  assert.equal(await ManagerVillage.count({ where: { villageId: home.id } }), 0);
  assert.equal(await BuildOrder.count({ where: { villageId: home.id } }), 0);
  await Village.update({ playerId: alice.id }, { where: { id: home.id } });
});

test('gestionnaire de troupes : ce qui manque, à proportion, avec tampons et priorité à la construction', async () => {
  const c = await cfg();
  await BuildOrder.destroy({ where: { villageId: home.id } });
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await setVillage(home.id, { buildings: { main: 10, barracks: 5, smith: 5, farm: 10, storage: 20 }, units: { spear: 10 }, research: {}, ...plain, wood: 10000, stone: 10000, iron: 10000 });
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'custom', spear: '110', sword: '100', resBuffer: '1000', popBuffer: '0' }, c);
  await AccountManagerService.runDue(new Date());
  const orders = await RecruitOrder.findAll({ where: { villageId: home.id } });
  const by = Object.fromEntries(orders.map((o) => [o.unit, o.count]));
  // 100 lanciers et 100 épées manquent : les deux avancent ensemble, dans la limite des ressources moins le tampon.
  assert.ok(by.spear > 0 && by.sword > 0, JSON.stringify(by));
  assert.ok(Math.abs(by.spear - by.sword) <= 1);
  const village = await Village.findByPk(home.id);
  for (const r of ['wood', 'stone', 'iron']) assert.ok(village[r] >= 1000 - 1, `tampon de ${r} gardé : ${village[r]}`);

  // Par petits lots de même coût : le prix de 50 lanciers (4 500 ressources) par bâtiment, partagé entre les unités.
  const lotCost = managerTemplates.BATCH_COST;
  assert.equal(lotCost, 4500);
  // Anciens modèles réglés en lanciers : 90 ressources par lancier.
  assert.equal(managerTemplates.batchCostOf({ batch: 10 }), 900);
  assert.equal(managerTemplates.batchCostOf({}), 4500);
  const price = (o) => { const u = require('../src/game/registry').unit(o.unit).cost; return (o.count - o.done) * (u.wood + u.stone + u.iron); };
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  await setVillage(home.id, { units: {}, wood: 400000, stone: 400000, iron: 400000, buildings: { main: 10, barracks: 5, smith: 5, farm: 30, storage: 30 } });
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'custom', spear: '5000', sword: '5000' }, c);
  const t0 = new Date();
  await AccountManagerService.runDue(t0);
  let lot = await RecruitOrder.findAll({ where: { villageId: home.id } });
  assert.deepEqual(Object.fromEntries(lot.map((o) => [o.unit, o.count])), { spear: 20, sword: 20 });
  assert.ok(lot.reduce((n, o) => n + price(o), 0) <= lotCost);
  // Second passage : la file vaut encore plus d'un demi-lot, rien de plus.
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  await AccountManagerService.runDue(new Date(t0.getTime() + 1000));
  assert.equal((await RecruitOrder.findAll({ where: { villageId: home.id } })).reduce((n, o) => n + o.count, 0), 40);
  assert.match((await ManagerVillage.findOne({ where: { villageId: home.id } })).status.troops.reason, /Lot en cours/);
  // Plus de la moitié du lot recrutée : le lot suivant part.
  await RecruitOrder.update({ done: 15 }, { where: { villageId: home.id } });
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  await AccountManagerService.runDue(new Date(t0.getTime() + 2000));
  lot = await RecruitOrder.findAll({ where: { villageId: home.id } });
  assert.equal(lot.reduce((n, o) => n + o.count - o.done, 0), 50);
  // Unités chères : même coût, donc moins d'unités (9 cavaliers légers pour 4 500 ressources, arrondis à 10).
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await setVillage(home.id, { research: { light: true }, buildings: { main: 10, barracks: 5, smith: 5, stable: 3, farm: 30, storage: 30 } });
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'custom', light: '3000' }, c);
  await AccountManagerService.runDue(new Date());
  assert.deepEqual((await RecruitOrder.findAll({ where: { villageId: home.id } })).map((o) => [o.unit, o.count]), [['light', 10]]);
  // Pour finir le modèle : le nombre exact qui manque (7), pas une dizaine.
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await setVillage(home.id, { units: { light: 2993 } });
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  await AccountManagerService.runDue(new Date());
  assert.deepEqual((await RecruitOrder.findAll({ where: { villageId: home.id } })).map((o) => [o.unit, o.count]), [['light', 7]]);
  // Faute de ressources : à la dizaine inférieure (27 possibles → 20).
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await setVillage(home.id, { units: {}, wood: 125 * 27, stone: 100 * 27, iron: 250 * 27 });
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'custom', light: '3000', batchCost: '1000000' }, c);
  await AccountManagerService.runDue(new Date());
  assert.deepEqual((await RecruitOrder.findAll({ where: { villageId: home.id } })).map((o) => [o.unit, o.count]), [['light', 20]]);
  await setVillage(home.id, { wood: 400000, stone: 400000, iron: 400000 });
  // Taille des lots réglée dans le modèle, en ressources : 900, soit 10 lanciers.
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'custom', spear: '5000', batchCost: '900' }, c);
  await AccountManagerService.runDue(new Date());
  assert.equal((await RecruitOrder.findAll({ where: { villageId: home.id } })).reduce((n, o) => n + o.count, 0), 10);

  // Aperçu d'un lot par bâtiment, même découpe que le gestionnaire.
  const preview = managerTemplates.batchPreview({ spear: 5000, sword: 5000, light: 3000 }, 4500, AccountManagerService.managedUnits(c));
  assert.deepEqual(preview.map((l) => [l.building, l.units]), [['barracks', [['spear', 20], ['sword', 20]]], ['stable', [['light', 10]]]]);

  // Renvoyer les unités en trop : au-delà du modèle, et celles qu'il ne contient pas (jamais le paladin ni les nobles).
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await setVillage(home.id, { units: { spear: 150, axe: 30, snob: 1 } });
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'custom', spear: '100', dismiss: '1' }, c);
  await AccountManagerService.runDue(new Date());
  assert.deepEqual((await Village.findByPk(home.id)).units, { spear: 100, snob: 1 });
  assert.deepEqual((await ManagerVillage.findOne({ where: { villageId: home.id } })).status.troops.dismissed, { spear: 50, axe: 30 });
  // Sans l'option : rien n'est renvoyé.
  await setVillage(home.id, { units: { spear: 150 } });
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'custom', spear: '100' }, c);
  await AccountManagerService.runDue(new Date());
  assert.deepEqual((await Village.findByPk(home.id)).units, { spear: 150 });

  // Ce qui est en recrutement est compté : objectif atteint, plus rien n'est lancé.
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await setVillage(home.id, { units: { spear: 5000, sword: 5000 } });
  await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
  await AccountManagerService.runDue(new Date());
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).status.troops.done, true);
  assert.equal(await RecruitOrder.count({ where: { villageId: home.id } }), 0);

  // Modèle de troupes système : ses troupes sont relues à chaque passage.
  await RecruitOrder.destroy({ where: { villageId: home.id } });
  await setVillage(home.id, { units: {}, research: { axe: true }, buildings: { main: 10, barracks: 5, smith: 5, farm: 30, storage: 30 }, wood: 50000, stone: 50000, iron: 50000 });
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'sys:nuke' }, c);
  await assert.rejects(AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: 'sys:inconnu' }, c), /introuvable/);
  const [managed] = (await AccountManagerService.villages(alice.id)).rows.filter((v) => v.village.id === home.id);
  assert.equal(managed.troopsTemplate, 'Offensif (nuke)');
  await AccountManagerService.runDue(new Date());
  const nuke = await RecruitOrder.findAll({ where: { villageId: home.id } });
  assert.ok(nuke.some((o) => o.unit === 'axe' && o.count > 0), 'haches recrutées');
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'remove' }, c);
  await AccountManagerService.applyBuild(alice.id, [home.id], { action: 'remove' });
});

test('routes commerciales : intervalle libre, jours choisis, envoi, échec sans ressources', async () => {
  // Anciennes routes : une fois par jour à leur heure.
  const at = new Date(2026, 9, 5, 12, 0); // lundi 5 octobre 2026, 12 h
  assert.equal(AccountManagerService.nextRun([1], 13 * 60, at).getTime(), new Date(2026, 9, 5, 13, 0).getTime());
  assert.equal(AccountManagerService.nextRun([1], 11 * 60, at).getTime(), new Date(2026, 9, 12, 11, 0).getTime());
  // Intervalle libre : toutes les 4 h depuis le dernier créneau, en sautant les jours non choisis (mardi exclu).
  assert.equal(AccountManagerService.nextEvery([1, 3], 240, at).getTime(), new Date(2026, 9, 5, 16, 0).getTime());
  assert.equal(AccountManagerService.nextEvery([1, 3], 240, new Date(2026, 9, 5, 20, 0)).getTime(), new Date(2026, 9, 7, 0, 0).getTime());
  // Créneaux manqués (premium coupé…) : pas de rattrapage en rafale, le prochain créneau après maintenant.
  assert.equal(AccountManagerService.nextEvery([1], 60, at, new Date(2026, 9, 5, 15, 30)).getTime(), new Date(2026, 9, 5, 16, 0).getTime());

  const bobVillage = await Village.findOne({ where: { playerId: bob.id } });
  await setVillage(home.id, { buildings: { main: 10, market: 5, storage: 20, farm: 10 }, wood: 5000, stone: 5000, iron: 5000 });
  const all = ['0', '1', '2', '3', '4', '5', '6'];
  const route = await AccountManagerService.createRoute(alice.id, home.id, { x: String(bobVillage.x), y: String(bobVillage.y), wood: '1000', days: all, every: '6', unit: 'hours' });
  assert.equal(route.intervalMinutes, 360);
  assert.ok(new Date(route.nextAt) <= new Date(), 'premier envoi tout de suite');
  await assert.rejects(AccountManagerService.createRoute(alice.id, home.id, { target: home.id, wood: '1', days: '1', every: '1' }), /même village/);
  // Formulaire : village de départ choisi, destinataire en « x|y », envoi toutes les 90 minutes.
  const every = await AccountManagerService.createRoute(alice.id, null, { origin: String(home.id), coords: `${bobVillage.x}|${bobVillage.y}`, stone: '500', days: ['1', '3'], every: '90', unit: 'minutes' });
  assert.deepEqual([every.originVillageId, every.targetVillageId, every.intervalMinutes, every.days], [home.id, bobVillage.id, 90, [1, 3]]);
  await assert.rejects(AccountManagerService.createRoute(alice.id, null, { origin: String(home.id), coords: `${bobVillage.x}|${bobVillage.y}`, stone: '1', days: '1', every: '5', unit: 'minutes' }), /toutes les 10 minutes/);
  await assert.rejects(AccountManagerService.createRoute(alice.id, null, { origin: String(home.id), coords: `${bobVillage.x}|${bobVillage.y}`, stone: '1', days: '1', every: '' }), /fréquence/);
  await assert.rejects(AccountManagerService.createRoute(alice.id, null, { origin: String(bobVillage.id), coords: `${home.x}|${home.y}`, stone: '1', days: '1', every: '1' }), /introuvable/);
  await every.destroy();
  await route.update({ nextAt: new Date(Date.now() - 1000) });
  await AccountManagerService.runDue(new Date());
  await route.reload();
  assert.equal(route.lastResult, 'Envoyée');
  assert.ok(new Date(route.nextAt) > new Date());
  assert.equal(await Transport.count({ where: { originVillageId: home.id, targetVillageId: bobVillage.id } }), 1);
  // À l'arrivée : rapport de commerce au propriétaire de la route (envoi du gestionnaire), en plus de celui de Bob.
  const { Report } = require('../src/models');
  const transport = await Transport.findOne({ where: { originVillageId: home.id, targetVillageId: bobVillage.id, type: 'delivery' } });
  assert.equal(transport.source, 'route');
  await require('../src/services/TradeService').process(transport.id);
  const report = await Report.findOne({ where: { playerId: alice.id, type: 'trade' }, order: [['id', 'DESC']] });
  assert.match(report.title, /^Route commerciale : .* fournit /);
  assert.deepEqual([report.data.source, report.data.received.wood], ['route', 1000]);
  assert.ok(await Report.count({ where: { playerId: bob.id, type: 'trade' } }) >= 1, 'le destinataire a son rapport');

  await setVillage(home.id, { wood: 10 });
  await route.update({ nextAt: new Date(Date.now() - 1000) });
  await AccountManagerService.runDue(new Date());
  await route.reload();
  assert.match(route.lastResult, /Non envoyée : Ressources insuffisantes/);
  await AccountManagerService.deleteRoutes(alice.id, [route.id]);
  await Transport.destroy({ where: {} });
});

test('réserve : l’excédent part vers le village en manque', async () => {
  // Deuxième village d'Alice, presque vide ; le premier est plein.
  const near = { worldId: home.worldId, x: home.x + 2, y: home.y + 2 };
  await Village.destroy({ where: near });
  const second = await Village.create({ ...near, playerId: alice.id, name: 'Second', buildings: { main: 5, market: 1, storage: 10, farm: 5 }, units: {}, wood: 100, stone: 100, iron: 100, resourcesAt: new Date() });
  await setVillage(home.id, { buildings: { main: 10, market: 10, storage: 10, farm: 10 }, wood: 9000, stone: 9000, iron: 500 });
  await AccountManagerService.saveReserve(alice.id, { enabled: '1', mode: 'percent', low: '25', high: '70' });
  await assert.rejects(AccountManagerService.saveReserve(alice.id, { mode: 'percent', low: '80', high: '70' }), /plus haut/);
  await AccountManagerService.saveReserve(alice.id, { enabled: '1', mode: 'percent', low: '25', high: '70' });
  await AccountManagerService.runDue(new Date());
  const sent = await Transport.findAll({ where: { originVillageId: home.id, targetVillageId: second.id } });
  assert.equal(sent.length, 1);
  assert.ok(sent[0].resources.wood > 0 && sent[0].resources.stone > 0);
  assert.equal(sent[0].resources.iron, 0, 'le fer n’est pas en excédent');
  // Toutes les 8 heures seulement.
  await AccountManagerService.runDue(new Date());
  assert.equal(await Transport.count({ where: { originVillageId: home.id } }), 1);
  // Entre ses propres villages aussi : rapport « Réserve : … fournit … » à l'arrivée.
  await require('../src/services/TradeService').process(sent[0].id);
  const { Report } = require('../src/models');
  assert.ok(await Report.findOne({ where: { playerId: alice.id, type: 'trade', title: `Réserve : ${home.name} fournit Second` } }));
  await Transport.destroy({ where: { type: 'return' } });
  // Village hors réserve : rien ne lui est envoyé.
  await Transport.destroy({ where: {} });
  await AccountManagerService.applyReserveRole(alice.id, [second.id], 'off');
  assert.equal(await AccountManagerService.runReserve(alice.id, new Date()), 0);
  await AccountManagerService.saveReserve(alice.id, { mode: 'percent', low: '25', high: '70' });
  await second.destroy();
});

test('notifications d’attaque : à la première attaque, regroupées, pas si connecté', async () => {
  const bobVillage = await Village.findOne({ where: { playerId: bob.id } });
  await AccountManagerService.saveNotify(alice.id, { enabled: '1', when: 'first', offlineOnly: '1', group: 'attacker', perGroup: '5' });
  const before = Mailer.outbox().length;
  const attack = () => Command.create({
    worldId: home.worldId, type: 'attack', originVillageId: bobVillage.id, targetVillageId: home.id, units: { axe: 10 },
    startsAt: new Date(), arrivesAt: new Date(Date.now() + 3600000),
  });
  await Player.update({ lastSeenAt: new Date() }, { where: { id: alice.id } });
  await attack();
  await AccountManagerService.runDue(new Date());
  assert.equal(Mailer.outbox().length, before, 'connecté : pas d’e-mail');

  await Command.destroy({ where: { targetVillageId: home.id } });
  await AccountManagerService.runDue(new Date());
  await Player.update({ lastSeenAt: new Date(Date.now() - 3600000) }, { where: { id: alice.id } });
  await attack();
  await attack();
  await AccountManagerService.runDue(new Date());
  const mail = Mailer.outbox().at(-1);
  assert.equal(Mailer.outbox().length, before + 1);
  assert.equal(mail.to, 'alice@example.com');
  assert.match(mail.subject, /2 attaques en approche/);
  assert.match(mail.text, /Attaquant : Bob \(2\)/);
  // Gabarit commun des e-mails : HTML avec l'en-tête « attaque » joint (cid), tableau des attaques.
  assert.match(mail.html, /src="cid:header"/);
  assert.match(mail.html, /2 attaques en approche/);
  assert.match(mail.html, /<th[^>]*>Attaquant<\/th>/);
  assert.match(mail.html, /Attaquant : Bob \(2\)/);
  // Déjà signalé : pas de second e-mail tant que le compteur ne repasse pas par 0.
  await attack();
  await AccountManagerService.runDue(new Date());
  assert.equal(Mailer.outbox().length, before + 1);

  // Toutes les 2 nouvelles attaques.
  await AccountManagerService.saveNotify(alice.id, { enabled: '1', when: 'count', count: '2', group: 'none' });
  await attack();
  await AccountManagerService.runDue(new Date());
  assert.equal(Mailer.outbox().length, before + 1);
  await attack();
  await AccountManagerService.runDue(new Date());
  assert.equal(Mailer.outbox().length, before + 2);
  assert.match(Mailer.outbox().at(-1).subject, /2 attaques/);
  await AccountManagerService.saveNotify(alice.id, { when: 'first' });
  await Command.destroy({ where: { targetVillageId: home.id } });
});

test('pages : chaque onglet s’affiche, actions réservées au premium', async () => {
  let cookie = '';
  const http = async (path, { method = 'GET', form } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
  const token = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  const login = await http('/login');
  await http('/login', { method: 'POST', form: { login: 'Alice', password: 'motdepasse', _csrf: token(login.text) } });
  const v = `/village/${home.id}`;

  const own = (await AccountManagerService.templates(alice.id)).build.find((t) => !t.system);
  assert.match((await http(`${v}/manager?tab=troops&id=sys%3Adef`)).text, /Défensif fixe \(copie\)/);
  // Modèles de troupes : création copiée d'un modèle système, page du modèle, assignation depuis l'onglet Villages.
  const troopsPage = await http(`${v}/manager?tab=troops`);
  const made = await http(`${v}/manager/troop-templates`, { method: 'POST', form: { _csrf: token(troopsPage.text), name: 'Ma def', from: 'sys:def-mobile' } });
  const mine = (await AccountManagerService.templates(alice.id)).troops.find((t) => t.name === 'Ma def');
  assert.equal(made.location, `${v}/manager?tab=troops&id=tpl:${mine.id}`);
  assert.deepEqual(mine.units, managerTemplates.troopSystem('sys:def-mobile').units);
  assert.match((await http(made.location)).text, /Troupes et tampons/);
  // Onglet Troupes : modèles de troupes à appliquer ; l'onglet Construction n'a que ceux de construction.
  const villagesPage = await http(`${v}/manager?tab=units`);
  assert.match(villagesPage.text, /name="troopTemplate"/);
  assert.doesNotMatch(villagesPage.text, /name="buildTemplate"/);
  assert.doesNotMatch((await http(`${v}/manager?tab=buildings`)).text, /name="troopTemplate"/);
  const assigned = await http(`${v}/manager/troops`, { method: 'POST', form: [['_csrf', token(villagesPage.text)], ['troopAction', 'use'], ['troopTemplate', mine.key], ['ids', String(home.id)]] });
  assert.match(assigned.location, /tab=units/);
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).troopTemplateId, mine.id);
  // Formulaire unique de l'onglet Villages : modèle appliqué, action groupée, bouton d'un village.
  const vt = token(villagesPage.text);
  const row = () => ManagerVillage.findOne({ where: { villageId: home.id } });
  await http(`${v}/manager/apply`, { method: 'POST', form: [['_csrf', vt], ['op', 'build:use'], ['buildTemplate', 'sys:offensive'], ['troopTemplate', 'sys:nuke'], ['bulk', 'all:pause'], ['ids', String(home.id)]] });
  assert.equal((await row()).buildTemplate, 'sys:offensive');
  await http(`${v}/manager/apply`, { method: 'POST', form: [['_csrf', vt], ['op', 'bulk'], ['bulk', 'all:pause'], ['ids', String(home.id)]] });
  assert.deepEqual([(await row()).buildPaused, (await row()).troopsPaused], [true, true]);
  await http(`${v}/manager/apply`, { method: 'POST', form: [['_csrf', vt], ['op', `village:${home.id}:troops:resume`]] });
  assert.deepEqual([(await row()).buildPaused, (await row()).troopsPaused], [true, false]);
  assert.match((await http(`${v}/manager?tab=buildings`)).text, new RegExp(`value="village:${home.id}:build:resume"`));
  await http(`${v}/manager/apply`, { method: 'POST', form: [['_csrf', vt], ['op', `village:${home.id}:troops:remove`]] });
  assert.equal((await row()).troopTemplateId, null);
  await http(`${v}/manager/apply`, { method: 'POST', form: [['_csrf', vt], ['op', `village:${home.id}:build:resume`]] });
  for (const tab of ['overview', 'buildings', 'templates', 'units', 'troops', 'market', 'notify']) {
    const page = await http(`${v}/manager?tab=${tab}`);
    assert.equal(page.status, 200, tab);
    assert.match(page.text, /Gestionnaire de compte/);
    assert.doesNotMatch(page.text, /Passer au premium/, `${tab} : premium actif`);
  }
  for (const id of ['sys:defensive', own.key]) assert.equal((await http(`${v}/manager?tab=templates&id=${encodeURIComponent(id)}`)).status, 200);
  // Sommaire : un clic sur un bâtiment ajoute un niveau en fin de liste ; au maximum, il est marqué et inactif.
  const edit = await http(`${v}/manager?tab=templates&id=${encodeURIComponent(own.key)}`);
  assert.match(edit.text, /Point de ralliement : niveau 0 → ajouter le niveau 1/);
  const before = (await AccountManagerService.buildTemplate(alice.id, own.key)).steps;
  const level = managerTemplates.targets(before, { main: 1 }).main;
  const added = await http(`${v}/manager/templates/${own.id}/steps`, { method: 'POST', form: { _csrf: token(edit.text), op: 'add', levels: '1', anchor: 'sommaire', building: 'main' } });
  assert.match(added.location, /#sommaire$/);
  assert.deepEqual((await AccountManagerService.buildTemplate(alice.id, own.key)).steps.at(-1), { building: 'main', level: level + 1 });
  await http(`${v}/manager/templates/${own.id}/steps`, { method: 'POST', form: { _csrf: token(edit.text), op: 'add', levels: '1', anchor: 'sommaire', building: 'place' } });
  assert.match((await http(`${v}/manager?tab=templates&id=${encodeURIComponent(own.key)}`)).text, /Point de ralliement : niveau maximum \(1\) atteint/);
  assert.match((await http(`${v}/villages`)).text, /Gestionnaire/);
  // Favoris : le gestionnaire et chacun de ses onglets vont dans la barre d'accès rapide (étoile de l'en-tête).
  const market = await http(`${v}/manager?tab=market`);
  assert.match(market.text, /data-fav="manager:market"/);
  await http(`${v}/buildings/manager/favorite`, { method: 'POST', form: { _csrf: token(market.text), tab: 'market' } });
  assert.ok((await Player.findByPk(alice.id)).favoriteBuildings.includes('manager:market'));
  assert.match((await http(`${v}/manager`)).text, new RegExp(`href="${v}/manager\\?tab=market"[^>]*title="Gestionnaire de compte · Marché"|title="Gestionnaire de compte · Marché"`));

  const page = await http(`${v}/manager?tab=buildings`);
  const done = await http(`${v}/manager/build`, { method: 'POST', form: [['_csrf', token(page.text)], ['buildAction', 'use'], ['buildTemplate', 'sys:defensive'], ['ids', String(home.id)]] });
  assert.equal(done.status, 302);
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).buildTemplate, 'sys:defensive');
  const toggled = await http(`${v}/manager/toggle`, { method: 'POST', form: { _csrf: token(page.text), village: String(home.id), which: 'build' } });
  assert.equal(toggled.status, 302);
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).buildPaused, true);

  await Entitlement.destroy({ where: { userId: alice.userId } });
  const locked = await http(`${v}/manager`);
  assert.match(locked.text, /inclus dans le premium/);
  await http(`${v}/manager/build`, { method: 'POST', form: [['_csrf', token(locked.text)], ['action', 'resume'], ['ids', String(home.id)]] });
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).buildPaused, true, 'refusé sans premium');
  assert.match((await http(`${v}/manager`)).text, /réservé au premium/);
});

test('modèles du compte : partagés entre mondes, unités absentes du monde ignorées mais gardées', async () => {
  // Monde 1 sans archers (réglage par défaut), monde 2 avec : même compte, deux joueurs.
  await WorldService.createWorld({ slug: 'w2', name: 'Monde 2', config: { newbieDays: 0, features: { archer: true } } });
  const { player: alice2 } = await WorldService.join(await require('../src/models').User.findByPk(alice.userId), 'w2');
  const c1 = await cfg();
  const c2 = (await World.findOne({ where: { slug: 'w2' } })).getConfig();
  assert.ok(!c1.hasFeature('archer') && c2.hasFeature('archer'));
  // Créé sur le monde 2 avec des archers, visible sur le monde 1 sans eux.
  const tpl = await AccountManagerService.createTroopTemplate(alice2.id, { name: 'Mixte' }, c2);
  await AccountManagerService.saveTroopTemplate(alice2.id, { id: tpl.id, name: 'Mixte', spear: '100', archer: '50' }, c2);
  const there = (await AccountManagerService.templates(alice2.id, c2)).troops.find((t) => t.id === tpl.id);
  const here = (await AccountManagerService.templates(alice.id, c1)).troops.find((t) => t.id === tpl.id);
  assert.deepEqual([there.units, there.ignored], [{ spear: 100, archer: 50 }, []]);
  assert.deepEqual([here.units, here.ignored], [{ spear: 100 }, ['archer']]);
  // Enregistré depuis le monde sans archers : les archers restent pour le monde 2.
  await AccountManagerService.saveTroopTemplate(alice.id, { id: tpl.id, name: 'Mixte', spear: '200' }, c1);
  await tpl.reload();
  assert.deepEqual(tpl.data.units, { spear: 200, archer: 50 });
  // Modèles système à archers : seulement sur le monde qui en a.
  assert.ok(!managerTemplates.troopsFor(c1).some((t) => t.key === 'sys:def-archers'));
  assert.ok(managerTemplates.troopsFor(c2).some((t) => t.key === 'sys:def-archers'));
  // Supprimé depuis un monde : ses villages des autres mondes le perdent.
  await AccountManagerService.applyTroops(alice.id, [home.id], { action: 'use', template: `tpl:${tpl.id}` }, c1);
  await AccountManagerService.deleteTemplate(alice2.id, tpl.id);
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).troopTemplateId, null);
});

test('pagination des villages du gestionnaire, usage des modèles sur tous, compte rendu du marché', async () => {
  const extra = [];
  for (let i = 0; i < 3; i += 1) {
    const at = { worldId: home.worldId, x: home.x - 4 - i, y: home.y - 4 };
    await Village.destroy({ where: at });
    extra.push(await Village.create({ ...at, playerId: alice.id, name: `Zz ${i}`, buildings: { main: 1, farm: 1, storage: 1 }, units: {}, wood: 0, stone: 0, iron: 0, resourcesAt: new Date() }));
  }
  await AccountManagerService.applyBuild(alice.id, extra.map((v) => v.id), { action: 'use', template: 'sys:defensive' });
  const total = await Village.count({ where: { playerId: alice.id } });
  const p1 = await AccountManagerService.villages(alice.id, { perPage: 2, page: 1 });
  const p2 = await AccountManagerService.villages(alice.id, { perPage: 2, page: 'last' });
  assert.equal(p1.rows.length, 2);
  assert.equal(p1.pagination.total, total);
  assert.equal(p2.pagination.page, Math.ceil(total / 2));
  // Usage compté sur tous les villages, pas la page.
  assert.ok(p1.usage.build.get('sys:defensive').villages >= 3);
  assert.equal(p1.managed, p2.managed);
  const report = await AccountManagerService.marketReport(alice.id);
  assert.equal(typeof report.routes, 'number');
  assert.ok('reserve' in report && Array.isArray(report.recent));
  for (const v of extra) await v.destroy();
});

test('gestionnaire de forge : toutes les recherches dans l’ordre de la forge, une à la fois, bâtiments requis et ressources', async () => {
  const c = await cfg();
  await premium(alice.userId);
  const units = AccountManagerService.researchUnits(c);
  // Modèle système : toutes les unités du monde qui se recherchent, dans l'ordre de la forge.
  const system = (await AccountManagerService.templates(alice.id, c)).research.find((t) => t.system);
  assert.deepEqual(system.units, units.map((u) => u.id));
  // Seule la forge travaille dans ce village.
  await ManagerVillage.update({ buildTemplate: null, troopTemplateId: null, troops: null }, { where: { villageId: home.id } });
  await ResearchOrder.destroy({ where: { villageId: home.id } });
  const buildings = { main: 10, farm: 10, storage: 20, barracks: 5, smith: 2 };
  const full = { wood: 50000, stone: 50000, iron: 50000 };
  await setVillage(home.id, { buildings, research: {}, units: {}, ...full });
  await AccountManagerService.applyResearch(alice.id, [home.id], { action: 'use', template: 'sys:research' }, c);
  const run = async () => {
    await ManagerVillage.update({ checkAt: null }, { where: { villageId: home.id } });
    await AccountManagerService.runDue(new Date());
    return ManagerVillage.findOne({ where: { villageId: home.id } });
  };

  // Première recherche possible avec ces bâtiments, dans l'ordre de la forge ; une seule à la fois.
  const ready = units.find((u) => !u.missingRequirements(buildings, c).length);
  let row = await run();
  const orders = await ResearchOrder.findAll({ where: { villageId: home.id } });
  assert.deepEqual(orders.map((o) => o.unit), [ready.id]);
  assert.equal(row.status.research.started, ready.name);
  row = await run();
  assert.equal(await ResearchOrder.count({ where: { villageId: home.id } }), 1);
  assert.match(row.status.research.reason, /^Recherche en cours/);

  // Modèle à soi : une unité dont les bâtiments requis manquent attend (pas de recherche lancée à sa place).
  await ResearchOrder.destroy({ where: { villageId: home.id } });
  const blocked = units.find((u) => u.missingRequirements(buildings, c).length);
  const mine = await AccountManagerService.createResearchTemplate(alice.id, { name: 'Une seule' }, c);
  assert.deepEqual((await AccountManagerService.setResearchUnit(alice.id, mine.id, blocked.id, '1', c)).units, [blocked.id]);
  await AccountManagerService.applyResearch(alice.id, [home.id], { action: 'use', template: `tpl:${mine.id}` }, c);
  row = await run();
  assert.equal(await ResearchOrder.count({ where: { villageId: home.id } }), 0);
  assert.match(row.status.research.reason, /^Bâtiments requis/);
  // Avertissement de l'aperçu, comme un modèle de construction bloqué.
  const { rows: managed } = await AccountManagerService.villages(alice.id, { cfg: c });
  assert.ok((await AccountManagerService.warnings(alice.id, managed)).some((w) => w.kind === 'research' && /^Forge : Bâtiments requis/.test(w.text)));

  // Ressources insuffisantes : rien n'est lancé, la prochaine vérification attend la production.
  await AccountManagerService.setResearchUnit(alice.id, mine.id, blocked.id, '', c);
  await AccountManagerService.setResearchUnit(alice.id, mine.id, ready.id, '1', c);
  await setVillage(home.id, { ...plain });
  row = await run();
  assert.equal(await ResearchOrder.count({ where: { villageId: home.id } }), 0);
  assert.equal(row.status.research.reason, `${ready.name} : ressources insuffisantes`);

  // Tout est recherché : modèle terminé.
  await setVillage(home.id, { research: { [ready.id]: true }, ...full });
  row = await run();
  assert.equal(row.status.research.done, true);

  // Pause, puis suppression du modèle : le village n'a plus de modèle de forge.
  await AccountManagerService.toggle(alice.id, home.id, 'research');
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).researchPaused, true);
  await AccountManagerService.deleteTemplate(alice.id, mine.id);
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).researchTemplate, null);
});

test('gestionnaire de forge : pages des modèles et de l’onglet Villages · Forge', async () => {
  let cookie = '';
  const http = async (path, { method = 'GET', form } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
  const token = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  const login = await http('/login');
  await http('/login', { method: 'POST', form: { login: 'Alice', password: 'motdepasse', _csrf: token(login.text) } });
  const v = `/village/${home.id}`;
  const c = await cfg();

  const list = await http(`${v}/manager?tab=research`);
  assert.equal(list.status, 200);
  assert.match(list.text, /Toutes les recherches/);
  // Création copiée du modèle système, puis une case décochée (enregistrée aussitôt).
  const made = await http(`${v}/manager/research-templates`, { method: 'POST', form: { _csrf: token(list.text), name: 'Ma forge', from: 'sys:research' } });
  const mine = (await AccountManagerService.templates(alice.id, c)).research.find((t) => t.name === 'Ma forge');
  assert.equal(made.location, `${v}/manager?tab=research&id=tpl:${mine.id}`);
  const page = await http(made.location);
  assert.match(page.text, /id="recherches"/);
  const first = AccountManagerService.researchUnits(c)[0].id;
  await http(`${v}/manager/research-templates/${mine.id}/units`, { method: 'POST', form: { _csrf: token(page.text), unit: first } });
  const after = await AccountManagerService.researchTemplate(alice.id, mine.key, c);
  assert.ok(!after.units.includes(first));
  // Onglet Villages · Forge : modèles de forge à appliquer, assignation par le formulaire commun.
  const forge = await http(`${v}/manager?tab=forge`);
  assert.match(forge.text, /name="researchTemplate"/);
  assert.doesNotMatch(forge.text, /name="troopTemplate"/);
  const done = await http(`${v}/manager/apply`, { method: 'POST', form: [['_csrf', token(forge.text)], ['op', 'research:use'], ['researchTemplate', mine.key], ['ids', String(home.id)]] });
  assert.match(done.location, /tab=forge/);
  assert.equal((await ManagerVillage.findOne({ where: { villageId: home.id } })).researchTemplate, mine.key);
  // Aperçu : colonne Forge et modèles de forge.
  const overview = await http(`${v}/manager`);
  assert.match(overview.text, /Modèles de forge/);
  assert.match(overview.text, /Forge : actif/);
});

test('conquête : le village quitte le gestionnaire et ses routes s’arrêtent', async () => {
  const CommandService = require('../src/services/CommandService');
  const bobVillage = await Village.findOne({ where: { playerId: bob.id } });
  await TradeRoute.create({ playerId: alice.id, originVillageId: home.id, targetVillageId: bobVillage.id, resources: { wood: 1 }, days: [1], minute: 0, nextAt: new Date() });
  await sequelize.transaction(async (t) => CommandService.handOver(await Village.findByPk(home.id, { transaction: t }), t));
  assert.equal(await ManagerVillage.count({ where: { villageId: home.id } }), 0);
  assert.equal(await TradeRoute.count({ where: { originVillageId: home.id } }), 0);
  assert.ok(VillageService);
});
