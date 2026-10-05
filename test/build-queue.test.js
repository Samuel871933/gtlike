'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, BuildOrder, Entitlement } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const registry = require('../src/game/registry');

let user;
let village;
const RICH = { wood: 400000, stone: 400000, iron: 400000 };

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  user = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  ({ village } = await WorldService.join(user, 'w1'));
  await Village.update({ ...RICH, resourcesAt: new Date(), buildings: { ...village.buildings, main: 20, storage: 30, farm: 30 } }, { where: { id: village.id } });
});

test.after(() => sequelize.close());

// Ordre suivant de la scierie : niveau visé et coût payé.
const next = () => VillageService.withVillage(village.id, async (ctx) => {
  const o = VillageService.buildOption(ctx, registry.building('wood'));
  return { level: o.level, cost: o.cost, blockers: o.blockers, max: ctx.buildQueueMax };
});

test('sans premium : file de 2, sans surcoût', async () => {
  for (let i = 0; i < 2; i++) {
    const { level, cost } = await next();
    assert.deepEqual(cost, registry.building('wood').costFor(level));
    await VillageService.build(village.id, 'wood');
  }
  assert.ok((await next()).blockers.includes('La file de construction est pleine'));
  await BuildOrder.destroy({ where: { villageId: village.id } });
});

test('premium : 5 au prix normal, puis +25 % composés par ordre, jusqu’à 20 ; l’annulation rembourse le surcoût payé', async () => {
  await Village.update({ ...RICH, resourcesAt: new Date() }, { where: { id: village.id } });
  await Entitlement.create({ scope: 'account', userId: user.id, itemKey: 'premium', startsAt: new Date(Date.now() - 60000), source: 'gift' });
  const type = registry.building('wood');
  const factors = [];
  for (let i = 0; i < 7; i++) {
    const { level, cost } = await next();
    factors.push(Math.round((cost.wood / type.costFor(level).wood) * 100) / 100);
    await VillageService.build(village.id, 'wood');
  }
  // Coûts arrondis à l'unité supérieure : à 1 % près.
  [1, 1, 1, 1, 1, 1.25, 1.5625].forEach((f, i) => assert.ok(Math.abs(factors[i] - f) <= 0.01, `ordre ${i + 1} : ×${factors[i]} au lieu de ×${f}`));
  const { max } = await next();
  assert.equal(max, 20);

  // Le 7ᵉ ordre a payé ×1,25² : son annulation en rend 90 %.
  const before = (await Village.findByPk(village.id)).wood;
  const seventh = (await BuildOrder.findAll({ where: { villageId: village.id }, order: [['endsAt', 'ASC']] }))[6];
  await VillageService.cancelBuild(village.id, seventh.id);
  const after = (await Village.findByPk(village.id)).wood;
  assert.ok(Math.abs(after - before - Math.floor(seventh.wood * 0.9)) <= 2, 'remboursement du coût payé, surcoût compris');

  // Plafond : 20 ordres au total.
  // (ordres posés directement : à ×1,25¹⁴, le 20ᵉ coûterait plus que l'entrepôt ne contient)
  const last = await BuildOrder.max('endsAt', { where: { villageId: village.id } });
  for (let n = 6; n < 20; n++) {
    const at = new Date(new Date(last).getTime() + n * 60000);
    await BuildOrder.create({ villageId: village.id, building: 'stone', level: n, startsAt: at, endsAt: new Date(at.getTime() + 60000), wood: 0, stone: 0, iron: 0 });
  }
  assert.ok((await next()).blockers.includes('La file de construction est pleine'));
});
