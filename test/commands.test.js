'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Command, SupportStack, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const CommandService = require('../src/services/CommandService');

const T0 = new Date('2026-09-24T12:00:00Z');
const noLuck = { rng: () => 0.5 };
let a;
let b;
let barb;

async function setup(village, patch) {
  await Village.update({ resourcesAt: T0, ...patch }, { where: { id: village.id } });
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  const u1 = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  const u2 = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  ({ village: a } = await WorldService.join(u1, 'w1', { now: T0 }));
  ({ village: b } = await WorldService.join(u2, 'w1', { now: T0 }));
  barb = await Village.findOne({ where: { playerId: null } });
  await setup(a, {
    buildings: { main: 5, farm: 10, storage: 10, place: 1, barracks: 5, stable: 3, hide: 0 },
    units: { axe: 200, light: 20, spy: 5, spear: 50 },
  });
  await setup(barb, { buildings: { main: 1, farm: 1, storage: 5, wood: 3 }, units: {}, wood: 1000, stone: 1000, iron: 1000 });
});

test.after(() => sequelize.close());

test('attaque d’un village barbare : combat, pillage, retour et rapport', async () => {
  const cmd = await CommandService.send(a.id, { x: barb.x, y: barb.y, type: 'attack', units: { axe: 100, light: 10 } }, { now: T0 });
  assert.equal(cmd.type, 'attack');
  let ctx = await VillageService.withVillage(a.id, async (c) => c, { now: T0 });
  assert.equal(ctx.state.units.axe, 100, 'les unités quittent le village');
  const popBefore = ctx.popUsed();

  await CommandService.processDue(cmd.arrivesAt, noLuck);
  const ret = await Command.findOne({ where: { type: 'return' } });
  assert.ok(ret, 'les survivants rentrent');
  assert.equal(+ret.arrivesAt - +ret.startsAt, +cmd.arrivesAt - +cmd.startsAt, 'retour aussi long que l’aller');
  const lootTotal = ret.loot.wood + ret.loot.stone + ret.loot.iron;
  assert.equal(lootTotal, 100 * 10 + 10 * 80, 'capacité de transport pleine');

  const report = await Report.findOne({ where: { playerId: a.playerId, type: 'attack' } });
  assert.equal(report.data.attackerWins, true);
  assert.equal(await Report.count({ where: { type: 'defense' } }), 0, 'pas de rapport pour les barbares');
  // Gommette de la carte : dernière attaque sur ce village, butin plein.
  const { LastAttack } = require('../src/models');
  const last = await LastAttack.findOne({ where: { playerId: a.playerId, villageId: barb.id } });
  assert.ok(['win', 'partial'].includes(last.result));
  assert.equal(last.haul, 'full');
  assert.equal(last.reportId, report.id);

  ctx = await VillageService.withVillage(a.id, async (c) => c, { now: cmd.arrivesAt });
  assert.equal(ctx.popUsed(), popBefore, 'les troupes en route comptent dans la ferme');

  const woodBefore = ctx.state.resourcesAtTime(ret.arrivesAt).wood;
  await CommandService.processDue(ret.arrivesAt, noLuck);
  ctx = await VillageService.withVillage(a.id, async (c) => c, { now: ret.arrivesAt });
  assert.equal(ctx.state.units.axe, 200);
  assert.ok(Math.abs(ctx.state.resources.wood - Math.min(ctx.state.storageCapacity(), woodBefore + ret.loot.wood)) < 1e-6);
  assert.equal(await Command.count(), 0);
});

