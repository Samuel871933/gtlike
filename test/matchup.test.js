'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Village, Player, Tribe, MatchQueue, MatchRating, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const MatchService = require('../src/services/MatchService');
const mu = require('../src/game/matchup');

let n = 0;
const register = (name) => {
  n += 1;
  return AuthService.register({ username: `${name}${n}`, email: `${name}${n}@example.com`, password: 'motdepasse' });
};

test.before(() => sequelize.sync({ force: true }));
test.after(() => sequelize.close());

test('ligues : placement, divisions IV → I, Légende sans division', () => {
  assert.equal(mu.leagueOf(1000, 2).label, 'Placement 2/5');
  assert.equal(mu.leagueOf(1000, 5).label, 'Bronze II');
  assert.equal(mu.leagueOf(900, 5).label, 'Bronze IV');
  assert.equal(mu.leagueOf(1099, 5).label, 'Bronze I');
  assert.equal(mu.leagueOf(1100, 5).label, 'Fer IV');
  assert.equal(mu.leagueOf(899, 5).label, 'Bois I');
  assert.equal(mu.leagueOf(100, 5).label, 'Bois IV');
  assert.equal(mu.leagueOf(2400, 50).label, 'Légende');
});

test('elo : gain plus fort contre plus fort, placement plus rapide, somme nulle à égalité de niveau', () => {
  assert.equal(mu.eloDelta(1000, 1000, 1, 40), 12);
  assert.equal(mu.eloDelta(1000, 1000, 0, 40), -12);
  assert.ok(mu.eloDelta(1000, 1200, 1, 40) > mu.eloDelta(1000, 800, 1, 40));
  assert.ok(mu.eloDelta(1000, 1000, 1, 0) > mu.eloDelta(1000, 1000, 1, 40));
  assert.equal(mu.eloDelta(1000, 1000, 0.5, 40), 0);
});

test('matchmaking : la plus ancienne entrée d’abord, équipes complètes et équilibrées, fenêtre d’elo qui s’élargit', () => {
  const now = new Date();
  const e = (id, size, rating, ago = 0) => ({ id, size, rating, queuedAt: new Date(now - ago) });
  // Un groupe de 2 et deux joueurs seuls : 2v2, le groupe contre les deux seuls.
  const found = mu.formMatch([e(1, 2, 1000), e(2, 1, 1010), e(3, 1, 990)], 2, now);
  assert.deepEqual(found.teams.map((t) => t.map((x) => x.id)), [[1], [2, 3]]);
  // Équilibre : 1200 + 800 contre 1000 + 1000 plutôt que 1200 + 1000 contre 800 + 1000.
  const balanced = mu.formMatch([e(1, 1, 1200), e(2, 1, 1000), e(3, 1, 1000), e(4, 1, 800)], 2, new Date(now.getTime() + 120000));
  const avg = (t) => t.reduce((s, x) => s + x.rating, 0) / t.length;
  assert.equal(avg(balanced.teams[0]), avg(balanced.teams[1]));
  // Trop loin en elo : pas de partie… jusqu'à ce que l'attente élargisse la fenêtre.
  assert.equal(mu.formMatch([e(1, 1, 1000), e(2, 1, 1500)], 1, now), null);
  assert.ok(mu.formMatch([e(1, 1, 1000, 120000), e(2, 1, 1500)], 1, now));
  // Pas assez de joueurs.
  assert.equal(mu.formMatch([e(1, 1, 1000), e(2, 1, 1000), e(3, 1, 1000)], 2, now), null);
});

