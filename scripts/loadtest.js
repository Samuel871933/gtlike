'use strict';

// Test de charge : des joueurs virtuels jouent en même temps sur un serveur lancé à part, et l'on mesure les temps de
// réponse par type de page, les erreurs, et si la boucle de jeu suit les arrivées.
//
//   1. Une base à part, peuplée :  DB_NAME=adarma_loadtest npm run migrate && node scripts/seed.js
//                                  DB_NAME=adarma_loadtest npm run populate -- speed 2000
//   2. Le serveur sur cette base :  DB_NAME=adarma_loadtest PORT=3100 node src/server.js
//      (ou une boucle de jeu à part, HTTP=0, et plusieurs processus web GAME_LOOP=0 NODE_APP_INSTANCE=1… PORT=310x,
//      avec --base http://localhost:3101,http://localhost:3102…)
//   3. La charge :                  DB_NAME=adarma_loadtest node scripts/loadtest.js --users 300 --duration 120
//
// Options : --base http://localhost:3100  --world speed  --users 300  --duration 120 (s)  --think 1000 (ms entre deux
// pages d'un joueur, ±50 %)  --attacks 3000 (attaques en route créées avant le test, qui arrivent pendant le test).
// Les joueurs sont les comptes fictifs de scripts/populate.js (mot de passe « motdepasse »). Ne jamais lancer sur la
// base de production : les attaques créées sont résolues pour de vrai.

const { Op } = require('sequelize');
const { sequelize, User, World, Player, Village, Command } = require('../src/models');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
// Plusieurs processus web : adresses séparées par des virgules, les joueurs répartis entre eux.
const BASES = opt('base', 'http://localhost:3100').split(',');
const WORLD = opt('world', 'speed');
const USERS = Number(opt('users', 300));
const DURATION = Number(opt('duration', 120)) * 1000;
const THINK = Number(opt('think', 1000));
const ATTACKS = Number(opt('attacks', 3000));
const PASSWORD = 'motdepasse';

// Parts de chaque action dans le jeu d'un joueur (somme libre).
const ACTIONS = [
  ['overview', 30], ['sectors', 25], ['alerts', 15], ['map', 8], ['reports', 6], ['incomings', 6], ['build', 10],
];
const pickAction = (() => {
  const total = ACTIONS.reduce((n, [, w]) => n + w, 0);
  return () => {
    let r = Math.random() * total;
    for (const [name, w] of ACTIONS) if ((r -= w) < 0) return name;
    return ACTIONS[0][0];
  };
})();

const stats = new Map();
// Temps de réponse par tranche de 10 s (selon l'instant de la demande) : quand les lenteurs arrivent.
const timeline = new Map();
let startedAt = 0;
function record(name, ms, ok) {
  const slot = Math.floor((Date.now() - ms - startedAt) / 10000);
  if (!timeline.has(slot)) timeline.set(slot, []);
  timeline.get(slot).push(ms);
  if (!stats.has(name)) stats.set(name, { times: [], errors: 0 });
  const s = stats.get(name);
  s.times.push(ms);
  if (!ok) s.errors += 1;
}

/** Client HTTP d'un joueur : garde son cookie de session. */
function client(base) {
  let cookie = '';
  return async (path, { method = 'GET', form, json = false } = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        cookie,
        // Serveur en production derrière un proxy HTTPS (trust proxy) : sans cela, le cookie sécurisé n'est pas posé.
        'x-forwarded-proto': 'https',
        ...(json ? { accept: 'application/json' } : {}),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, text: await res.text() };
  };
}
const tokenOf = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];

/** Attaques entre villages de joueurs, qui arrivent tout au long du test (la boucle et les pages les résolvent). */
async function seedAttacks(world, villages) {
  if (!ATTACKS) return;
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < ATTACKS; i++) {
    const origin = villages[Math.floor(Math.random() * villages.length)];
    const target = villages[Math.floor(Math.random() * villages.length)];
    if (origin.id === target.id) continue;
    rows.push({
      worldId: world.id, type: 'attack', originVillageId: origin.id, targetVillageId: target.id,
      units: { axe: 20 + Math.floor(Math.random() * 80), light: Math.floor(Math.random() * 30) },
      startsAt: new Date(now - 60000), arrivesAt: new Date(now + 5000 + Math.random() * DURATION),
    });
  }
  for (let i = 0; i < rows.length; i += 1000) await Command.bulkCreate(rows.slice(i, i + 1000));
  console.log(`${rows.length} attaques en route, arrivées étalées sur ${DURATION / 1000} s.`);
}

