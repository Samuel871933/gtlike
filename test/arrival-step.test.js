'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Command } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const CommandService = require('../src/services/CommandService');
const { arrivalAt } = require('../src/game/movement');
const serverSettings = require('../src/game/serverSettings');

test.before(() => sequelize.sync({ force: true }));
test.after(() => sequelize.close());

test('précision des arrivées : arrondi à la tranche supérieure', () => {
  const t = Date.parse('2026-10-01T12:00:00.926Z');
  assert.equal(arrivalAt(t, { arrivalStepMs: 1 }).toISOString(), '2026-10-01T12:00:00.926Z');
  assert.equal(arrivalAt(t, { arrivalStepMs: 100 }).toISOString(), '2026-10-01T12:00:01.000Z');
  assert.equal(arrivalAt(t, { arrivalStepMs: 10 }).toISOString(), '2026-10-01T12:00:00.930Z');
  assert.equal(arrivalAt(t, { arrivalStepMs: 1000 }).toISOString(), '2026-10-01T12:00:01.000Z');
  assert.equal(arrivalAt(Date.parse('2026-10-01T12:00:01.000Z'), { arrivalStepMs: 100 }).toISOString(), '2026-10-01T12:00:01.000Z', 'déjà sur la tranche');
  // Réglage proposé à la création d'un serveur, à la milliseconde par défaut.
  const setting = serverSettings.SETTINGS.find((s) => s.key === 'arrivalStepMs');
  assert.deepEqual(setting.options.map(([v]) => v), [1, 10, 100, 1000]);
  assert.equal(serverSettings.formValue(setting), 1);
});

test('monde à 100 ms : l’attaque et son retour arrivent sur des dixièmes de seconde', async () => {
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0, arrivalStepMs: 100 } });
  const user = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  const { village } = await WorldService.join(user, 'w1');
  const barb = await Village.findOne({ where: { playerId: null } });
  await village.update({ units: { axe: 30 }, buildings: { ...village.buildings, place: 1 } });
  const now = new Date('2026-10-01T12:00:00.123Z');
  const cmd = await CommandService.send(village.id, { x: barb.x, y: barb.y, type: 'attack', units: { axe: 30 } }, { now });
  assert.equal(new Date(cmd.arrivesAt).getTime() % 100, 0, `attaque : ${new Date(cmd.arrivesAt).toISOString()}`);
  assert.ok(new Date(cmd.arrivesAt) >= now, 'jamais avant l’arrivée exacte');
  await CommandService.processDue(new Date(cmd.arrivesAt));
  const back = await Command.findOne({ where: { type: 'return', originVillageId: village.id } });
  assert.equal(new Date(back.arrivesAt).getTime() % 100, 0, `retour : ${new Date(back.arrivesAt).toISOString()}`);
});

test('monde à 100 ms : les marchands aussi (livraison et retour)', async () => {
  const { Transport } = require('../src/models');
  const TradeService = require('../src/services/TradeService');
  const user = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  const { village: to } = await WorldService.join(user, 'w1');
  const from = await Village.findOne({ where: { name: 'Village de Alice' } });
  await from.update({ wood: 5000, buildings: { ...from.buildings, market: 5 } });
  const now = new Date('2026-10-01T12:00:00.123Z');
  const tr = await TradeService.send(from.id, { x: to.x, y: to.y, resources: { wood: 1000, stone: 0, iron: 0 } }, { now });
  assert.equal(new Date(tr.arrivesAt).getTime() % 100, 0, `livraison : ${new Date(tr.arrivesAt).toISOString()}`);
  await CommandService.processDue(new Date(tr.arrivesAt));
  const back = await Transport.findOne({ where: { type: 'return', originVillageId: from.id } });
  assert.equal(new Date(back.arrivesAt).getTime() % 100, 0, `retour : ${new Date(back.arrivesAt).toISOString()}`);
});