test('file et groupes : un groupe trop grand pour le format est refusé, seul le chef lance la recherche', async () => {
  const [a, b] = [await register('Chef'), await register('Ami')];
  const group = await MatchService.createGroup(a);
  await MatchService.joinGroup(b, group.code.toLowerCase());
  await assert.rejects(MatchService.enqueue(a, '1v1'), /au moins 2v2/);
  await assert.rejects(MatchService.enqueue(b, '2v2'), /Seul le chef/);
  await MatchService.enqueue(a, '3v3');
  const status = await MatchService.status(b.id);
  assert.equal(status.queue.format, '3v3');
  assert.equal(status.group.members.length, 2);
  // Un départ du groupe arrête sa recherche.
  await MatchService.leaveGroup(b);
  assert.equal(await MatchQueue.count(), 0);
  await MatchService.leaveGroup(a);
});

test('file : une entrée sans nouvelles depuis une minute est retirée', async () => {
  const u = await register('Absent');
  const now = new Date();
  await MatchService.enqueue(u, '5v5', new Date(now - MatchService.QUEUE_STALE_MS - 1000));
  await MatchService.matchmake(now);
  assert.equal((await MatchService.status(u.id)).queue, null);
});

/** Partie 2v2 : un groupe de deux contre deux joueurs seuls. */
async function startTwoVsTwo() {
  const users = [await register('Bleu'), await register('Bleu'), await register('Rouge'), await register('Rouge')];
  const group = await MatchService.createGroup(users[0]);
  await MatchService.joinGroup(users[1], group.code);
  const now = new Date();
  await MatchService.enqueue(users[0], '2v2', now);
  await MatchService.enqueue(users[2], '2v2', now);
  await MatchService.enqueue(users[3], '2v2', now);
  const [match] = await MatchService.matchmake(now);
  await MatchService.leaveGroup(users[0]);
  return { users, match, now };
}

test('partie : monde rapide hors des listes, une tribu par équipe, villages face à face avec leur armée', async () => {
  const { users, match } = await startTwoVsTwo();
  assert.ok(match);
  const world = await World.findByPk(match.worldId);
  assert.ok(world.isMatch());
  assert.ok(!world.isPrivate());
  assert.equal(world.isOpen, false);
  const cfg = world.getConfig();
  assert.deepEqual([cfg.speed, cfg.unitSpeed], [600, 1]);
  assert.ok(!cfg.hasFeature('archer') && !cfg.hasFeature('knight'), 'sans archers ni paladin');
  assert.ok(!cfg.tutorial.active && !cfg.buildRewards.active, 'sans quêtes ni récompenses');
  assert.equal(require('../src/services/AchievementService').definitionsFor(cfg).length, 0, 'sans succès');
  assert.equal(require('../src/services/SealService').canEarn(world), false, 'sans sceaux');
  assert.ok(!(await WorldService.listForUser(users[0].id)).some((w) => w.world.id === world.id));

  const status = await MatchService.status(users[0].id);
  assert.equal(status.match.slug, world.slug);
  assert.equal(status.match.team, 1);
  assert.equal((await MatchService.status(users[2].id)).match.team, 2);
  assert.equal(await Tribe.count({ where: { worldId: world.id } }), 2);

  const players = await Player.findAll({ where: { worldId: world.id }, include: [Village] });
  assert.equal(players.length, 4);
  assert.equal(new Set(players.map((p) => p.Villages[0].x)).size, 2, 'deux lignes de villages');
  assert.equal(players[0].Villages[0].units.axe, mu.START_UNITS.axe);
  assert.equal(await Village.count({ where: { worldId: world.id, playerId: null } }), 8);

  // Équipes figées pendant la partie ; plus de recherche possible tant qu'elle dure.
  await assert.rejects(TribeService.leave(players[0].id), /ne changent pas/);
  await assert.rejects(TribeService.create(players[0].id, { name: 'Dissidents', tag: 'DIS' }), /ne changent pas/);
  await assert.rejects(MatchService.enqueue(users[0], '1v1'), /partie en cours/);
});

