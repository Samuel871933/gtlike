'use strict';

process.env.SQLITE_STORAGE = ':memory:';
delete process.env.DATABASE_URL;

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
  const p1 = await ReportService.list(alice.id);
  assert.equal(p1.total, 60);
  assert.equal(p1.pages, 2);
  assert.equal(p1.reports[0].title, 'r59', 'les plus récents d’abord');
  const p2 = await ReportService.list(alice.id, { page: 2 });
  assert.equal(p2.reports.length, 10);
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
