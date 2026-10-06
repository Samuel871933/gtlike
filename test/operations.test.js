'use strict';

// Opérations de tribu : droit Opérations, cibles (cochées, coordonnées, heure décalée), modification groupée,
// revendications des membres, marquage de la carte, départs et dissolution.

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, World, Player, Village, TribeOperation, TribeOperationTarget, TribeOperationClaim } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const OperationService = require('../src/services/OperationService');
const ArmyTemplateService = require('../src/services/ArmyTemplateService');
const mapView = require('../src/web/mapView');

const p = {};
const v = {};
let cfg;
let op;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  cfg = (await World.findOne()).getConfig();
  for (const name of ['Chef', 'Membre', 'Cible', 'Cible2']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name], village: v[name] } = await WorldService.join(u, 'w1'));
  }
  await TribeService.create(p.Chef.id, { name: 'Les Loups', tag: 'LUP' });
  await TribeService.invite(p.Chef.id, 'Membre');
  await TribeService.acceptInvite(p.Membre.id, (await TribeService.invitesFor(p.Membre.id))[0].id);
  await TribeService.create(p.Cible.id, { name: 'La Révolte', tag: 'REVO' });
  await TribeService.create(p.Cible2.id, { name: 'Les Ours', tag: 'OURS' });
});

test.after(() => sequelize.close());

test('créer une opération : droit Opérations, tribus visées par tag', async () => {
  await assert.rejects(OperationService.create(p.Membre.id, { name: 'Aube', color: '#ff0000', tags: 'REVO' }), /droit Opérations/);
  await assert.rejects(OperationService.create(p.Chef.id, { name: 'Aube', color: '#ff0000', tags: 'XXX' }), /Aucune tribu/);
  await assert.rejects(OperationService.create(p.Chef.id, { name: 'Aube', color: '#ff0000', tags: 'LUP' }), /propres opérations/);
  await assert.rejects(OperationService.create(p.Chef.id, { name: 'Aube', color: 'rouge', tags: 'REVO' }), /Couleur/);
  op = await OperationService.create(p.Chef.id, { name: 'Aube rouge', color: '#FF0000', tags: 'REVO, OURS', note: 'Nobles en dernier' });
  assert.equal(op.color, '#ff0000');
  assert.equal(op.targetTribeIds.length, 2);

  await TribeService.setRights(p.Chef.id, p.Membre.id, { title: 'member', rights: ['operations'] });
  const list = await OperationService.list(p.Membre.id);
  assert.equal(list.manager, true);
  assert.equal(list.operations[0].op.name, 'Aube rouge');
  assert.deepEqual(list.operations[0].tribes.map((t) => t.tag).sort(), ['OURS', 'REVO']);
  await TribeService.setRights(p.Chef.id, p.Membre.id, { title: 'member', rights: [] });

  await assert.rejects(OperationService.list(p.Cible.id).then((l) => OperationService.detail(p.Cible.id, op.id)), /introuvable/, 'réservée à la tribu');
});

