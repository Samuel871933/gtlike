'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Village, Player, Tribe, TribeInvite } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const CommandService = require('../src/services/CommandService');

const T0 = new Date('2026-09-24T12:00:00Z');
const players = {};
const villages = {};
let tribe;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: { newbieDays: 0, tribe: { memberLimit: 2 } } });
  for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    const { player, village } = await WorldService.join(u, 'w1', { now: T0 });
    players[name] = player;
    villages[name] = village;
    await village.update({ units: { axe: 10, spear: 10 }, buildings: { ...village.buildings, place: 1 } });
  }
});

test.after(() => sequelize.close());

const reload = async (name) => (players[name] = await Player.findByPk(players[name].id));

test('fonder une tribu : nom et tag uniques', async () => {
  tribe = await TribeService.create(players.Alice.id, { name: 'Les Loups', tag: 'LUP' });
  assert.equal((await reload('Alice')).tribeRole, 'duke');
  await assert.rejects(TribeService.create(players.Bob.id, { name: 'Autre', tag: 'LUP' }), /tag est déjà pris/);
  await assert.rejects(TribeService.create(players.Alice.id, { name: 'Encore', tag: 'ENC' }), /déjà dans une tribu/);
  await assert.rejects(TribeService.create(players.Bob.id, { name: 'Okay', tag: 'TROPLONG' }), /tag/);
});

