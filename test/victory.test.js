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

test('runes : apparition par continent, victoire en détenant la part requise dans chaque continent', async () => {
  const { world, tribe, alice } = await setupWorld({
    type: 'runes', runes: { spawnAfterDays: 0, villagesPerContinent: 2, minPlayerVillages: 1, winPercent: 50, holdDays: 0, garrison: { spear: 10 } },
  });
  await VictoryService.check(world.id, new Date());
  await world.reload();
  const runes = await Village.findAll({ where: { worldId: world.id, special: 'rune' } });
  const keyOf = (v) => `K${Math.floor(v.y / 100)}${Math.floor(v.x / 100)}`;
  assert.deepEqual([...new Set(runes.map(keyOf))].sort(), world.victoryState.continents, 'runes dans chaque continent peuplé');
  assert.equal(runes.length, 2 * world.victoryState.continents.length);
  assert.equal(runes[0].units.spear, 10, 'garnison barbare');
  // Une rune de chaque continent : 50 % partout, victoire.
  const one = world.victoryState.continents.map((k) => runes.find((r) => keyOf(r) === k));
  await Village.update({ playerId: alice.id }, { where: { id: one.map((r) => r.id) } });
  await VictoryService.check(world.id, new Date());
  await world.reload();
  assert.equal(world.winnerTribeId, tribe.id);
});

test('runes : tenir beaucoup de runes ne suffit pas s’il manque un continent', async () => {
  const { world, alice } = await setupWorld({
    type: 'runes', runes: { spawnAfterDays: 0, villagesPerContinent: 4, minPlayerVillages: 1, winPercent: 50, holdDays: 0, garrison: {} },
  });
  // Trois continents d'office (le centre est au coin de quatre) : un village de joueur dans deux continents voisins.
  const { Player: P } = require('../src/models');
  const p = await P.findByPk(alice.id);
  await WorldService.createVillage(world, { x: 450, y: 450, player: p, name: 'NO', buildings: { main: 1 }, now: new Date() });
  await WorldService.createVillage(world, { x: 550, y: 450, player: p, name: 'NE', buildings: { main: 1 }, now: new Date() });
  await VictoryService.check(world.id, new Date());
  await world.reload();
  const ks = world.victoryState.continents;
  assert.ok(ks.length >= 2, ks.join());
  const runes = await Village.findAll({ where: { worldId: world.id, special: 'rune' } });
  const keyOf = (v) => `K${Math.floor(v.y / 100)}${Math.floor(v.x / 100)}`;
  // Toutes les runes sauf celles du dernier continent.
  await Village.update({ playerId: alice.id }, { where: { id: runes.filter((r) => keyOf(r) !== ks[ks.length - 1]).map((r) => r.id) } });
  const s = await VictoryService.standings(world, new Date());
  assert.equal(s.leader.filled, ks.length - 1);
  assert.equal(s.met, false);
  await VictoryService.check(world.id, new Date());
  await world.reload();
  assert.equal(world.endedAt, null);
});

test('runes : seuls les continents assez peuplés reçoivent des runes', async () => {
  const { world, alice } = await setupWorld({
    type: 'runes', runes: { spawnAfterDays: 0, villagesPerContinent: 3, minPlayerVillages: 50, winPercent: 60, holdDays: 1, garrison: {} },
  });
  void alice;
  await VictoryService.check(world.id, new Date());
  await world.reload();
  assert.equal(world.victoryState.continents.length, 1, 'aucun continent à 50 villages : le plus peuplé seulement');
  assert.equal(await Village.count({ where: { worldId: world.id, special: 'rune' } }), 3);
});

test('runes : un village de rune conquis se défend mal, morale désactivable', async () => {
  const combat = require('../src/game/combat');
  const runeRules = require('../src/game/runes');
  const WorldConfig = require('../src/game/WorldConfig');
  const cfg = new WorldConfig({ victory: { type: 'runes', runes: { defenseFactor: 0.4, disableMorale: true } } });
  assert.equal(runeRules.defenseFactor(cfg, { special: 'rune', playerId: 1 }), 0.4);
  assert.equal(runeRules.defenseFactor(cfg, { special: 'rune', playerId: null }), 1, 'la garnison barbare garde sa force');
  assert.equal(runeRules.defenseFactor(cfg, { special: null, playerId: 1 }), 1);
  assert.equal(runeRules.moraleApplies(cfg, { special: 'rune' }), false);
  assert.equal(runeRules.defenseFactor(new WorldConfig({}), { special: 'rune', playerId: 1 }), 1, 'monde en domination');
  const fight = (defenseFactor) => combat.resolve({ attackers: { axe: 300 }, defenders: { spear: 1000 }, wall: 0, defenseFactor });
  assert.equal(fight(1).attackerWins, false);
  assert.equal(fight(0.4).attackerWins, true);
  assert.equal(fight(0.4).defenseFactor, 0.4);
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

test('runes : la pénalité de défense s’applique au combat et figure dans le rapport', async () => {
  const { world, alice, bob, a, b } = await setupWorld({ type: 'runes', runes: { defenseFactor: 0.5, spawnAfterDays: 1000 } });
  void alice; void bob;
  await Village.update({ special: 'rune', units: { spear: 50 } }, { where: { id: b.id } });
  await Village.update({ units: { axe: 20 }, buildings: { ...a.buildings, place: 1 } }, { where: { id: a.id } });
  const cmd = await CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { axe: 20 } });
  await CommandService.processDue(new Date(new Date(cmd.arrivesAt).getTime() + 1000));
  const report = await Report.findOne({ where: { playerId: alice.id, type: 'attack' }, order: [['id', 'DESC']] });
  assert.ok(report, 'rapport d’attaque');
  assert.equal(report.data.runePenalty, 0.5);
  assert.equal(world.getConfig().victory.type, 'runes');
});

test('création de serveur : Guerres runiques et pénalité réglables', () => {
  const serverSettings = require('../src/game/serverSettings');
  const body = {};
  for (const st of serverSettings.SETTINGS) {
    const v = serverSettings.formValue(st);
    body[st.key] = typeof v === 'boolean' ? (v ? '1' : '') : v;
  }
  assert.equal(body['victory.runes.defenseFactor'], 50, 'affichée en % de pénalité');
  Object.assign(body, { 'victory.type': 'runes', 'victory.runes.defenseFactor': '60', 'victory.runes.villagesPerContinent': '8' });
  const { config, error } = serverSettings.parse(body);
  assert.equal(error, undefined);
  assert.equal(config.victory.type, 'runes');
  assert.equal(config.victory.runes.defenseFactor, 0.4);
  assert.equal(config.victory.runes.villagesPerContinent, 8);
  assert.match(serverSettings.parse({ ...body, 'victory.type': 'siege' }).error, /choix invalide/);
});
