'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Player, Village, Command } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const CommandService = require('../src/services/CommandService');
const IncomingService = require('../src/services/IncomingService');
const incomingLabel = require('../src/game/incomingLabel');

const T0 = new Date('2026-09-24T12:00:00Z');
let cfg;
let a;
let b;
let alice;
let bob;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0 } });
  cfg = (await World.findOne()).getConfig();
  const u1 = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  const u2 = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  ({ village: a, player: alice } = await WorldService.join(u1, 'w1', { now: T0 }));
  ({ village: b, player: bob } = await WorldService.join(u2, 'w1', { now: T0 }));
  alice = alice || await Player.findByPk(a.playerId);
  bob = bob || await Player.findByPk(b.playerId);
  await Village.update({
    resourcesAt: T0, buildings: { main: 5, farm: 10, storage: 10, place: 1, barracks: 5, stable: 3, garage: 1 },
    units: { axe: 200, light: 50, ram: 10, spy: 5 },
  }, { where: { id: a.id } });
});

test.after(() => sequelize.close());

test('étiquette : unité la plus rapide dont le trajet couvre le temps restant', () => {
  const from = { x: 500, y: 500 };
  const to = { x: 510, y: 500 };
  const table = incomingLabel.travelTable(from, to, cfg, 'attack');
  const ram = table.find((g) => g.units.includes('ram'));
  const axe = table.find((g) => g.units.includes('axe'));
  assert.equal(axe.unit, 'axe', 'les lanciers, haches et archers sont nommés « hache » en attaque');
  assert.deepEqual(incomingLabel.estimate(table, ram.seconds, cfg).unit, 'ram', 'ordre qui vient de partir');
  assert.equal(incomingLabel.estimate(table, axe.seconds + 60, cfg).unit, 'sword', 'plus long qu’une hache : au moins une épée');
  assert.equal(incomingLabel.estimate(table, axe.seconds - 60, cfg).unit, 'axe', 'parti depuis un moment : estimation par défaut');
  assert.equal(incomingLabel.unitFromName('Noble 2/4', cfg), 'snob');
  assert.equal(incomingLabel.unitFromName('cav lourde (500|500)', cfg), 'heavy');
  assert.equal(incomingLabel.unitFromName('Archer monté'), 'marcher', 'sans monde : toutes les unités');
  assert.equal(incomingLabel.unitFromName('Attaque', cfg), null);
  assert.equal(incomingLabel.unitFromName('Guerrier à la hacheBastion 05960|520', cfg), 'axe', 'nom d’unité collé à la suite');
  assert.equal(incomingLabel.unitFromName('BélierBastion 01905|140', cfg), 'ram');
  assert.equal(incomingLabel.unitFromName('Clan du nord', cfg), null, 'abréviation courte : mot entier seulement');
});

test('le noble est exclu au-delà de sa portée', () => {
  const far = incomingLabel.travelTable({ x: 0, y: 0 }, { x: cfg.snob.maxDistance + 50, y: 0 }, cfg, 'attack');
  assert.equal(far.find((g) => g.units.includes('snob')).reachable, false);
  const slowest = far[far.length - 1];
  assert.notEqual(incomingLabel.estimate(far, slowest.seconds, cfg).unit, 'snob');
});

test('aperçu Arrivant : étiqueter, renommer, ignorer, noter', async () => {
  const slow = await CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { ram: 1 } }, { now: T0 });
  const fast = await CommandService.send(a.id, { x: b.x, y: b.y, type: 'attack', units: { light: 10 } }, { now: T0 });

  // Alice ne voit pas les ordres entrants de Bob.
  await assert.rejects(IncomingService.detail(alice.id, slow.id, cfg, T0), /introuvable/);

  let { rows, counts } = await IncomingService.list(bob.id, {});
  assert.equal(counts.attacks, 2);
  assert.deepEqual(rows.map((r) => r.name), ['Attaque', 'Attaque']);

  // Étiqueter juste après l'envoi : bélier et cavalerie légère ; le nom actuel est remplacé.
  await IncomingService.rename(bob.id, [fast.id], 'Fake ?');
  assert.equal(await IncomingService.label(bob.id, [slow.id, fast.id], cfg, T0), 2);
  await slow.reload();
  await fast.reload();
  assert.match(slow.incomingName, /^Bélier \(\d+\|\d+\)$/);
  assert.match(fast.incomingName, /^Cavalerie légère/, 'le nom donné à la main est remplacé');
  await IncomingService.setFormat(bob.id, '%unit% · %player%');
  await IncomingService.label(bob.id, [fast.id], cfg, T0);
  await fast.reload();
  assert.equal(fast.incomingName, 'Cavalerie légère · Alice');

  // Détail : tableau des trajets, l'unité probable est la bonne.
  const detail = await IncomingService.detail(bob.id, slow.id, cfg, T0);
  assert.ok(detail.guess.units.includes('ram'));

  // Recherche, tri, ordres ignorés.
  ({ rows } = await IncomingService.list(bob.id, { q: 'bélier' }));
  assert.deepEqual(rows.map((r) => r.cmd.id), [slow.id]);
  ({ rows } = await IncomingService.list(bob.id, { sort: 'arrival', dir: 'desc' }));
  assert.deepEqual(rows.map((r) => r.cmd.id), [slow.id, fast.id], 'le bélier arrive en dernier');
  await IncomingService.setIgnored(bob.id, [fast.id], true);
  ({ rows, counts } = await IncomingService.list(bob.id, {}));
  assert.deepEqual(rows.map((r) => r.cmd.id), [slow.id]);
  assert.equal(counts.ignored, 1);
  ({ rows } = await IncomingService.list(bob.id, { ignored: true }));
  assert.equal(rows.length, 2);

  await IncomingService.setNote(bob.id, slow.id, '  Noble derrière ?  ');
  assert.equal((await Command.findByPk(slow.id)).incomingNote, 'Noble derrière ?');
  await assert.rejects(IncomingService.setNote(bob.id, slow.id, 'x'.repeat(501)), /500/);
  assert.equal(await IncomingService.rename(alice.id, [slow.id], 'pirate'), 0, 'l’attaquant ne renomme pas l’ordre du défenseur');
});