test('ajouter des cibles : villages filtrés des tribus visées, coordonnées, attaques espacées à la seconde', async () => {
  const detail = await OperationService.detail(p.Chef.id, op.id);
  assert.equal(detail.candidates.villages.length, 2);
  const only = await OperationService.detail(p.Chef.id, op.id, { ap: p.Cible.id });
  assert.deepEqual(only.candidates.villages.map((x) => x.village.id), [v.Cible.id]);

  const extra = await Village.create({ worldId: v.Cible.worldId, name: 'Barbare', x: 415, y: 410, points: 100, resourcesAt: new Date() });
  await assert.rejects(OperationService.addTargets(p.Chef.id, op.id, { coords: '1|1' }, cfg), /Aucun village en 1\|1/);
  const res = await OperationService.addTargets(p.Chef.id, op.id, {
    ids: [String(v.Cible.id), String(v.Cible2.id)], count: '2', axe: '4000', light: '2500', ram: '250',
    arrival: '2026-10-07T20:00:00', spacing: '1', note: 'Nettoyage',
  }, cfg);
  assert.deepEqual(res, { added: 2, requests: 2, skipped: 0 });
  // Une seule attaque : pas d'écart.
  await OperationService.addTargets(p.Chef.id, op.id, { coords: '415|410', count: '1', snob: '1', axe: '200', arrival: '2026-10-07T20:00:05', spacing: '9' }, cfg);
  // Même ajout relancé : doublon exact ignoré.
  const again = await OperationService.addTargets(p.Chef.id, op.id, { ids: [String(v.Cible.id)], count: '2', axe: '4000', light: '2500', ram: '250', arrival: '2026-10-07T20:00:00', spacing: '1' }, cfg);
  assert.deepEqual(again, { added: 0, requests: 0, skipped: 1 });

  const all = await OperationService.detail(p.Membre.id, op.id, { vue: 'all' });
  const rows = all.targets.rows;
  assert.deepEqual(rows.map((x) => x.villageId), [v.Cible.id, v.Cible2.id, extra.id]);
  assert.deepEqual(rows[0].units, { axe: 4000, light: 2500, ram: 250 });
  assert.equal(OperationService.slotTime(rows[0], 1) - OperationService.slotTime(rows[0], 0), 1000);
  assert.equal(rows[2].spacing, 0);
  assert.equal(OperationService.isNoble(rows[2]), true);
  assert.equal(all.stats.wanted, 5);
  assert.equal(all.stats.nobles, 1);

  // Un modèle par attaque : une demande d'une attaque par jeu de troupes, aux heures décalées ; le village garde ses
  // demandes précédentes (vagues).
  await assert.rejects(OperationService.addTargets(p.Chef.id, op.id, { ids: [String(v.Cible2.id)], mode: 'each', count: '2', a0_axe: '100' }, cfg), /Attaque 2/);
  const waves = await OperationService.addTargets(p.Chef.id, op.id, {
    ids: [String(v.Cible2.id)], mode: 'each', count: '3', arrival: '2026-10-07T21:00:00', spacing: '2',
    a0_axe: '6000', a0_ram: '300', a1_catapult: '100', a1_axe: '1000', a2_snob: '1', a2_axe: '100',
  }, cfg);
  assert.deepEqual(waves, { added: 1, requests: 3, skipped: 0 });
  const onCible2 = (await OperationService.detail(p.Chef.id, op.id, { vue: 'all' })).targets.rows.filter((x) => x.villageId === v.Cible2.id);
  assert.equal(onCible2.length, 4);
  assert.deepEqual(onCible2.slice(1).map((x) => [x.count, x.arrivalAt.toISOString(), Object.keys(x.units).sort().join()]), [
    [1, new Date('2026-10-07T21:00:00').toISOString(), 'axe,ram'],
    [1, new Date('2026-10-07T21:00:02').toISOString(), 'axe,catapult'],
    [1, new Date('2026-10-07T21:00:04').toISOString(), 'axe,snob'],
  ]);
  await OperationService.removeTargets(p.Chef.id, op.id, onCible2.slice(1).map((x) => x.id));

  // Modèle d'armée de l'organisateur, quand aucune troupe n'est saisie.
  const tpl = await ArmyTemplateService.create(p.Chef.id, { name: 'Nettoyage', axe: '6000' }, cfg);
  await OperationService.updateTargets(p.Chef.id, op.id, { ids: [String(rows[1].id)], template: String(tpl.id) }, cfg);
  assert.deepEqual((await TribeOperationTarget.findByPk(rows[1].id)).units, { axe: 6000 });
});

