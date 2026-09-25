'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Transport, MarketOffer, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const TradeService = require('../src/services/TradeService');
const CommandService = require('../src/services/CommandService');
const formulas = require('../src/game/formulas');

const T0 = new Date('2026-09-24T12:00:00Z');
const at = (h) => new Date(T0.getTime() + h * 3600000);
let a;
let b;

const load = (id, now) => VillageService.withVillage(id, async (ctx, t) => ({ ctx, merchants: await TradeService.merchants(ctx, t) }), { now });

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  const u1 = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  const u2 = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  ({ village: a } = await WorldService.join(u1, 'w1', { now: T0 }));
  ({ village: b } = await WorldService.join(u2, 'w1', { now: T0 }));
  await Village.update({
    resourcesAt: T0, wood: 50000, stone: 50000, iron: 50000, units: { light: 100 },
    buildings: { main: 5, farm: 10, storage: 25, market: 10, place: 1 },
  }, { where: { id: a.id } });
  await Village.update({
    resourcesAt: T0, wood: 500, stone: 500, iron: 5000,
    buildings: { main: 3, farm: 5, storage: 5, market: 1 },
  }, { where: { id: b.id } });
});

test.after(() => sequelize.close());

test('marchands : nombre selon le niveau du marché', () => {
  assert.deepEqual([0, 1, 10, 11, 12, 20, 25].map(formulas.merchantCount), [0, 1, 10, 11, 14, 110, 235]);
});

test('envoi : marchands occupés aller et retour, excédent perdu à la livraison', async () => {
  const tr = await TradeService.send(a.id, { x: b.x, y: b.y, resources: { wood: 2500, stone: 0, iron: 0 } }, { now: T0 });
  assert.equal(tr.merchants, 3);
  assert.equal(+tr.arrivesAt - +T0, TradeService.travelSeconds(a, b, { market: { merchantSpeed: 6 }, speed: 1, unitSpeed: 1 }) * 1000);
  let { merchants } = await load(a.id, T0);
  assert.deepEqual(merchants, { total: 10, busy: 3, free: 7 });

  await CommandService.processDue(tr.arrivesAt);
  const { ctx } = await load(b.id, tr.arrivesAt);
  assert.equal(Math.round(ctx.state.resources.wood), Math.min(ctx.state.storageCapacity(), 500 + 2500 + Math.round(5 * (tr.arrivesAt - T0) / 3600000)));
  assert.equal(await Report.count({ where: { playerId: b.playerId, type: 'trade' } }), 1);

  const back = await Transport.findOne({ where: { type: 'return' } });
  ({ merchants } = await load(a.id, tr.arrivesAt));
  assert.equal(merchants.busy, 3, 'les marchands doivent encore rentrer');
  await CommandService.processDue(back.arrivesAt);
  ({ merchants } = await load(a.id, back.arrivesAt));
  assert.equal(merchants.free, 10);
});

test('offres : réservation, rapport maximal, acceptation et retrait', async () => {
  const now = at(10);
  await assert.rejects(
    TradeService.createOffer(a.id, { sellResource: 'wood', sellAmount: 4000, buyResource: 'iron', buyAmount: 1000, count: 1 }, { now }),
    /1:3/,
  );
  const before = (await load(a.id, now)).ctx.state.resources.wood;
  const offer = await TradeService.createOffer(a.id, { sellResource: 'wood', sellAmount: 1000, buyResource: 'iron', buyAmount: 1200, count: 2 }, { now });
  let { ctx, merchants } = await load(a.id, now);
  assert.equal(Math.round(before - ctx.state.resources.wood), 2000);
  assert.equal(merchants.busy, 2);

  await assert.rejects(TradeService.acceptOffer(a.id, offer.id, 1, { now }), /propres offres/);
  await assert.rejects(TradeService.acceptOffer(b.id, offer.id, 1, { now }), /2 marchand/, 'Bob n’a qu’un marchand pour 1 200 fer');

  await Village.update({ buildings: { main: 3, farm: 5, storage: 5, market: 5 } }, { where: { id: b.id } });
  await TradeService.acceptOffer(b.id, offer.id, 1, { now });
  await offer.reload();
  assert.equal(offer.count, 1);
  assert.equal(await Transport.count({ where: { type: 'delivery' } }), 2);
  assert.equal(await Report.count({ where: { playerId: a.playerId, type: 'trade' } }), 1);

  await CommandService.processDue(at(20));
  ({ ctx } = await load(a.id, at(20)));
  const ironA = ctx.state.resources.iron;
  assert.ok(ironA >= 50000 + 1200 - 1, 'Alice a reçu le fer');

  const woodBefore = ctx.state.resources.wood;
  await TradeService.cancelOffer(a.id, offer.id, { now: at(20) });
  ({ ctx, merchants } = await load(a.id, at(20)));
  assert.equal(Math.round(ctx.state.resources.wood - woodBefore), 1000);
  assert.equal(await MarketOffer.count(), 0);
  assert.equal(merchants.free, 10);
});

test('ordre chronologique : une livraison arrivée avant une attaque est pillée', async () => {
  const now = at(30);
  await Village.update({ resourcesAt: now, wood: 0, stone: 0, iron: 0 }, { where: { id: b.id } });
  await TradeService.send(a.id, { x: b.x, y: b.y, resources: { wood: 3000, stone: 0, iron: 0 } }, { now });
  const atk = await CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { light: 100 } }, { now });
  await CommandService.processDue(atk.arrivesAt, { rng: () => 0.5 });
  const ret = await (require('../src/models').Command).findOne({ where: { type: 'return' } });
  // Bob n'avait plus rien : tout le bois pillé vient de la livraison (plafonnée par son entrepôt 5).
  const { ctx } = await load(b.id, atk.arrivesAt);
  assert.equal(ret.loot.wood, ctx.state.storageCapacity(), `butin en bois : ${ret.loot.wood}`);
});