/** Connexion d'un joueur et son premier village sur le monde. */
async function login(user, villageId, base) {
  const http = client(base);
  const page = await http('/login');
  const res = await http('/login', { method: 'POST', form: { login: user.email, password: PASSWORD, _csrf: tokenOf(page.text) } });
  if (res.status !== 302) throw new Error(`connexion refusée pour ${user.email} (${res.status})`);
  return { http, villageId, token: null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECTOR = 20;

async function act(vu, v, name) {
  const base = `/village/${v.id}`;
  const t0 = performance.now();
  let res;
  try {
    if (name === 'overview') res = await vu.http(base);
    else if (name === 'map') res = await vu.http(`${base}/map`);
    else if (name === 'alerts') res = await vu.http(`${base}/alerts`, { json: true });
    else if (name === 'reports') res = await vu.http(`${base}/reports`);
    else if (name === 'incomings') res = await vu.http(`${base}/incomings`);
    else if (name === 'sectors') {
      // Un déplacement de la carte : 3 × 3 secteurs autour d'un point voisin du village.
      const sx = Math.floor((v.x + Math.round((Math.random() - 0.5) * 60)) / SECTOR);
      const sy = Math.floor((v.y + Math.round((Math.random() - 0.5) * 60)) / SECTOR);
      const list = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) list.push(`${Math.max(0, sx + dx)}.${Math.max(0, sy + dy)}`);
      res = await vu.http(`${base}/map/sectors?s=${list.join(',')}`, { json: true });
    } else if (name === 'build') {
      if (!vu.token) vu.token = tokenOf((await vu.http(base)).text);
      res = await vu.http(`${base}/build`, { method: 'POST', form: { building: ['wood', 'stone', 'iron', 'farm', 'storage'][Math.floor(Math.random() * 5)], _csrf: vu.token } });
    }
    // Une redirection (action faite ou refusée avec un message) compte comme une réponse normale.
    record(name, performance.now() - t0, res.status < 400);
  } catch {
    record(name, performance.now() - t0, false);
  }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] || 0;

async function main() {
  const world = await World.findOne({ where: { slug: WORLD } });
  if (!world) throw new Error(`Monde « ${WORLD} » introuvable.`);
  const players = await Player.findAll({
    where: { worldId: world.id, isBot: false },
    include: [{ model: User, required: true, where: { email: { [Op.like]: '%@bots.adarma.local' } }, attributes: ['email'] }],
    attributes: ['id'], limit: USERS,
  });
  const firstVillage = new Map((await Village.findAll({
    where: { playerId: players.map((p) => p.id) }, attributes: ['id', 'playerId', 'x', 'y'], order: [['id', 'ASC']], raw: true,
  })).reverse().map((v) => [v.playerId, v]));
  const villages = await Village.findAll({ where: { worldId: world.id, playerId: { [Op.ne]: null } }, attributes: ['id'], raw: true });
  await seedAttacks(world, villages);

  console.log(`Connexion de ${players.length} joueurs…`);
  const vus = [];
  for (let i = 0; i < players.length; i += 20) {
    vus.push(...await Promise.all(players.slice(i, i + 20).map(async (p, j) => ({
      ...(await login(p.User, firstVillage.get(p.id).id, BASES[(i + j) % BASES.length])), v: firstVillage.get(p.id),
    }))));
  }

  console.log(`${vus.length} joueurs en jeu pendant ${DURATION / 1000} s (une page toutes les ~${THINK} ms chacun)…`);
  const end = Date.now() + DURATION;
  const started = Date.now();
  startedAt = started;
  await Promise.all(vus.map(async (vu, i) => {
    await sleep((i / vus.length) * THINK); // départs étalés
    while (Date.now() < end) {
      await act(vu, vu.v, pickAction());
      await sleep(THINK * (0.5 + Math.random()));
    }
  }));
  const elapsed = (Date.now() - started) / 1000;

  let total = 0;
  let errors = 0;
  console.log('\nAction        requêtes  erreurs   p50 ms   p95 ms   p99 ms   max ms');
  for (const [name, s] of [...stats].sort()) {
    const sorted = [...s.times].sort((a, b) => a - b);
    total += sorted.length;
    errors += s.errors;
    console.log(`${name.padEnd(12)} ${String(sorted.length).padStart(9)} ${String(s.errors).padStart(8)} ${[50, 95, 99].map((p) => pct(sorted, p).toFixed(0).padStart(8)).join(' ')} ${sorted[sorted.length - 1].toFixed(0).padStart(8)}`);
  }
  console.log('\nTranche     requêtes   p50 ms   p99 ms   max ms');
  for (const [slot, times] of [...timeline].sort((a, b) => a[0] - b[0])) {
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`${`${slot * 10}-${slot * 10 + 10} s`.padEnd(10)} ${String(sorted.length).padStart(9)} ${[50, 99].map((p) => pct(sorted, p).toFixed(0).padStart(8)).join(' ')} ${sorted[sorted.length - 1].toFixed(0).padStart(8)}`);
  }
  console.log(`\n${total} requêtes en ${elapsed.toFixed(0)} s : ${(total / elapsed).toFixed(1)} req/s, ${errors} erreurs.`);
  // La boucle suit-elle ? Arrivées échues mais pas encore traitées à la fin du test.
  const overdue = await Command.count({ where: { worldId: world.id, arrivesAt: { [Op.lte]: new Date(Date.now() - 10000) } } });
  console.log(`Ordres échus depuis plus de 10 s non traités : ${overdue}.`);
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
