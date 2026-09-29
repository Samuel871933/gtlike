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

/**
 * Données de la fin du monde (entrée du menu des classements, comme « Dominance du monde » sur GT) :
 * état de la condition, part du joueur qui regarde (`me` : { playerId, tribeId }) et durée tenue par le meneur.
 */
async function victoryLocals(world, me = {}) {
  const now = new Date();
  const standings = await require('../../services/VictoryService').standings(world, now);
  const state = world.victoryState || {};
  const scopePlayer = standings.type === 'pointsVillages' && world.getConfig().victory.pointsVillages.scope === 'player';
  const mineId = scopePlayer ? me.playerId : me.tribeId;
  const [myVillages, totalVillages] = await Promise.all([
    me.playerId ? Village.count({ where: { playerId: me.playerId } }) : 0,
    Village.count({ where: { worldId: world.id, playerId: { [Op.ne]: null } } }),
  ]);
  return {
    world, cfg: world.getConfig(), standings, state, now,
    mine: (standings.list || []).find((r) => r.id === mineId) || null,
    hasMine: Boolean(mineId),
    contribution: totalVillages ? (100 * myVillages) / totalVillages : 0,
    heldMs: state.holderId && state.since ? now - new Date(state.since) : 0,
  };
}

// Classements : types (menu de gauche) et nombre de lignes par page, comme sur Guerre Tribale.
// `victory` : la fin du monde (dominance, runes…), dans le même cadre que les classements.
const RANKING_TYPES = ['players', 'tribes', 'continent', 'kills', 'awards', 'victory'];
const RANKING_PAGE = 25;

/**
 * Données de la page des classements (affichée hors partie ou dans l'interface du jeu).
 * Liste complète du type choisi, puis une page de 25 lignes : celle du rang demandé (?rank=), du nom cherché
 * (?q=), la page demandée (?page=), sinon celle du joueur (ou de sa tribu) qui regarde.
 * `me` : { playerId, tribeId } du joueur connecté sur ce monde, s'il y joue.
 */
async function rankingLocals(world, query, me = {}) {
  const type = RANKING_TYPES.includes(query.type) ? query.type : 'players';
  const kind = ['att', 'def', 'sup', 'all'].includes(query.kind) ? query.kind : 'all';
  if (type === 'victory') {
    return {
      type, kind, killsOf: 'players', continentRanking: null, byTribe: true, rows: [], isMine: () => false,
      pager: { page: 1, pages: 1, offset: 0, total: 0, focus: -1 }, search: { q: '', rank: '', notFound: false },
      victory: await victoryLocals(world, me), world,
    };
  }
  const ALL = 1e9;
  let rows = [];
  let continent = null;
  if (type === 'players') rows = (await MapService.ranking(world.id, ALL)).map((player) => ({ player, points: player.points, villages: player.villageCount }));
  if (type === 'tribes') rows = await TribeService.ranking(world.id, ALL);
  // Adversaires vaincus : par joueur ou par tribu (?of=tribes), filtre en attaque / défense / soutien / total (?kind=).
  const killsOf = query.of === 'tribes' ? 'tribes' : 'players';
  if (type === 'kills') rows = killsOf === 'tribes' ? await MapService.tribeKillRanking(world.id, kind, ALL) : await MapService.killRanking(world.id, kind, ALL);
  if (type === 'awards') rows = await AchievementService.ranking(world.id, ALL);
  if (type === 'continent') {
    const list = await MapService.continents(world.id);
    const k = list.includes(query.k) ? query.k : list[0];
    const of = query.of === 'tribes' ? 'tribes' : 'players';
    continent = { list, k, of };
    rows = k ? await MapService.continentRanking(world.id, k, { tribes: of === 'tribes', limit: ALL }) : [];
  }

  const byTribe = type === 'tribes' || (type === 'continent' && continent.of === 'tribes') || (type === 'kills' && killsOf === 'tribes');
  const isMine = (r) => (byTribe ? r.tribe && r.tribe.id === me.tribeId : r.player && r.player.id === me.playerId);
  const mine = rows.findIndex(isMine);
  const q = String(query.q || '').trim().toLowerCase();
  const found = q ? rows.findIndex((r) => [r.player && r.player.name, r.tribe && r.tribe.name, r.tribe && r.tribe.tag]
    .some((name) => name && name.toLowerCase().includes(q))) : -1;
  const rank = Number.parseInt(query.rank, 10);
  const pages = Math.max(1, Math.ceil(rows.length / RANKING_PAGE));
  let focus = mine;
  if (Number.isFinite(rank) && rank > 0) focus = Math.min(rows.length, rank) - 1;
  if (q) focus = found;
  const asked = Number.parseInt(query.page, 10);
  const page = Number.isFinite(asked) ? Math.min(pages, Math.max(1, asked)) : Math.floor(Math.max(0, focus) / RANKING_PAGE) + 1;
  const offset = (page - 1) * RANKING_PAGE;
  return {
    world, type, kind, killsOf, continentRanking: continent, byTribe,
    rows: rows.slice(offset, offset + RANKING_PAGE),
    pager: { page, pages, offset, total: rows.length, focus: focus >= offset && focus < offset + RANKING_PAGE ? focus - offset : -1 },
    search: { q: String(query.q || ''), rank: Number.isFinite(rank) && rank > 0 ? rank : '', notFound: Boolean(q) && found < 0 },
    isMine,
  };
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

// Infos monde : réglages publics d'un monde (vitesses, modules, victoire, tribus, nobles…).
router.get('/worlds/:slug/info', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  const [players, villages] = await Promise.all([
    Player.count({ where: { worldId: world.id } }),
    Village.count({ where: { worldId: world.id } }),
  ]);
  res.render('world-info', { world, cfg: world.getConfig(), players, villages, lobbyPage: 'info' });
}));

// Ancienne adresse de la fin du monde : elle est maintenant dans les classements.
router.get('/worlds/:slug/victory', requireAuth, (req, res) => res.redirect(`/worlds/${encodeURIComponent(req.params.slug)}/ranking?type=victory`));

router.get('/worlds/:slug/ranking', requireAuth, ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  const player = await Player.findOne({ where: { worldId: world.id, userId: req.session.userId }, attributes: ['id', 'tribeId'] });
  res.render('ranking', await rankingLocals(world, req.query, player ? { playerId: player.id, tribeId: player.tribeId } : {}));
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
