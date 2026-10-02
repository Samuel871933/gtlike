'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Report } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const ReportService = require('../src/services/ReportService');

let alice;
let bob;

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  for (const name of ['Alice', 'Bob']) {
    const u = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    const { player } = await WorldService.join(u, 'w1');
    if (name === 'Alice') alice = player; else bob = player;
  }
  const rows = [];
  for (let i = 0; i < 60; i++) {
    rows.push({ playerId: alice.id, type: i % 3 === 0 ? 'trade' : 'attack', title: `r${i}`, data: {}, happenedAt: new Date(Date.UTC(2026, 8, 1, 0, i)) });
  }
  rows.push({ playerId: bob.id, type: 'attack', title: 'bob', data: {}, happenedAt: new Date() });
  await Report.bulkCreate(rows);
});

test.after(() => sequelize.close());

test('pagination et filtres par type', async () => {
  const p1 = await ReportService.list(alice.id, { perPage: 50 });
  assert.equal(p1.total, 60);
  assert.equal(p1.pages, 2);
  assert.equal(p1.reports[0].title, 'r59', 'les plus récents d’abord');
  const p2 = await ReportService.list(alice.id, { page: 2, perPage: 50 });
  assert.equal(p2.reports.length, 10);
  // Page au-delà de la dernière : ramenée à la dernière ; nombre par page réglable.
  assert.equal((await ReportService.list(alice.id, { page: 9, perPage: 50 })).page, 2);
  const small = await ReportService.list(alice.id, { page: 'last', perPage: 25 });
  assert.equal(small.pages, 3);
  assert.equal(small.reports.length, 10);
  const trade = await ReportService.list(alice.id, { filter: 'trade' });
  assert.equal(trade.total, 20);
});

test('actions groupées limitées aux rapports du joueur', async () => {
  const [bobReport] = await Report.findAll({ where: { playerId: bob.id } });
  const mine = (await ReportService.list(alice.id)).reports.slice(0, 3).map((r) => String(r.id));
  assert.equal(await ReportService.bulk(alice.id, 'read', mine), 3);
  assert.equal(await ReportService.bulk(alice.id, 'delete', [...mine, String(bobReport.id)]), 3, 'le rapport de Bob est ignoré');
  assert.equal(await Report.count({ where: { playerId: bob.id } }), 1);
  assert.equal(await ReportService.markAllRead(alice.id), 57);
  await assert.rejects(ReportService.bulk(alice.id, 'delete', []), /Aucun rapport/);
  await assert.rejects(ReportService.get(alice.id, bobReport.id), /introuvable/);
});

test('conservation comme sur Guerre Tribale : 100 rapports + 10 par village, les plus anciens supprimés', async () => {
  assert.equal(ReportService.keepLimit(1), 110);
  assert.equal(ReportService.keepLimit(0), 100);
  const { Player } = require('../src/models');
  const p = await Player.findByPk(bob.id);
  const rows = [];
  // Deux rapports au même instant de part et d'autre de la limite : départagés par id, comme dans la boîte.
  for (let i = 0; i < 130; i++) {
    rows.push({ playerId: bob.id, type: 'attack', title: `b${i}`, data: {}, happenedAt: new Date(Date.UTC(2026, 7, 1, 0, Math.min(i, 120))) });
  }
  await Report.bulkCreate(rows);
  const total = await Report.count({ where: { playerId: bob.id } });
  const limit = ReportService.keepLimit(p.villageCount);
  const newest = (await ReportService.list(bob.id, { perPage: 1000 })).reports.slice(0, limit).map((r) => r.id);

  assert.equal(await ReportService.pruneAll(), total - limit);
  const kept = (await Report.findAll({ where: { playerId: bob.id }, attributes: ['id'], raw: true })).map((r) => r.id);
  assert.deepEqual(kept.sort((a, b) => a - b), newest.sort((a, b) => a - b), 'les plus récents restent');
  assert.equal(await Report.count({ where: { playerId: alice.id } }) <= ReportService.keepLimit(1), true);
  assert.equal(await ReportService.pruneAll(), 0, 'rien de plus au passage suivant');
});

test('archives (premium) : dossiers hors de la limite, supprimés après la durée choisie', async () => {
  const { Player, ReportFolder } = require('../src/models');
  await assert.rejects(ReportService.createFolder(alice.id, 'Espionnages', { premium: false }), /premium/);
  const folder = await ReportService.createFolder(alice.id, '  Espionnages ', { premium: true });
  assert.equal(folder.name, 'Espionnages');
  await assert.rejects(ReportService.folder(bob.id, folder.id), /introuvable/, 'dossier d’un autre joueur');

  const old = await Report.create({ playerId: alice.id, type: 'attack', title: 'vieux', data: {}, happenedAt: new Date(Date.UTC(2026, 0, 1)) });
  const recent = await Report.create({ playerId: alice.id, type: 'attack', title: 'récent', data: {}, happenedAt: new Date(Date.UTC(2026, 8, 20)) });
  await assert.rejects(ReportService.move(alice.id, [old.id], folder.id, { premium: false }), /premium/);
  assert.equal(await ReportService.move(alice.id, [old.id, recent.id], folder.id, { premium: true }), 2);
  assert.equal((await ReportService.list(alice.id, { folderId: folder.id })).total, 2);
  assert.ok(!(await ReportService.list(alice.id)).reports.some((r) => r.id === old.id), 'plus dans la boîte de réception');
  const everything = await ReportService.list(alice.id, { folderId: 'all', perPage: 200 });
  assert.ok(everything.reports.some((r) => r.id === old.id), '« Tout » montre aussi les archives');
  assert.equal(everything.total, await Report.count({ where: { playerId: alice.id } }));
  assert.deepEqual((await ReportService.folders(alice.id)).map((f) => [f.folder.name, f.total, f.unread]), [['Espionnages', 2, 2]]);

  // La limite de la boîte ne touche pas les archives.
  await ReportService.prune(alice.id, 0);
  assert.equal(await Report.count({ where: { playerId: alice.id } }), 2, 'boîte vidée, archives intactes');

  // Durée de conservation : 3 mois par défaut, réglable de 1 à 24 mois.
  await assert.rejects(ReportService.setArchiveMonths(alice.id, 25), /Entre 1 et 24/);
  const now = new Date(Date.UTC(2026, 9, 2));
  assert.equal(await ReportService.pruneArchives(now), 1, 'le rapport de janvier passe les 3 mois');
  assert.ok(await Report.findByPk(recent.id));
  await ReportService.setArchiveMonths(alice.id, 24);
  assert.equal(ReportService.archiveMonths(await Player.findByPk(alice.id)), 24);

  // Sans premium, on peut encore ressortir ses rapports ; supprimer un dossier les remet dans la boîte.
  assert.equal(await ReportService.move(alice.id, [recent.id], '', { premium: false }), 1);
  await ReportService.move(alice.id, [recent.id], folder.id, { premium: true });
  await ReportService.deleteFolder(alice.id, folder.id);
  assert.equal((await Report.findByPk(recent.id)).folderId, null);
  assert.equal(await ReportFolder.count({ where: { playerId: alice.id } }), 0);
});
