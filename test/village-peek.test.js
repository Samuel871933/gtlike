'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Player, BuildOrder, RecruitOrder } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');

// Affichage sans échéance (VillageService.peek) : même contexte que le rafraîchissement complet, sans écriture.

const T0 = new Date('2026-09-24T12:00:00Z');
const H = 3600000;
let village;

const load = () => Village.findByPk(village.id, { include: [{ model: Player, attributes: ['id', 'userId', 'sitterId', 'sitterAcceptedAt'] }] });
const view = (ctx) => ({
  resources: ctx.state.resources, units: ctx.state.units, buildings: ctx.state.buildings, loyalty: ctx.state.loyalty,
  research: ctx.state.research, buildOrders: ctx.buildOrders.map((o) => o.id), recruitOrders: ctx.recruitOrders.map((o) => [o.id, o.done]),
  researchOrders: ctx.researchOrders.map((o) => o.id), awayUnits: ctx.awayUnits, pop: ctx.popUsed(),
  slots: ctx.buildQueueSlots, premium: ctx.premium, production: ctx.state.productionPerHour(), storage: ctx.state.storageCapacity(),
});

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { speed: 1, placement: { emptyVillages: 0 } } });
  const u = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  ({ village } = await WorldService.join(u, 'w1', { now: T0 }));
  await Village.update({
    resourcesAt: T0, wood: 500, stone: 500, iron: 500, units: { spear: 10 },
    buildings: { main: 10, barracks: 5, farm: 10, storage: 10, place: 1, wood: 8, stone: 8, iron: 8 },
  }, { where: { id: village.id } });
});

test.after(() => sequelize.close());

test('sans échéance : même état que le rafraîchissement, et rien n’est écrit', async () => {
  const now = new Date(T0.getTime() + 2 * H);
  const peeked = await VillageService.peek(await load(), now);
  assert.ok(peeked);
  assert.equal((await Village.findByPk(village.id)).resourcesAt.getTime(), T0.getTime(), 'pas d’écriture');
  const full = await VillageService.withVillage(village.id, async (c) => c, { now });
  assert.deepEqual(view(peeked), view(full));
});

test('construction et recrutement en cours mais pas finis : même état', async () => {
  const now = new Date(T0.getTime() + 3 * H);
  await VillageService.build(village.id, 'wood', { now });
  await VillageService.recruit(village.id, 'barracks', { spear: 5 }, { now });
  const later = new Date(now.getTime() + 1000);
  const peeked = await VillageService.peek(await load(), later);
  assert.ok(peeked, 'rien d’échu une seconde plus tard');
  assert.deepEqual(view(peeked), view(await VillageService.withVillage(village.id, async (c) => c, { now: later })));
});

test('échéance passée : peek passe la main au rafraîchissement complet', async () => {
  const order = await BuildOrder.findOne({ where: { villageId: village.id } });
  assert.equal(await VillageService.peek(await load(), new Date(order.endsAt)), null, 'construction finie');
  const recruit = await RecruitOrder.findOne({ where: { villageId: village.id } });
  assert.equal(await VillageService.peek(await load(), new Date(recruit.nextAt)), null, 'une recrue prête');

  await BuildOrder.destroy({ where: { villageId: village.id } });
  await RecruitOrder.destroy({ where: { villageId: village.id } });
  const now = new Date(T0.getTime() + 4 * H);
  await Village.update({ militiaUntil: new Date(now.getTime() - 1000) }, { where: { id: village.id } });
  assert.equal(await VillageService.peek(await load(), now), null, 'fin de milice');
});