test('invitations : droit d’inviter, limite de membres', async () => {
  await TribeService.invite(players.Alice.id, 'Bob');
  await assert.rejects(TribeService.invite(players.Alice.id, 'Bob'), /déjà invité/);
  const [inv] = await TribeService.invitesFor(players.Bob.id);
  await TribeService.acceptInvite(players.Bob.id, inv.id);
  assert.equal((await reload('Bob')).tribeId, tribe.id);
  assert.equal(players.Bob.tribeRole, 'member');

  await assert.rejects(TribeService.invite(players.Bob.id, 'Carol'), /droit d'inviter/);
  await TribeService.invite(players.Alice.id, 'Carol');
  const [invC] = await TribeService.invitesFor(players.Carol.id);
  await assert.rejects(TribeService.acceptInvite(players.Carol.id, invC.id), /complète/);
  await TribeService.declineInvite(players.Carol.id, invC.id);
  assert.equal(await TribeInvite.count(), 0);
});

test('pas d’attaque entre membres ; soutien réservé à la tribu si le monde l’exige', async () => {
  await assert.rejects(
    CommandService.send(villages.Alice.id, { x: villages.Bob.x, y: villages.Bob.y, type: 'attack', units: { axe: 1 } }),
    /membre de votre tribu/,
  );
  const world = await World.findOne({ where: { slug: 'w1' } });
  await world.update({ config: { ...world.config, tribe: { memberLimit: 2, supportOnlyTribe: true } } });
  await CommandService.send(villages.Alice.id, { x: villages.Bob.x, y: villages.Bob.y, type: 'support', units: { spear: 1 } });
  await assert.rejects(
    CommandService.send(villages.Alice.id, { x: villages.Carol.x, y: villages.Carol.y, type: 'support', units: { spear: 1 } }),
    /réservé à votre tribu/,
  );

  // Carol fonde une tribu, Alice la déclare alliée : le soutien devient possible.
  await TribeService.create(players.Carol.id, { name: 'Les Ours', tag: 'OURS' });
  await TribeService.setRelation(players.Alice.id, 'OURS', 'ally');
  await CommandService.send(villages.Alice.id, { x: villages.Carol.x, y: villages.Carol.y, type: 'support', units: { spear: 1 } });
  assert.equal((await TribeService.relationsOf(tribe.id)).get((await reload('Carol')).tribeId), 'ally');
  const publicProfile = await TribeService.profile(tribe.id);
  assert.equal(Object.hasOwn(publicProfile, 'relations'), false, 'le profil public ne charge pas la diplomatie');
  assert.equal(publicProfile.tribe.announcement, undefined, 'les annonces internes ne sont pas chargées');
  assert.equal((await TribeService.dashboard(await reload('Alice'))).relations[0].type, 'ally');
  await assert.rejects(TribeService.dashboard({ id: players.Carol.id, tribeId: tribe.id }), /pas membre/);
});

test('droits GT : le duc nomme barons et ducs, droits individuels, renvoi selon le titre', async () => {
  await assert.rejects(TribeService.kick(players.Bob.id, players.Alice.id), /ducs et barons/);
  await assert.rejects(TribeService.setRelation(players.Bob.id, 'OURS', 'enemy'), /diplomatie/);

  // Droits individuels : diplomatie cochée, le titre reste « membre ».
  await TribeService.setRights(players.Alice.id, players.Bob.id, { title: 'member', rights: ['diplomacy', 'inconnu'] });
  assert.deepEqual((await reload('Bob')).tribeRights, ['diplomacy']);
  await TribeService.setRelation(players.Bob.id, 'OURS', 'ally');
  assert.equal(TribeService.can(players.Bob, 'invite'), false);

  // Baron : tous les droits sauf ceux du duc.
  await TribeService.setRights(players.Alice.id, players.Bob.id, { title: 'baron' });
  assert.equal((await reload('Bob')).tribeRole, 'baron');
  assert.ok(TribeService.can(players.Bob, 'massMail'));
  await assert.rejects(TribeService.kick(players.Bob.id, players.Alice.id), /ne pouvez pas renvoyer/);
  await assert.rejects(TribeService.setRights(players.Bob.id, players.Alice.id, { title: 'member' }), /ne pouvez pas modifier/);
  await assert.rejects(TribeService.leave(players.Alice.id), /autre duc/);

  // Plusieurs ducs : Alice nomme Bob duc et garde son titre ; elle peut alors partir.
  await TribeService.setRights(players.Alice.id, players.Bob.id, { title: 'duke' });
  assert.equal((await reload('Alice')).tribeRole, 'duke');
  assert.equal((await reload('Bob')).tribeRole, 'duke');
  await assert.rejects(TribeService.kick(players.Bob.id, players.Alice.id), /ne pouvez pas renvoyer/);
  await TribeService.leave(players.Alice.id);
  assert.equal((await reload('Alice')).tribeId, null);
});

test('classement, dissolution quand le dernier membre part', async () => {

  const ranking = await TribeService.ranking(villages.Alice.worldId);
  assert.equal(ranking.length, 2);
  assert.ok(ranking.every((r) => r.members === 1));

  await TribeService.leave(players.Bob.id);
  assert.equal(await Tribe.count({ where: { id: tribe.id } }), 0, 'tribu dissoute');
});

test('fil de la tribu : événements de membres, de diplomatie et divers, filtrés et paginés', async () => {
  const TribeEventService = require('../src/services/TribeEventService');
  const carol = await reload('Carol');
  const all = await TribeEventService.list(carol.tribeId);
  assert.ok(all.events.some((e) => e.type === 'founded' && e.data.actor.name === 'Carol'));

  // Invitation refusée puis acceptée, droits, relation, annonces, renvoi.
  await TribeService.invite(carol.id, 'Alice');
  await TribeService.declineInvite(players.Alice.id, (await TribeService.invitesFor(players.Alice.id))[0].id);
  await TribeService.invite(carol.id, 'Alice');
  await TribeService.acceptInvite(players.Alice.id, (await TribeService.invitesFor(players.Alice.id))[0].id);
  await TribeService.setRights(carol.id, players.Alice.id, { title: 'member', rights: ['invite'] });
  await TribeService.create(players.Bob.id, { name: 'Les Cerfs', tag: 'CERF' });
  await TribeService.setRelation(carol.id, 'CERF', 'enemy');
  await TribeService.updateAnnouncement(carol.id, 'Rassemblement dimanche');
  assert.equal((await Tribe.findByPk(carol.tribeId)).announcement, 'Rassemblement dimanche');
  await TribeService.kick(carol.id, players.Alice.id);

  const types = (await TribeEventService.list(carol.tribeId)).events.map((e) => e.type);
  assert.deepEqual(types, ['kicked', 'announcement', 'relation', 'rights', 'joined', 'invited', 'inviteDeclined', 'invited', 'founded']);
  const diplomacy = await TribeEventService.list(carol.tribeId, { category: 'diplomacy' });
  assert.equal(diplomacy.events.length, 1);
  assert.equal(diplomacy.events[0].data.tribe.tag, 'CERF');
  assert.deepEqual((await TribeEventService.list(carol.tribeId, { category: 'misc' })).events.map((e) => e.type), ['announcement', 'founded']);
  assert.equal((await TribeEventService.list(carol.tribeId, { category: 'noble' })).total, 0);
});

test('fil de la tribu : une conquête apparaît chez le conquérant et chez le perdant', async () => {
  const TribeEventService = require('../src/services/TribeEventService');
  const { TribeEvent } = require('../src/models');
  const [bob, carol] = [await reload('Bob'), await reload('Carol')];
  await TribeEventService.conquest({ village: villages.Carol, winner: bob, loser: carol, at: new Date() });
  const won = await TribeEvent.findOne({ where: { tribeId: bob.tribeId, type: 'conquered' } });
  const lost = await TribeEvent.findOne({ where: { tribeId: carol.tribeId, type: 'lost' } });
  assert.equal(won.data.village.name, villages.Carol.name);
  assert.match(won.data.village.k, /^K\d+$/);
  assert.equal(lost.data.actor.name, 'Bob');
  assert.equal(won.category, 'noble');
});

test('notes de village : partagées avec la tribu seulement si l’auteur partage et le lecteur les affiche', async () => {
  const { VillageNote } = require('../src/models');
  const VillageNoteService = require('../src/services/VillageNoteService');
  const carol = await reload('Carol');
  await Player.update({ tribeId: carol.tribeId, tribeRole: 'member' }, { where: { id: players.Alice.id } });
  const village = villages.Bob;
  await VillageNote.create({ playerId: carol.id, villageId: village.id, text: 'Muraille 20' });
  await VillageNote.create({ playerId: players.Alice.id, villageId: village.id, text: 'Actif le soir' });

  const seen = async (name) => ((await VillageNoteService.visible(await reload(name), [village.id])).get(village.id) || []).map((n) => `${n.mine ? 'moi' : n.author}:${n.text}`);
  assert.deepEqual(await seen('Alice'), ['moi:Actif le soir'], 'rien de la tribu par défaut');
  await VillageNoteService.setTribeSettings(players.Alice.id, { shareVillageNotes: false, showTribeNotes: true });
  assert.deepEqual(await seen('Alice'), ['moi:Actif le soir'], 'Carol ne partage pas encore');
  await VillageNoteService.setTribeSettings(carol.id, { shareVillageNotes: true, showTribeNotes: false });
  assert.deepEqual(await seen('Alice'), ['moi:Actif le soir', 'Carol:Muraille 20']);
  assert.deepEqual(await seen('Carol'), ['moi:Muraille 20'], "Alice ne partage pas, et Carol n'affiche pas");
});

test('ordres sur la carte : ses ordres et ceux des membres qui autorisent leur partage', async () => {
  const { Command } = require('../src/models');
  const MapOrderService = require('../src/services/MapOrderService');
  const target = villages.Bob.id;
  const worldId = villages.Bob.worldId;
  const startsAt = new Date();
  const arrivesAt = new Date(Date.now() + 3600000);
  for (const name of ['Alice', 'Carol', 'Dave']) {
    await Command.create({ worldId, type: 'attack', originVillageId: villages[name].id, targetVillageId: target, units: { axe: 1 }, startsAt, arrivesAt });
  }
  const seen = async () => (await MapOrderService.visible(await reload('Alice'), [target])).get(target);
  assert.ok((await seen()).own.length >= 1);
  assert.ok((await seen()).own.every((o) => o.player === 'Alice'));
  assert.equal((await seen()).tribe.length, 0);
  await Player.update({ showTribeOrders: true }, { where: { id: players.Alice.id } });
  assert.equal((await seen()).tribe.length, 0);
  await Player.update({ shareTribeOrders: true }, { where: { id: players.Carol.id } });
  assert.deepEqual((await seen()).tribe.map((o) => o.player), ['Carol']);
  await Player.update({ showTribeOrders: false }, { where: { id: players.Alice.id } });
  assert.equal((await seen()).tribe.length, 0);
  await Command.create({ worldId, type: 'return', originVillageId: villages.Alice.id, targetVillageId: target,
    units: { axe: 1, spear: 1 }, startsAt, arrivesAt });
  // Le retour s'affiche sur le village attaqué (d'où reviennent les troupes), avec le village où elles rentrent.
  const targetOrders = (await MapOrderService.visible(await reload('Alice'), [target])).get(target);
  const returning = targetOrders.own.find((o) => o.type === 'return');
  assert.equal(returning.origin, villages.Alice.name);
  assert.match(returning.badge, /Unité la plus lente/);
  assert.match(returning.badge, /title="Retour"/);
  assert.match(returning.mapBadge, /title="Retour"/);
  assert.match(returning.mapBadge, /size-3\.5/);
  assert.doesNotMatch(returning.mapBadge, /flex-row-reverse/);
  assert.equal((returning.mapBadge.match(/size-\[18px\]/g) || []).length, 2);
  assert.match(returning.mapBadge, /bg-panel-top/);
  const homeOrders = (await MapOrderService.visible(await reload('Alice'), [villages.Alice.id])).get(villages.Alice.id);
  assert.ok(!homeOrders, 'rien sur le village d’origine');
});
