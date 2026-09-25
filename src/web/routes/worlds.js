'use strict';

const express = require('express');
const { Op } = require('sequelize');
const { World, Village, Player, Command } = require('../../models');
const WorldService = require('../../services/WorldService');
const MapService = require('../../services/MapService');
const TribeService = require('../../services/TribeService');
const AchievementService = require('../../services/AchievementService');
const GameError = require('../../services/GameError');
const { MapPlacer } = require('../../game/MapPlacer');
const { ah, flash, requireAuth } = require('../middleware');

const router = express.Router();

/** Données de la page « Fin du monde » (affichée hors partie ou dans l'interface du jeu). */
async function victoryLocals(world) {
  const standings = await require('../../services/VictoryService').standings(world, new Date());
  return { world, cfg: world.getConfig(), standings, state: world.victoryState || {} };
}

/** Données de la page des classements (affichée hors partie ou dans l'interface du jeu). */
async function rankingLocals(world, query) {
  const type = ['tribes', 'kills', 'continent', 'awards'].includes(query.type) ? query.type : 'players';
  const awards = type === 'awards' ? await AchievementService.ranking(world.id) : [];
  const kind = ['att', 'def', 'sup', 'all'].includes(query.kind) ? query.kind : 'all';
  const players = type === 'players' ? await MapService.ranking(world.id) : [];
  const tribes = type === 'tribes' ? await TribeService.ranking(world.id) : [];
  const kills = type === 'kills' ? await MapService.killRanking(world.id, kind) : [];
  let continent = null;
  if (type === 'continent') {
    const list = await MapService.continents(world.id);
    const k = list.includes(query.k) ? query.k : list[0];
    const of = query.of === 'tribes' ? 'tribes' : 'players';
    continent = { list, k, of, rows: k ? await MapService.continentRanking(world.id, k, { tribes: of === 'tribes' }) : [] };
  }
  return { world, type, kind, players, tribes, kills, continentRanking: continent, awards };
}

async function findWorld(slug) {
  const world = await World.findOne({ where: { slug } });
  if (!world) throw new GameError('Monde introuvable.', 404);
  return world;
}

// Exports publics, sans connexion (comme /map/*.txt sur Guerre Tribale).
router.get('/worlds/:slug/map/village.txt', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  res.type('text/plain').send(await MapService.villageDump(world.id));
}));

router.get('/worlds/:slug/map/player.txt', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  res.type('text/plain').send(await MapService.playerDump(world.id));
}));

router.get('/worlds/:slug/config.json', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  res.json(world.getConfig());
}));

router.get('/worlds', requireAuth, ah(async (req, res) => {
  const worlds = await WorldService.listForUser(req.user.id);
  const selected = worlds.find((w) => w.world.slug === req.query.w) || null;
  // Parties en cours : rang, premier village et prochaine attaque (encart « Campagne en cours »).
  for (const w of worlds) {
    if (!w.player || !w.player.villageCount || w.world.endedAt) continue;
    const villages = await Village.findAll({ where: { playerId: w.player.id }, attributes: ['id', 'name', 'x', 'y'], order: [['id', 'ASC']] });
    const ids = villages.map((v) => v.id);
    const [better, nextAttack] = await Promise.all([
      Player.count({ where: { worldId: w.world.id, points: { [Op.gt]: w.player.points } } }),
      Command.findOne({ where: { originVillageId: { [Op.in]: ids }, type: 'attack' }, order: [['arrivesAt', 'ASC']] }),
    ]);
    w.campaign = { rank: better + 1, village: villages[0] || null, nextAttackAt: nextAttack ? nextAttack.arrivesAt : null };
  }
  res.render('worlds', { worlds, selected, directions: MapPlacer.DIRECTIONS });
}));

router.post('/worlds/:slug/join', requireAuth, ah(async (req, res) => {
  const direction = MapPlacer.DIRECTIONS.includes(req.body.direction) ? req.body.direction : 'random';
  const { village } = await WorldService.join(req.user, req.params.slug, { direction });
  res.redirect(`/village/${village.id}`);
}));

/** Entrée dans un monde : premier village du joueur. */
router.get('/worlds/:slug/play', requireAuth, ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  const player = await WorldService.getPlayer(req.user.id, world.id);
  if (!player) return res.redirect('/worlds');
  const village = await Village.findOne({ where: { playerId: player.id }, order: [['id', 'ASC']] });
  if (!village) {
    flash(req, 'error', "Vous avez perdu tous vos villages sur ce monde : vous pouvez recommencer.");
    return res.redirect('/worlds');
  }
  res.redirect(`/village/${village.id}`);
}));

/** Entrée dans le compte d'un joueur que l'on remplace (le droit d'accès est vérifié par la page du village). */
router.get('/worlds/:slug/sit/:playerId', requireAuth, ah(async (req, res) => {
  const village = await Village.findOne({ where: { playerId: Number(req.params.playerId) }, order: [['id', 'ASC']] });
  if (!village) throw new GameError('Ce joueur n’a plus de village.', 404);
  res.redirect(`/village/${village.id}`);
}));

router.get('/worlds/:slug/victory', requireAuth, ah(async (req, res) => {
  res.render('victory', await victoryLocals(await findWorld(req.params.slug)));
}));

router.get('/worlds/:slug/ranking', requireAuth, ah(async (req, res) => {
  res.render('ranking', await rankingLocals(await findWorld(req.params.slug), req.query));
}));

// Exports publics des adversaires vaincus (format Guerre Tribale : rang,id_joueur,score).
for (const [file, kind] of [['kill_att', 'att'], ['kill_def', 'def'], ['kill_sup', 'sup'], ['kill_all', 'all']]) {
  router.get(`/worlds/:slug/map/${file}.txt`, ah(async (req, res) => {
    const world = await findWorld(req.params.slug);
    const rows = await MapService.killRanking(world.id, kind, 1e9);
    res.type('text/plain').send(rows.map((r, i) => [i + 1, r.player.id, r.score].join(',')).join('\n'));
  }));
}

router.get('/worlds/:slug/map/ally.txt', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  const rows = await TribeService.ranking(world.id, 1e9);
  res.type('text/plain').send(rows.map((r, i) => [
    r.tribe.id, encodeURIComponent(r.tribe.name), encodeURIComponent(r.tribe.tag), r.members, r.villages, r.points, r.points, i + 1,
  ].join(',')).join('\n'));
}));

module.exports = router;
module.exports.rankingLocals = rankingLocals;
module.exports.victoryLocals = victoryLocals;
