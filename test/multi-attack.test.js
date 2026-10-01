'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Command } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const CommandService = require('../src/services/CommandService');

const T0 = new Date('2026-10-01T12:00:00Z');

async function attacker(slug, name) {
  const user = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
  const { village } = await WorldService.join(user, slug, { now: T0 });
  await Village.update({
    resourcesAt: T0,
    buildings: { main: 5, farm: 10, storage: 10, place: 1, barracks: 5, stable: 3 },
    units: { axe: 300, light: 90 },
  }, { where: { id: village.id } });
  const barb = await Village.findOne({ where: { worldId: village.worldId, playerId: null } });
  return { village, barb };
}

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  await WorldService.createWorld({ slug: 'w2', name: 'Monde 2', config: { newbieDays: 0, arrivalStepMs: 1000 } });
});
test.after(() => sequelize.close());

test('attaques à la suite : arrivées dans l’ordre, 100 ms d’écart par défaut, départ décalé pour les plus rapides', async () => {
  const { village, barb } = await attacker('w1', 'Alice');
  const target = { x: barb.x, y: barb.y, type: 'attack' };
  const cmds = await CommandService.sendMany(village.id, [
    { ...target, units: { axe: 100 } },
    { ...target, units: { axe: 100, light: 30 } },
    { ...target, units: { light: 30 } },
  ], { now: T0 });
  assert.equal(cmds.length, 3);
  const at = cmds.map((c) => +c.arrivesAt);
  assert.equal(at[1] - at[0], 100);
  assert.equal(at[2] - at[1], 100);
  // Cavalerie seule, plus rapide : elle part plus tard, le trajet garde sa durée (retour correct).
  const travel = +cmds[0].arrivesAt - +T0;
  assert.equal(+cmds[0].startsAt, +T0);
  assert.ok(+cmds[2].startsAt > +T0);
  assert.ok(+cmds[2].arrivesAt - +cmds[2].startsAt < travel);
  const ctx = await VillageService.withVillage(village.id, async (c) => c, { now: T0 });
  assert.deepEqual({ axe: ctx.state.units.axe, light: ctx.state.units.light }, { axe: 100, light: 30 });

  // Pas encore partie : l'annulation reste possible et ramène les troupes aussitôt.
  await CommandService.cancel(village.id, cmds[2].id, { now: T0 });
  assert.equal((await Command.findByPk(cmds[2].id)).type, 'return');

  // Une attaque de trop : rien n'est envoyé.
  await assert.rejects(CommandService.sendMany(village.id, [
    { ...target, units: { axe: 60 } },
    { ...target, units: { axe: 60 } },
  ], { now: T0 }), /Pas assez/);
  assert.equal(await Command.count({ where: { originVillageId: village.id, type: 'attack' } }), 2);
});

test('attaques à la suite : écart de la précision des arrivées fixée par le serveur', async () => {
  const { village, barb } = await attacker('w2', 'Bob');
  const target = { x: barb.x, y: barb.y, type: 'attack' };
  const cmds = await CommandService.sendMany(village.id, [
    { ...target, units: { axe: 100 } },
    { ...target, units: { axe: 100 } },
  ], { now: T0 });
  assert.equal(+cmds[1].arrivesAt - +cmds[0].arrivesAt, 1000);
  assert.equal(+cmds[0].arrivesAt % 1000, 0);
});
