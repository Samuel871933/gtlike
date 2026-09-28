'use strict';

// Inscriptions de test : crée des comptes et les inscrit sur un monde par le vrai chemin du jeu
// (AuthService.register puis WorldService.join), pour voir comment se remplit la carte.
//
//   node scripts/signup.js [monde] [nombre]      (par défaut : speed 100)
//
// Comptes : <nom>@bots.gtlike.local, mot de passe « motdepasse » (connexion avec le nom).

const { Op } = require('sequelize');
const { sequelize, World, Village } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const { MapPlacer } = require('../src/game/MapPlacer');

async function main() {
  const [slug = 'speed', countArg = '100'] = process.argv.slice(2);
  const count = Number.parseInt(countArg, 10);
  const world = await World.findOne({ where: { slug } });
  if (!world) throw new Error(`Monde « ${slug} » introuvable.`);
  const cfg = world.getConfig();
  const before = await Village.count({ where: { worldId: world.id } });
  const since = new Date();
  const tag = Date.now().toString(36).slice(-4);

  const started = Date.now();
  for (let i = 1; i <= count; i++) {
    const username = `Test${tag}_${i}`;
    const user = await AuthService.register({ username, email: `${username.toLowerCase()}@bots.gtlike.local`, password: 'motdepasse' });
    // Comme de vrais joueurs : la plupart choisissent une direction, les autres « au hasard ».
    const direction = MapPlacer.DIRECTIONS[Math.floor(Math.random() * MapPlacer.DIRECTIONS.length)];
    await WorldService.join(user, slug, { direction });
  }
  const seconds = (Date.now() - started) / 1000;

  // Bilan : où sont tombés les nouveaux villages.
  const all = await Village.findAll({ where: { worldId: world.id }, attributes: ['x', 'y', 'playerId', 'createdAt'], raw: true });
  const fresh = all.filter((v) => new Date(v.createdAt) >= since);
  const players = fresh.filter((v) => v.playerId);
  const barbs = fresh.filter((v) => !v.playerId);
  const c = cfg.center;
  const dist = (v) => Math.hypot(v.x - c, v.y - c);
  const nearest = (v) => Math.min(...all.filter((o) => o !== v && o.playerId).map((o) => Math.hypot(o.x - v.x, o.y - v.y)));
  const stats = (list) => {
    const d = list.map(dist).sort((a, b) => a - b);
    return d.length ? `${d[0].toFixed(1)} à ${d[d.length - 1].toFixed(1)} cases (médiane ${d[Math.floor(d.length / 2)].toFixed(1)})` : '—';
  };
  const gaps = players.map(nearest).sort((a, b) => a - b);
  const xs = fresh.map((v) => v.x); const ys = fresh.map((v) => v.y);

  console.log(`${count} comptes inscrits sur « ${slug} » en ${seconds.toFixed(1)} s (${(seconds / count * 1000).toFixed(0)} ms par inscription).`);
  console.log(`Villages : ${before} avant, ${all.length} après : ${players.length} joueurs, ${barbs.length} barbares (placement.emptyVillages = ${cfg.placement.emptyVillages} %).`);
  console.log(`Distance au centre (${c}|${c}) : joueurs ${stats(players)} ; barbares ${stats(barbs)}.`);
  console.log(`Joueur le plus proche d'un nouveau joueur : min ${gaps[0].toFixed(1)}, médiane ${gaps[Math.floor(gaps.length / 2)].toFixed(1)} cases.`);
  console.log(`Zone couverte : x ${Math.min(...xs)}-${Math.max(...xs)}, y ${Math.min(...ys)}-${Math.max(...ys)}.`);
  console.log(`Connexion : ${`Test${tag}_1`} / motdepasse. Nettoyage : comptes en ${'%@bots.gtlike.local'} créés après ${since.toISOString()}.`);
}

if (require.main === module) {
  main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => sequelize.close());
}