test('éclaireurs seuls : pas de combat, ressources et bâtiments visibles', async () => {
  const now = new Date(T0.getTime() + 86400000);
  const cmd = await CommandService.send(a.id, { x: barb.x, y: barb.y, type: 'attack', units: { spy: 5 } }, { now });
  await CommandService.processDue(cmd.arrivesAt, noLuck);
  const report = await Report.findOne({ where: { playerId: a.playerId }, order: [['id', 'DESC']] });
  assert.ok(report.data.intel.resources && report.data.intel.buildings);
  assert.equal(report.data.attackerWins, null);
  const { LastAttack } = require('../src/models');
  const last = await LastAttack.findOne({ where: { playerId: a.playerId, villageId: barb.id } });
  assert.equal(last.result, 'spy', 'la dernière attaque remplace la précédente');
  assert.equal(await LastAttack.count(), 1);
  await CommandService.processDue(new Date(cmd.arrivesAt.getTime() + 86400000), noLuck);
});

test('annulation : demi-tour, retour après le temps déjà parcouru', async () => {
  const now = new Date(T0.getTime() + 2 * 86400000);
  const cmd = await CommandService.send(a.id, { x: barb.x, y: barb.y, type: 'attack', units: { axe: 1 } }, { now });
  const later = new Date(now.getTime() + 60000);
  await CommandService.cancel(a.id, cmd.id, { now: later });
  await cmd.reload();
  assert.equal(cmd.type, 'return');
  assert.equal(+cmd.arrivesAt, later.getTime() + 60000);
  await assert.rejects(CommandService.cancel(a.id, cmd.id, { now: later }), /introuvable/);
  await CommandService.processDue(cmd.arrivesAt, noLuck);
});

test('soutien : stationné chez l’allié, défend, puis rappelé', async () => {
  const now = new Date(T0.getTime() + 3 * 86400000);
  await assert.rejects(CommandService.send(a.id, { x: a.x, y: a.y, type: 'support', units: { spear: 1 } }, { now }), /propre village/);

  const cmd = await CommandService.send(a.id, { x: b.x, y: b.y, type: 'support', units: { spear: 50 } }, { now });
  await CommandService.processDue(cmd.arrivesAt, noLuck);
  const stack = await SupportStack.findOne({ where: { villageId: b.id } });
  assert.deepEqual(stack.units, { spear: 50 });
  assert.equal(await Report.count({ where: { playerId: b.playerId, type: 'support' } }), 1);

  // Bob se fait attaquer par Alice avec peu de troupes : les lanciers d'Alice le défendent.
  const atk = await CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { axe: 10 } }, { now: cmd.arrivesAt });
  await CommandService.processDue(atk.arrivesAt, noLuck);
  const defense = await Report.findOne({ where: { playerId: b.playerId, type: 'defense' } });
  assert.equal(defense.data.attackerWins, false);
  await stack.reload();
  // Quelques pertes (morale de 75 % pour Alice), mais la défense tient.
  assert.ok(stack.units.spear < 50 && stack.units.spear > 30);

  const u1 = (await Village.findByPk(a.id, { include: ['Player'] })).Player.userId;
  await CommandService.withdrawSupport(stack.id, u1, { now: atk.arrivesAt });
  assert.equal(await SupportStack.count(), 0);
  const back = await Command.findOne({ where: { type: 'return', originVillageId: a.id } });
  assert.equal(back.units.spear, stack.units.spear);
});

test('gommette de la dernière attaque : sans perte, pertes partielles, totales, espionnage ; butin', () => {
  const { outcome } = require('../src/game/lastAttack');
  const attack = (units, losses, loot = {}, carry = 0) => outcome({ attacker: { units, losses }, loot, carry });
  assert.deepEqual(attack({ axe: 10 }, {}, { wood: 100, stone: 0, iron: 0 }, 100), { result: 'win', haul: 'full' });
  assert.deepEqual(attack({ axe: 10 }, { axe: 3 }, { wood: 50 }, 100), { result: 'partial', haul: 'partial' });
  assert.deepEqual(attack({ axe: 10, ram: 2 }, { axe: 10, ram: 2 }), { result: 'loss', haul: null });
  assert.deepEqual(attack({ spy: 5 }, {}), { result: 'spy', haul: null });
  assert.equal(attack({ spy: 5 }, { spy: 5 }).result, 'loss', 'éclaireurs tous tués');
});
