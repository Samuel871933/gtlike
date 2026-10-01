'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Village, Player, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const CommandService = require('../src/services/CommandService');
const FaithService = require('../src/services/FaithService');
const WorldConfig = require('../src/game/WorldConfig');
const registry = require('../src/game/registry');
const combat = require('../src/game/combat');
const faith = require('../src/game/faith');

const T0 = new Date('2026-10-01T12:00:00Z');
const maxLoss = { rng: () => 0.999 };
const churchCfg = new WorldConfig({ features: { church: true } });
let world;
let alice;
let bob;
let a;
let b;

test.before(async () => {
  await sequelize.sync({ force: true });
  world = await WorldService.createWorld({ slug: 'eglise', name: 'Monde église', config: { newbieDays: 0, luck: 0, features: { church: true } } });
  await WorldService.createWorld({ slug: 'sans', name: 'Monde sans église', config: {} });
  alice = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  bob = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  ({ village: a } = await WorldService.join(alice, 'eglise', { now: T0 }));
  ({ village: b } = await WorldService.join(bob, 'eglise', { now: T0 }));
});

test.after(() => sequelize.close());

test('règles pures : rayons, foi des villages, barbares toujours à pleine force', () => {
  assert.equal(faith.radiusOf({ church: 1 }, churchCfg), 4);
  assert.equal(faith.radiusOf({ church: 3 }, churchCfg), 8);
  assert.equal(faith.radiusOf({ church_f: 1 }, churchCfg), 6);
  assert.equal(faith.radiusOf({ church: 1 }, new WorldConfig({})), 0, 'monde sans église');
  const churches = faith.churchesOf([{ x: 500, y: 500, buildings: { church: 2 } }], churchCfg);
  assert.equal(faith.factorFor({ x: 506, y: 500, playerId: 1 }, churches, churchCfg), 1);
  assert.equal(faith.factorFor({ x: 505, y: 505, playerId: 1 }, churches, churchCfg), 0.5, 'distance 7,07 > 6');
  assert.equal(faith.factorFor({ x: 600, y: 600, playerId: null }, [], churchCfg), 1, 'barbares');
  assert.equal(faith.factorFor({ x: 600, y: 600, playerId: 1 }, [], new WorldConfig({})), 1, 'monde sans église');
});

test('combat : sans foi, l’attaque et la défense des troupes valent moitié', () => {
  const base = combat.resolve({ attackers: { axe: 100 }, defenders: { spear: 50 } });
  const att = combat.resolve({ attackers: { axe: 100 }, defenders: { spear: 50 }, attackerFaith: 0.5 });
  assert.equal(att.attackerFaith, 0.5);
  assert.ok(att.attackerLossRatio > base.attackerLossRatio);
  const def = combat.resolve({ attackers: { axe: 100 }, defenders: { spear: 50 }, defenderFaith: 0.5 });
  assert.ok(def.defenseStrength < base.defenseStrength);
});

test('module du monde : église et première église seulement sur les mondes avec église', async () => {
  const ids = (cfg) => registry.buildingsFor(cfg).map((x) => x.id);
  assert.ok(ids(churchCfg).includes('church') && ids(churchCfg).includes('church_f'));
  assert.ok(!ids(new WorldConfig({})).includes('church'));
  assert.equal(a.buildings.church_f, 1, 'premier village : première église déjà construite');
  const carol = await AuthService.register({ username: 'Carol', email: 'c@example.com', password: 'motdepasse' });
  const { village } = await WorldService.join(carol, 'sans', { now: T0 });
  assert.equal(village.buildings.church_f, undefined);
});

test('construction : une église par village, une seule première église par joueur', async () => {
  await Village.update({ buildings: { ...a.buildings, main: 5, farm: 20, storage: 20 }, wood: 50000, stone: 50000, iron: 50000, resourcesAt: T0 }, { where: { id: a.id } });
  const blockers = (id, villageId) => VillageService.withVillage(villageId, async (ctx) => VillageService.buildOption(ctx, registry.building(id)).blockers, { now: T0 });
  assert.ok((await blockers('church', a.id)).includes('Ce village a déjà une première église'));

  const a2 = await WorldService.createVillage(world, { x: a.x + 20, y: a.y, player: { id: a.playerId }, name: 'Avant-poste', buildings: { main: 5, farm: 20, storage: 20, place: 1 }, now: T0 });
  assert.ok((await blockers('church_f', a2.id)).includes('Vous avez déjà une première église'));
  assert.ok(!(await blockers('church', a2.id)).includes('Ce village a déjà une première église'));
  // Hors de la zone de la première église (20 cases) : le village se bat à 50 %.
  assert.equal(await FaithService.factor(a2, world.getConfig()), 0.5);
  assert.equal(await FaithService.factor(a, world.getConfig()), 1);
  await a2.destroy();
});

test('attaque : la confirmation et le rapport donnent la foi ; la première église résiste aux catapultes', async () => {
  const cfg = world.getConfig();
  const far = await WorldService.createVillage(world, { x: b.x + 15, y: b.y, player: { id: a.playerId }, name: 'Loin', buildings: { main: 1, farm: 30, storage: 1, place: 1 }, now: T0 });
  await far.update({ units: { axe: 100, catapult: 10 } });
  const ctx = await sequelize.transaction((t) => VillageService.refresh(far.id, t, T0));
  const plan = await CommandService.plan(ctx, { x: b.x, y: b.y, type: 'attack', units: { axe: 100 } });
  assert.equal(plan.faith, 0.5);
  await assert.rejects(CommandService.plan(ctx, { x: b.x, y: b.y, type: 'attack', units: { catapult: 10 }, catapultTarget: 'church_f' }), /Cible des catapultes invalide/);

  const cmd = await CommandService.send(far.id, { x: b.x, y: b.y, type: 'attack', units: { axe: 100 } }, { now: T0 });
  await CommandService.processDue(cmd.arrivesAt, maxLoss);
  const report = await Report.findOne({ where: { playerId: a.playerId, type: 'attack' }, order: [['id', 'DESC']] });
  assert.deepEqual(report.data.faith, { attacker: 0.5, defender: 1 });
  assert.equal(cfg.church.faithless, 0.5);
});

test('conquête : l’église du village disparaît', async () => {
  await Village.update({
    resourcesAt: T0, units: { axe: 8000, snob: 4 },
    buildings: { main: 20, smith: 20, market: 10, snob: 1, farm: 30, storage: 30, place: 1, barracks: 1, church_f: 1 },
  }, { where: { id: a.id } });
  await Player.update({ coins: 10 }, { where: { id: a.playerId } });
  const start = T0.getTime() + 86400000;
  let last;
  for (let i = 0; i < 4; i++) {
    last = await CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { axe: 2000, snob: 1 } }, { now: new Date(start + i * 1000) });
  }
  await CommandService.processDue(last.arrivesAt, maxLoss);
  const conquered = await Village.findByPk(b.id);
  assert.equal(conquered.playerId, a.playerId);
  assert.equal(conquered.buildings.church_f, undefined);
  assert.ok(await World.findByPk(world.id));
});