test('revendiquer : une place par attaque, jamais plus que demandé ; vues par défaut et feuille de route', async () => {
  // Un membre sans attaque arrive sur « À prendre » ; un organisateur sur toutes les cibles.
  assert.equal((await OperationService.detail(p.Membre.id, op.id)).filter.view, 'open');
  assert.equal((await OperationService.detail(p.Chef.id, op.id)).filter.view, 'all');

  const first = (await OperationService.detail(p.Membre.id, op.id, { vue: 'all' })).targets.rows[0];
  const { slots } = await OperationService.claim(p.Membre.id, first.id);
  assert.deepEqual(slots, [0]);
  await OperationService.claim(p.Chef.id, first.id, 'all');
  await assert.rejects(OperationService.claim(p.Membre.id, first.id), /déjà revendiquées/);
  await assert.rejects(OperationService.claim(p.Cible.id, first.id), /introuvable/);
  await assert.rejects(OperationService.unclaim(p.Membre.id, first.id, 1), /droit Opérations/, 'pas la place d’un autre');

  const mine = await OperationService.detail(p.Membre.id, op.id);
  assert.equal(mine.filter.view, 'mine');
  assert.equal(mine.slots.total, 1);
  assert.equal(mine.slots.rows[0].at.toISOString(), new Date('2026-10-07T20:00:00').toISOString());
  const chef = await OperationService.detail(p.Membre.id, op.id, { vue: 'player', j: p.Chef.id });
  assert.equal(chef.slots.rows[0].at - mine.slots.rows[0].at, 1000, 'deuxième attaque une seconde après');
  assert.deepEqual(mine.participants.map((e) => [e.player.name, e.attacks]).sort(), [['Chef', 1], ['Membre', 1]]);

  // Tri par colonne (joueur ciblé, ordre inverse) et revendication d'une place précise.
  const sorted = await OperationService.detail(p.Chef.id, op.id, { vue: 'all', tri: 'joueur', ordre: 'desc' });
  assert.equal(sorted.filter.sort, 'joueur');
  assert.equal(sorted.filter.dir, 'desc');
  // Sous-filtres des cibles : joueur ciblé, type, recherche par coordonnées.
  const onCible = await OperationService.detail(p.Chef.id, op.id, { vue: 'all', cj: p.Cible.id });
  assert.ok(onCible.targets.rows.length && onCible.targets.rows.every((x) => x.Village.playerId === p.Cible.id));
  assert.ok((await OperationService.detail(p.Chef.id, op.id, { vue: 'all', type: 'noble' })).targets.rows.every((x) => OperationService.isNoble(x)));
  assert.deepEqual((await OperationService.detail(p.Chef.id, op.id, { vue: 'all', q: '415|410' })).targets.rows.map((x) => x.Village.x), [415]);
  const names = sorted.targets.rows.map((x) => (x.Village.Player ? x.Village.Player.name : '\uffff'));
  assert.deepEqual(names, [...names].sort((x, y) => y.localeCompare(x, 'fr')));
  const third = sorted.targets.rows.find((x) => x.count > 1 && OperationService.claimedOf(x) === 0);
  if (third) {
    assert.deepEqual((await OperationService.claim(p.Membre.id, third.id, 1, 1)).slots, [1]);
    await assert.rejects(OperationService.claim(p.Chef.id, third.id, 1, 1), /déjà revendiquée/);
    await OperationService.release(p.Membre.id, [`${third.id}:1`]);
  }

  // Libération par cases cochées : les siennes seulement, sauf organisateur.
  await assert.rejects(OperationService.release(p.Membre.id, [`${first.id}:1`]), /droit Opérations/);
  await OperationService.claim(p.Membre.id, (await OperationService.detail(p.Membre.id, op.id, { vue: 'all' })).targets.rows[1].id, 'all');
  const second = (await OperationService.detail(p.Membre.id, op.id, { vue: 'all' })).targets.rows[1];
  assert.equal(await OperationService.release(p.Membre.id, [`${second.id}:0`, `${second.id}:1`]), 2);

  // L'organisateur libère la place d'un membre ; moins d'attaques demandées libère les places en trop.
  await OperationService.unclaim(p.Chef.id, first.id, 0);
  await OperationService.claim(p.Membre.id, first.id);
  await OperationService.updateTargets(p.Chef.id, op.id, { ids: [String(first.id)], count: '1' }, cfg);
  assert.deepEqual((await TribeOperationClaim.findAll({ where: { targetId: first.id } })).map((c) => [c.slot, c.playerId]), [[0, p.Membre.id]]);
  const list = await OperationService.list(p.Membre.id);
  assert.equal(list.operations[0].stats.claimed, 1);
  assert.equal(list.operations[0].stats.villages, 3, 'villages distincts de la liste des opérations');
  assert.equal(list.operations[0].stats.mine, 1);
});

test('carte et mini-carte : les cibles prennent la couleur de l’opération, à part des marquages du joueur', async () => {
  const vc = await mapView.viewContext(v.Membre, cfg);
  const target = await Village.findByPk(v.Cible.id, { include: [Player] });
  assert.equal(mapView.markOf(vc, target), null);
  assert.equal(mapView.opColorOf(vc, target), '#ff0000');
  assert.deepEqual(mapView.point(vc, target).slice(3), ['', '#ff0000']);
  const info = vc.ops.get(v.Cible.id)[0];
  assert.equal(info.claimed, 1);
  assert.equal(info.mine, 1);
  assert.equal(info.mineAt.length, 1);
  const outsider = await mapView.viewContext(v.Cible, cfg);
  assert.equal(mapView.opColorOf(outsider, target), null);
});

test('un membre qui part perd ses revendications ; la dissolution efface les opérations', async () => {
  await TribeService.leave(p.Membre.id);
  assert.equal(await TribeOperationClaim.count({ where: { playerId: p.Membre.id } }), 0);
  await OperationService.removeTargets(p.Chef.id, op.id, (await TribeOperationTarget.findAll()).slice(0, 1).map((x) => x.id));
  assert.equal(await TribeOperationTarget.count(), 2);
  await TribeService.leave(p.Chef.id);
  assert.equal(await TribeOperation.count(), 0);
  assert.equal(await TribeOperationTarget.count(), 0);
  assert.equal(await TribeOperationClaim.count(), 0);
});
