'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Village, Knight } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const VillageService = require('../src/services/VillageService');
const CommandService = require('../src/services/CommandService');
const KnightSkillService = require('../src/services/KnightSkillService');
const skills = require('../src/game/knightSkills');
const combat = require('../src/game/combat');

const T0 = new Date('2026-09-24T12:00:00Z');
const p = {};
const v = {};
let knight;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({
    slug: 'w1', name: 'Monde 1', config: { newbieDays: 0, moral: false, knightSystem: 'skills', features: { knight: true } },
  });
  for (const name of ['Alice', 'Bob']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u, 'w1', { now: T0 }));
  }
  await Village.update({
    resourcesAt: T0, wood: 5000, stone: 5000, iron: 5000,
    buildings: { main: 5, farm: 20, storage: 10, place: 1, barracks: 1, statue: 1, wood: 10 },
  }, { where: { id: v.Alice.id } });
});

test.after(() => sequelize.close());

test('règles du wiki : nombre de paladins, paliers débloqués aux niveaux 1/8/16/24, meilleur bonus retenu', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10, 34, 35, 100].map(skills.maxKnights), [1, 1, 2, 2, 3, 4, 5, 6, 10]);
  assert.equal(skills.levelForXp(0), 1);
  assert.equal(skills.levelForXp(skills.xpForLevel(8)), 8);
  const k = { level: 8, skills: { assault: 1 } };
  assert.equal(skills.learnBlocker(k, 'assault'), null);
  assert.match(skills.learnBlocker({ level: 8, skills: { assault: 2 } }, 'assault'), /Niveau 16/);
  assert.match(skills.learnBlocker({ level: 2, skills: { assault: 1, phalanx: 1 } }, 'cavalry'), /Aucun livre/);
  const b = skills.bonuses([{ skills: { phalanx: 1 } }, { skills: { phalanx: 3 } }], 'defense');
  assert.equal(b.defense.spear, 0.15, 'le meilleur palier, pas la somme');
  const base = combat.resolve({ attackers: { axe: 100 }, defenders: { sword: 10 } });
  const boosted = combat.resolve({ attackers: { axe: 100 }, defenders: { sword: 10 }, attackerSkills: skills.bonuses([{ skills: { assault: 4 } }], 'attack') });
  assert.ok(Math.abs(boosted.attackStrength - base.attackStrength * 1.3) < 1e-9);
});

test('recrutement : un paladin par village, créé à la fin de la formation', async () => {
  const [order] = await VillageService.recruit(v.Alice.id, 'statue', { knight: 1 }, { now: T0 });
  await assert.rejects(VillageService.recruit(v.Alice.id, 'statue', { knight: 1 }, { now: T0 }), /déjà en formation/);
  await VillageService.withVillage(v.Alice.id, async () => {}, { now: order.endsAt });
  knight = await Knight.findOne({ where: { homeVillageId: v.Alice.id } });
  assert.ok(knight && knight.alive);
  await assert.rejects(VillageService.recruit(v.Alice.id, 'statue', { knight: 1 }, { now: order.endsAt }), /déjà son paladin/);
});

test('expérience, livres et compétences ; bonus de production quand il est au village', async () => {
  const now = new Date(T0.getTime() + 86400000);
  const before = (await VillageService.withVillage(v.Alice.id, async (c) => c, { now })).state.productionPerHour().wood;
  await KnightSkillService.addXp(v.Alice.id, skills.xpForLevel(8));
  await knight.reload();
  assert.equal(knight.level, 8);
  await KnightSkillService.learn(p.Alice.id, knight.id, 'motivation');
  await KnightSkillService.learn(p.Alice.id, knight.id, 'motivation');
  await assert.rejects(KnightSkillService.learn(p.Alice.id, knight.id, 'motivation'), /Niveau 16/);
  const after = (await VillageService.withVillage(v.Alice.id, async (c) => c, { now })).state.productionPerHour().wood;
  assert.ok(Math.abs(after - before * 1.06) < 1e-6, 'Motivation palier 2 : +6 %');
  await KnightSkillService.respec(p.Alice.id, knight.id);
  await knight.reload();
  assert.deepEqual(knight.skills, {});
});

test('le paladin meurt au combat puis se ressuscite à la statue', async () => {
  const now = new Date(T0.getTime() + 2 * 86400000);
  await Village.update({ units: { knight: 1, axe: 5 } }, { where: { id: v.Alice.id } });
  await Village.update({ units: { spear: 500 } }, { where: { id: v.Bob.id } });
  const cmd = await CommandService.send(v.Alice.id, { x: v.Bob.x, y: v.Bob.y, type: 'attack', units: { knight: 1, axe: 5 } }, { now });
  await CommandService.processDue(cmd.arrivesAt, { rng: () => 0.5 });
  await knight.reload();
  assert.equal(knight.alive, false);
  const [order] = await VillageService.recruit(v.Alice.id, 'statue', { knight: 1 }, { now: cmd.arrivesAt });
  await VillageService.withVillage(v.Alice.id, async () => {}, { now: order.endsAt });
  await knight.reload();
  assert.equal(knight.alive, true);
  assert.equal(knight.level, 8, 'il garde son niveau');
});