test('notes partagées avec la tribu sur l’aperçu du village', async () => {
  const u3 = await AuthService.register({ username: 'Chloe', email: 'c@example.com', password: 'motdepasse' });
  const { village: c } = await WorldService.join(u3, 'w1', { now: T0 });
  const chloe = await Player.findByPk(c.playerId);
  const { Tribe } = require('../src/models');
  const tribe = await Tribe.create({ worldId: chloe.worldId, name: 'Les Amis', tag: 'AMI' });
  await Player.update({ tribeId: tribe.id }, { where: { id: [bob.id, chloe.id] } });
  const target = await Village.findByPk(b.id);

  await chloe.reload();
  assert.equal((await IncomingService.sharedFor(chloe, target)).length, 0, 'Chloé n’affiche pas les notes de la tribu');
  await chloe.update({ showTribeNotes: true });
  assert.equal((await IncomingService.sharedFor(chloe, target)).length, 0, 'Bob ne partage pas ses notes');
  await Player.update({ shareVillageNotes: true }, { where: { id: bob.id } });
  const shared = await IncomingService.sharedFor(chloe, target);
  assert.equal(shared.length, 1, 'seul l’ordre non ignoré, nommé ou annoté');
  assert.equal(shared[0].cmd.incomingNote, 'Noble derrière ?');
});

test('repères : doublons par village d’origine, trains à moins d’une seconde, totaux', async () => {
  const base = +T0 + 3 * 3600000;
  const mk = (origin, target, at) => Command.create({
    worldId: a.worldId, type: 'attack', originVillageId: origin.id, targetVillageId: target.id, units: { snob: 1 }, startsAt: T0, arrivesAt: new Date(at),
  });
  const t1 = await mk(a, b, base);
  const t2 = await mk(a, b, base + 100);
  const t3 = await mk(a, b, base + 250);
  const lone = await mk(a, b, base + 60000);
  const all = await IncomingService.find(bob.id);
  const marks = IncomingService.marks(all, cfg);
  const k = marks.get(t1.id).train.k;
  assert.deepEqual([t1, t2, t3].map((c) => marks.get(c.id).train), [{ k, i: 1, n: 3 }, { k, i: 2, n: 3 }, { k, i: 3, n: 3 }]);
  assert.equal(marks.get(lone.id).train, undefined, 'une minute plus tard : pas dans le train');
  const attacks = all.filter((c) => c.type === 'attack' && !c.incomingIgnored);
  assert.equal(marks.get(lone.id).dup.n, attacks.length, 'toutes les attaques non ignorées d’Alice sont des doublons');

  const { totals, rows } = await IncomingService.list(bob.id, { origin: a.id }, cfg);
  assert.equal(totals.players[0].label.name, 'Alice');
  assert.equal(totals.players[0].attacks, attacks.length);
  assert.ok(rows.every((r) => r.cmd.originVillageId === a.id));
  assert.equal((await IncomingService.list(bob.id, { player: 'barb' }, cfg)).rows.length, 0);

  const alerts = await IncomingService.alertState(bob.id);
  assert.equal(alerts.attacks, all.filter((c) => c.type === 'attack').length);
  assert.equal(alerts.lastId, lone.id);
});

test('demande de soutien : texte proposé et message à toute la tribu, sans droit de courrier circulaire', async () => {
  const { ConversationParticipant, ConversationMessage } = require('../src/models');
  const [first] = await IncomingService.find(bob.id, { types: ['attack'] });
  const draft = await IncomingService.supportDraft(bob.id, [first.id], { now: T0, when: require('../src/web/helpers').when });
  assert.match(draft.subject, /^Soutien demandé : /);
  assert.match(draft.body, /muraille niveau \d+ · loyauté 100/);
  assert.match(draft.body, /Alice/);
  await assert.rejects(IncomingService.supportDraft(alice.id, [first.id], { now: T0, when: String }), /au moins une attaque/);

  const conv = await IncomingService.requestSupport(bob.id, draft);
  const chloe = await Player.findOne({ where: { name: 'Chloe' } });
  assert.ok(await ConversationParticipant.findOne({ where: { conversationId: conv.id, playerId: chloe.id } }), 'Chloé reçoit la demande');
  assert.equal((await ConversationMessage.findOne({ where: { conversationId: conv.id } })).body, draft.body);
  await assert.rejects(IncomingService.requestSupport(alice.id, draft), /aucune tribu/);
});
