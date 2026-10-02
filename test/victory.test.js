'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Village, Player, PlayerAchievement, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const CommandService = require('../src/services/CommandService');
const VictoryService = require('../src/services/VictoryService');

const DAY = 86400000;
let n = 0;

/** Un monde avec Alice (tribu, 2 villages) et Bob (sans tribu, 1 village). */
async function setupWorld(victory) {
  n += 1;
  const slug = `v${n}`;
  const world = await WorldService.createWorld({ slug, name: slug, config: { newbieDays: 0, placement: { emptyVillages: 0 }, victory } });
  const users = {};
  for (const name of ['Alice', 'Bob']) {
    users[name] = await AuthService.register({ username: `${name}${n}`, email: `${name}${n}@example.com`, password: 'motdepasse' });
  }
  const { player: alice, village: a } = await WorldService.join(users.Alice, slug);
  const { player: bob, village: b } = await WorldService.join(users.Bob, slug);
  // Deuxième village d'Alice sur une case libre près du premier (Bob est placé au hasard, peut-être juste à côté).
  let spot = null;
  for (let d = 3; !spot; d++) {
    for (const [dx, dy] of [[d, d], [-d, d], [d, -d], [-d, -d]]) {
      if (!spot && !(await Village.count({ where: { worldId: world.id, x: a.x + dx, y: a.y + dy } }))) spot = { x: a.x + dx, y: a.y + dy };
    }
  }
  await WorldService.createVillage(world, { ...spot, player: alice, name: 'A2', buildings: { main: 1 }, now: new Date() });
  const tribe = await TribeService.create(alice.id, { name: `Tribu ${n}`, tag: `T${n}` });
  return { world, alice, bob, a, b, tribe };
}

test.before(() => sequelize.sync({ force: true }));
test.after(() => sequelize.close());

test('domination : fin de partie enclenchée, tenue, victoire et paix', async () => {
  const { world, alice, a, b, tribe } = await setupWorld({
    type: 'dominance', dominance: { warningPercent: 30, warningWorldAgeDays: 0, endgamePercent: 50, minWorldAgeDays: 0, holdDays: 1 },
  });
  const now = new Date();
  const s = await VictoryService.standings(world, now);
  assert.ok(Math.abs(s.leader.percent - 200 / 3) < 1e-9, '2 villages sur 3');

  await VictoryService.check(world.id, now);
  await world.reload();
  assert.equal(world.victoryState.holderName, '[T1] Tribu 1');
  assert.ok(await Report.findOne({ where: { playerId: alice.id, type: 'world', title: { [require('sequelize').Op.like]: 'Fin de partie enclenchée%' } } }));

  await VictoryService.check(world.id, new Date(now.getTime() + 2 * DAY));
  await world.reload();
  assert.ok(world.endedAt);
  assert.equal(world.isOpen, false);
  assert.equal(world.winnerTribeId, tribe.id);
  assert.ok(await PlayerAchievement.findOne({ where: { playerId: alice.id, key: 'worldWinner' } }));

  await Village.update({ units: { axe: 10 }, buildings: { ...a.buildings, place: 1 } }, { where: { id: a.id } });
  await assert.rejects(CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { axe: 1 } }), /en paix/);
});

test('domination : la fin de partie est annulée si la condition n’est plus remplie', async () => {
  const { world, alice, bob } = await setupWorld({
    type: 'dominance', dominance: { warningPercent: 90, warningWorldAgeDays: 0, endgamePercent: 60, minWorldAgeDays: 0, holdDays: 10 },
  });
  await VictoryService.check(world.id, new Date());
  await world.reload();
  assert.ok(world.victoryState.holderId);
  // Bob rejoint une grosse tribu : Alice tombe à 50 %.
  await TribeService.create(bob.id, { name: `Rivale ${n}`, tag: `R${n}` });
  const rival = await Player.findByPk(bob.id);
  const worldObj = await World.findByPk(world.id);
  await WorldService.createVillage(worldObj, { x: 10, y: 10, player: rival, name: 'B2', buildings: { main: 1 }, now: new Date() });
  await VictoryService.check(world.id, new Date());
  await world.reload();
  assert.equal(world.victoryState.holderId, null);
  assert.equal(world.endedAt, null);
  assert.ok(await Report.findOne({ where: { playerId: alice.id, title: { [require('sequelize').Op.like]: 'Fin de partie annulée%' } } }));
});

test('points et villages (joueur) : victoire après la durée de maintien', async () => {
  const { world, alice } = await setupWorld({ type: 'pointsVillages', pointsVillages: { scope: 'player', points: 1, villages: 2, holdHours: 1 } });
  const now = new Date();
  await VictoryService.check(world.id, now);
  await VictoryService.check(world.id, new Date(now.getTime() + 2 * 3600000));
  await world.reload();
  assert.equal(world.winnerPlayerId, alice.id);
});

test('runes : apparition par continent, victoire en détenant la part requise', async () => {
  const { world, tribe, alice } = await setupWorld({
    type: 'runes', runes: { spawnAfterDays: 0, villagesPerContinent: 2, winPercent: 50, holdDays: 0, garrison: { spear: 10 } },
  });
  await VictoryService.check(world.id, new Date());
  const runes = await Village.findAll({ where: { worldId: world.id, special: 'rune' } });
  assert.ok(runes.length >= 2);
  assert.equal(runes[0].units.spear, 10, 'garnison barbare');
  const half = runes.slice(0, Math.ceil(runes.length / 2));
  await Village.update({ playerId: alice.id }, { where: { id: half.map((r) => r.id) } });
  await VictoryService.check(world.id, new Date());
  await world.reload();
  assert.equal(world.winnerTribeId, tribe.id);
});

test('Grand Siège : l’influence s’accumule par quartier tenu, l’objectif baisse chaque semaine', async () => {
  const { world, tribe, alice } = await setupWorld({
    type: 'siege',
    siege: { startAfterDays: 0, villages: 4, influencePerVillagePerDay: 100, requiredInfluence: 1000, reductionEveryDays: 7, reductionPercent: 12, maxReductionPercent: 85, garrison: {} },
  });
  const now = new Date();
  await VictoryService.check(world.id, now);
  const districts = await Village.findAll({ where: { worldId: world.id, special: 'siege' } });
  assert.equal(districts.length, 4);
  await Village.update({ playerId: alice.id }, { where: { id: districts.slice(0, 2).map((d) => d.id) } });

  await VictoryService.check(world.id, new Date(now.getTime() + 3 * DAY));
  await world.reload();
  assert.equal(Math.round(world.victoryState.influence[tribe.id]), 600, '2 quartiers × 100 × 3 jours');
  assert.equal(world.endedAt, null);

  const later = new Date(now.getTime() + 8 * DAY);
  assert.equal((await VictoryService.standings(world, later)).required, 880, '−12 % après une semaine');
  await VictoryService.check(world.id, later);
  await world.reload();
  assert.equal(world.winnerTribeId, tribe.id, '1 000 d’influence ≥ 880');
});
