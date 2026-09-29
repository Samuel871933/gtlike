'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const activities = require('../src/web/villageActivities');
const now = new Date('2026-09-29T12:00:00Z');
const at = (seconds) => new Date(+now + seconds * 1000);
const context = () => ({ now, village: {}, state: {}, buildOrders: [], recruitOrders: [], researchOrders: [] });

test('construction et recrutement simultanés : prochaine unité, pas fin du lot', () => {
  const ctx = context();
  ctx.buildOrders = [{ building: 'barracks', startsAt: at(-10), endsAt: at(120) }];
  ctx.recruitOrders = [
    { building: 'barracks', count: 10, done: 2, nextAt: at(30), endsAt: at(240) },
    { building: 'barracks', count: 5, done: 0, nextAt: at(270), endsAt: at(400) },
  ];
  assert.deepEqual(activities(ctx).barracks.map(({ kind, end }) => [kind, end]), [['build', +at(120)], ['recruit', +at(30)]]);
});

test('chantier en attente et démolition ont des échéances explicites', () => {
  const ctx = context();
  ctx.buildOrders = [
    { building: 'main', startsAt: at(-10), endsAt: at(60), demolish: true },
    { building: 'storage', startsAt: at(60), endsAt: at(180) },
  ];
  const result = activities(ctx);
  assert.equal(result.main[0].label, 'Démolition');
  assert.equal(result.storage[0].label, 'Début chantier');
  assert.equal(result.storage[0].end, +at(60));
});

test('activités spécialisées rattachées au bon bâtiment, échéances terminées ignorées', () => {
  const ctx = context();
  ctx.researchOrders = [{ endsAt: at(90) }];
  ctx.state.militiaUntil = at(100);
  ctx.village.scavenging = { unlocking: { endsAt: at(110) } };
  const result = activities(ctx, {
    knights: [{ trainingEndsAt: null }, { trainingEndsAt: at(80) }],
    scavenges: [{ endsAt: at(-1) }, { endsAt: at(40) }, { endsAt: at(20) }],
    transports: [{ type: 'return', arrivesAt: at(50) }],
  });
  assert.equal(result.smith[0].kind, 'research');
  assert.equal(result.statue[0].end, +at(80));
  assert.equal(result.farm[0].kind, 'militia');
  assert.equal(result.place[0].end, +at(20));
  assert.equal(result.place[1].kind, 'unlock');
  assert.equal(result.market[0].label, 'Retour marchands');
  assert.deepEqual(activities(context()), {});
});
