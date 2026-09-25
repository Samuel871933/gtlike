'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const combat = require('../src/game/combat');
const WorldConfig = require('../src/game/WorldConfig');
const { travelSeconds } = require('../src/game/movement');

test('défense de base : 2 lanciers meurent contre un village vide', () => {
  const r = combat.resolve({ attackers: { spear: 2 }, defenders: {} });
  assert.equal(r.attackerWins, false);
  assert.deepEqual(r.attackerLosses, { spear: 2 });
  assert.equal(r.defenseStrength, 20);
});

test('attaque gagnante : pertes = (défense / attaque)^1.5', () => {
  const r = combat.resolve({ attackers: { axe: 100 }, defenders: { spear: 50 } });
  const defense = 50 * 15 + 20;
  assert.equal(r.defenseStrength, defense);
  assert.equal(r.attackerWins, true);
  assert.equal(r.attackerLosses.axe, Math.round(100 * (defense / 4000) ** 1.5));
  assert.deepEqual(r.defenderLosses, { spear: 50 });
});

test('défense pondérée selon le type d’attaque (cavalerie contre lanciers)', () => {
  const r = combat.resolve({ attackers: { light: 10 }, defenders: { spear: 10, sword: 10 } });
  assert.equal(r.defenseStrength, 10 * 45 + 10 * 25 + 20);
});

test('muraille : (20 + 50 × niveau) × 1.037^niveau, et béliers avant le combat', () => {
  const r = combat.resolve({ attackers: { axe: 1 }, defenders: {}, wall: 20 });
  assert.ok(Math.abs(r.defenseStrength - 1020 * 1.037 ** 20) < 1e-6);
  const withRams = combat.resolve({ attackers: { axe: 5000, ram: 23 }, defenders: {}, wall: 20 });
  assert.equal(withRams.wallFight, 19, '≈ 22 béliers par niveau avant le combat au mur 20');
  assert.ok(withRams.wallAfter < 19);
  const huge = combat.resolve({ attackers: { axe: 5000, ram: 5000 }, defenders: {}, wall: 20 });
  assert.equal(huge.wallFight, 10, 'au plus la moitié du mur avant le combat');
  assert.equal(huge.wallAfter, 0);
});

test('chance, morale et nuit', () => {
  const base = combat.resolve({ attackers: { axe: 100 }, defenders: { sword: 10 } });
  const lucky = combat.resolve({ attackers: { axe: 100 }, defenders: { sword: 10 }, luck: 0.25, morale: 0.5 });
  assert.equal(lucky.attackStrength, base.attackStrength * 0.5 * 1.25);
  const night = combat.resolve({ attackers: { axe: 100 }, defenders: { sword: 10 }, nightFactor: 2 });
  assert.equal(night.defenseStrength, base.defenseStrength * 2);
  assert.equal(combat.morale(1000, 100), 0.6);
  assert.equal(combat.morale(100, 1000), 1);
  assert.ok(Math.abs(combat.morale(600000, 1) - 0.3) < 1e-4, 'plancher de 30 % vers 600:1');
});

test('catapultes : bâtiment visé baissé, QG jamais sous 1, cachette intouchable', () => {
  const r = combat.resolve({ attackers: { axe: 5000, catapult: 200 }, defenders: {}, catapultTarget: { building: 'main', level: 5 } });
  assert.equal(r.catapult.after, 1);
  const barracks = combat.resolve({ attackers: { axe: 5000, catapult: 10 }, defenders: {}, catapultTarget: { building: 'barracks', level: 5 } });
  assert.ok(barracks.catapult.after < 5 && barracks.catapult.after >= 0);
  const hide = combat.resolve({ attackers: { axe: 5000, catapult: 200 }, defenders: {}, catapultTarget: { building: 'hide', level: 5 } });
  assert.equal(hide.catapult, null);
});

test('éclaireurs : combat séparé, infos selon les survivants', () => {
  const alone = combat.resolve({ attackers: { spy: 5 }, defenders: { spear: 100 } });
  assert.equal(alone.hasBattle, false);
  assert.equal(alone.spies.survivedRatio, 1);
  assert.deepEqual(alone.defenderLosses, {});
  const blocked = combat.resolve({ attackers: { spy: 5 }, defenders: { spy: 10 } });
  assert.equal(blocked.spies.lost, 5);
});

test('pillage : réparti équitablement, la cachette protège', () => {
  assert.deepEqual(combat.loot({ wood: 1000, stone: 1000, iron: 1000 }, 0, 300), { wood: 100, stone: 100, iron: 100 });
  assert.deepEqual(combat.loot({ wood: 50, stone: 1000, iron: 1000 }, 0, 300), { wood: 50, stone: 125, iron: 125 });
  assert.deepEqual(combat.loot({ wood: 100, stone: 100, iron: 100 }, 150, 300), { wood: 0, stone: 0, iron: 0 });
  assert.equal(combat.carryCapacity({ light: 10, spear: 4 }), 900);
});

test('trajet : vitesse de l’unité la plus lente', () => {
  const w = new WorldConfig({ speed: 1, unitSpeed: 1 });
  assert.equal(travelSeconds({ light: 1 }, { x: 0, y: 0 }, { x: 3, y: 4 }, w), 5 * 10 * 60);
  assert.equal(travelSeconds({ light: 1, ram: 1 }, { x: 0, y: 0 }, { x: 3, y: 4 }, w), 5 * 30 * 60);
  const fr104 = new WorldConfig({ speed: 1.5, unitSpeed: 0.7 });
  assert.equal(travelSeconds({ spear: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, fr104), Math.round(18 / 1.05 * 60));
});