test('conquête : l’équipe qui n’a plus de village perd, elo mis à jour, monde en paix', async () => {
  const { users, match, now } = await startTwoVsTwo();
  const red = await Player.findAll({ where: { worldId: match.worldId, userId: [users[2].id, users[3].id] } });
  const blue = await Player.findOne({ where: { worldId: match.worldId, userId: users[0].id } });
  await Village.update({ playerId: blue.id }, { where: { playerId: red.map((p) => p.id) } });

  const [ended] = await MatchService.checkRunning(now);
  assert.equal(ended.winnerTeam, 1);
  assert.equal(ended.reason, 'conquest');
  const world = await World.findByPk(match.worldId);
  assert.ok(world.endedAt);
  const ratings = await Promise.all(users.map((u) => MatchRating.findOne({ where: { userId: u.id, ladder: 'team' } })));
  assert.deepEqual(ratings.map((r) => r.elo), [1024, 1024, 976, 976]);
  assert.deepEqual(ratings.map((r) => r.wins), [1, 1, 0, 0]);
  assert.ok(await Report.count({ where: { playerId: blue.id, type: 'world' } }));
  // Ni succès débloqué pendant la partie (conquête, victoire), ni rapport de succès.
  await require('../src/services/AchievementService').evaluateWorld(world);
  assert.equal(await Report.count({ where: { playerId: blue.id, type: 'award' } }), 0);
  // Partie terminée : on peut rechercher à nouveau.
  assert.equal((await MatchService.status(users[0].id)).match, null);
  assert.equal((await MatchService.history(users[2].id))[0].result, 'loss');
});

test('fin du temps : l’équipe qui a le plus de points gagne ; abandon de toute une équipe', async () => {
  const [a, b] = [await register('Duel'), await register('Duel')];
  const now = new Date();
  await MatchService.enqueue(a, '1v1', now);
  await MatchService.enqueue(b, '1v1', now);
  const [match] = await MatchService.matchmake(now);
  const pb = await Player.findOne({ where: { worldId: match.worldId, userId: b.id } });
  await pb.update({ killsAttacker: 500 });
  // Les autres parties en cours (tests précédents) se terminent aussi : on suit celle-ci.
  const mine = (list) => list.find((m) => m.id === match.id);
  assert.equal(mine(await MatchService.checkRunning(new Date(now.getTime() + 60000))), undefined);
  const ended = mine(await MatchService.checkRunning(new Date(match.endsAt.getTime() + 1000)));
  assert.equal(ended.reason, 'time');
  assert.equal(ended.winnerTeam, 2);
  assert.equal(ended.scores[1] - ended.scores[0], 500);

  await MatchService.enqueue(a, '1v1', now);
  await MatchService.enqueue(b, '1v1', now);
  await MatchService.matchmake(now);
  await MatchService.forfeit(a, new Date(match.endsAt.getTime() + 5000));
  const [last] = await MatchService.history(a.id, 1);
  assert.deepEqual([last.result, last.reason], ['loss', 'forfeit']);
});

test('classement : comptes placés seulement, par elo, rang et ligues comptés par la base', async () => {
  const users = [await register('Haut'), await register('Bas'), await register('Neuf')];
  await MatchRating.bulkCreate([
    { userId: users[0].id, ladder: 'duel', elo: 1550, games: 12 },
    { userId: users[1].id, ladder: 'duel', elo: 950, games: 7 },
    { userId: users[2].id, ladder: 'duel', elo: 1700, games: 2 },
  ]);
  const before = (await MatchService.leaderboard('duel')).rows.map((r) => r.user.id);
  assert.ok(before.indexOf(users[0].id) < before.indexOf(users[1].id));
  assert.ok(!before.includes(users[2].id), 'en placement : pas classé');
  assert.equal(await MatchService.positionOf(users[2].id, 'duel'), null);
  const page = await MatchService.leaderboard('duel', { offset: 0, limit: 1 });
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].position, 1);
  assert.equal(await MatchService.positionOf(page.rows[0].user.id, 'duel'), 1);
  const counts = await MatchService.leagueCounts('duel');
  assert.ok(counts.get('gold') >= 1);
  assert.ok(counts.get('bronze') >= 1);
});
