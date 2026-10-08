'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Op } = require('sequelize');
const { World, Village, Player, Command } = require('../../models');
const WorldService = require('../../services/WorldService');
const PrivateServerService = require('../../services/PrivateServerService');
const serverSettings = require('../../game/serverSettings');
const MapService = require('../../services/MapService');
const TribeService = require('../../services/TribeService');
const AchievementService = require('../../services/AchievementService');
const DailyService = require('../../services/DailyService');
const GameError = require('../../services/GameError');
const { MapPlacer } = require('../../game/MapPlacer');
const { FACTIONS, isFaction } = require('../../game/factions');
const { ah, flash, requireAuth } = require('../middleware');
const { memo } = require('../memo');
const { VICTORY_NAMES, worldModules } = require('../worldLabels');

const router = express.Router();

/**
 * Données de la fin du monde (entrée du menu des classements, comme « Dominance du monde » sur GT) :
 * état de la condition, part du joueur qui regarde (`me` : { playerId, tribeId, faction }) et durée tenue par le meneur.
 */
async function victoryLocals(world, me = {}) {
  const now = new Date();
  const standings = await require('../../services/VictoryService').standings(world, now);
  const state = world.victoryState || {};
  const cfg = world.getConfig();
  const scopePlayer = standings.type === 'pointsVillages' && cfg.victory.pointsVillages.scope === 'player';
  const mineId = scopePlayer ? me.playerId : cfg.factions.active ? me.faction : me.tribeId;
  const [myVillages, totalVillages] = await Promise.all([
    me.playerId ? Village.count({ where: { playerId: me.playerId } }) : 0,
    Village.count({ where: { worldId: world.id, playerId: { [Op.ne]: null } } }),
  ]);
  return {
    world, cfg, standings, state, now,
    mine: (standings.list || []).find((r) => r.id === mineId) || null,
    hasMine: Boolean(mineId),
    contribution: totalVillages ? (100 * myVillages) / totalVillages : 0,
    heldMs: state.holderId && state.since ? now - new Date(state.since) : 0,
  };
}

// Classements : types (menu de gauche) et nombre de lignes par page, comme sur Guerre Tribale.
// `victory` : la fin du monde (dominance, runes…), dans le même cadre que les classements.
const RANKING_TYPES = ['players', 'tribes', 'continent', 'kills', 'awards', 'daily', 'victory'];
const RANKING_PAGE = 25;
// Classements recalculés au plus une fois par minute (tous les joueurs du monde, triés).
const RANKING_TTL = 60000;

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
      type, kind, killsOf: 'players', continentRanking: null, daily: null, byTribe: true, rows: [], isMine: () => false,
      pager: { page: 1, pages: 1, offset: 0, total: 0, focus: -1 }, search: { q: '', rank: '', notFound: false },
      victory: await victoryLocals(world, me), world,
    };
  }
  const ALL = 1e9;
  // Adversaires vaincus : par joueur ou par tribu (?of=tribes), filtre en attaque / défense / soutien / total (?kind=).
  const killsOf = query.of === 'tribes' ? 'tribes' : 'players';
  // Record journalier : meilleure journée de chaque joueur dans la catégorie ?rec= (DailyService.RECORDS).
  const rec = DailyService.RECORDS.some((r) => r.key === query.rec) ? query.rec : DailyService.RECORDS[0].key;
  let continent = null;
  if (type === 'continent') {
    const list = await memo(`continents:${world.id}`, RANKING_TTL, () => MapService.continents(world.id));
    const k = list.includes(query.k) ? query.k : list[0];
    continent = { list, k, of: query.of === 'tribes' ? 'tribes' : 'players' };
  }
  // Classement complet (rang, recherche et pagination s'y calculent), recalculé au plus une fois par minute.
  const params = { kills: [kind, killsOf], daily: [rec], continent: [continent?.k, continent?.of] }[type] || [];
  const key = [type, world.id, ...params].join(':');
  const rows = await memo(`ranking:${key}`, RANKING_TTL, async () => {
    if (type === 'players') return (await MapService.ranking(world.id, ALL)).map((player) => ({ player, points: player.points, villages: player.villageCount }));
    if (type === 'tribes') return TribeService.ranking(world.id, ALL);
    if (type === 'kills') return killsOf === 'tribes' ? MapService.tribeKillRanking(world.id, kind, ALL) : MapService.killRanking(world.id, kind, ALL);
    if (type === 'awards') return AchievementService.ranking(world.id, ALL);
    if (type === 'daily') return DailyService.records(world.id, rec);
    if (type === 'continent' && continent.k) return MapService.continentRanking(world.id, continent.k, { tribes: continent.of === 'tribes', limit: ALL });
    return [];
  });

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
    daily: type === 'daily' ? { rec, records: DailyService.RECORDS, mine: mine >= 0 ? rows[mine] : null } : null,
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
// Recalculés au plus toutes les 5 minutes (tout le monde, sans connexion), et gardés autant par les navigateurs.
const EXPORT_TTL = 5 * 60000;
function sendExport(res, text) {
  res.set('Cache-Control', `public, max-age=${EXPORT_TTL / 1000}`).type('text/plain').send(text);
}

router.get('/worlds/:slug/map/village.txt', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  sendExport(res, await memo(`village.txt:${world.id}`, EXPORT_TTL, () => MapService.villageDump(world.id)));
}));

router.get('/worlds/:slug/map/player.txt', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  sendExport(res, await memo(`player.txt:${world.id}`, EXPORT_TTL, () => MapService.playerDump(world.id)));
}));

router.get('/worlds/:slug/config.json', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  res.json(world.getConfig());
}));

/**
 * Accueil : mondes officiels et serveurs privés, visibles aussi sans connexion (la connexion est demandée en rejoignant
 * un monde, voir requireAuth). Connecté : ses parties en cours, ses serveurs et ses remplacements en plus.
 */
const worldsPage = ah(async (req, res) => {
  const userId = req.user ? req.user.id : null;
  // Serveurs privés sur code : visibles de leur créateur, de leurs joueurs, ou avec le code (?code=, lien partagé).
  const code = req.query.code || null;
  const worlds = (await WorldService.listForUser(userId)).filter((w) => PrivateServerService.canAccess(w.world, {
    userId, isPlayer: Boolean(w.player), code: w.world.slug === req.query.w ? code : null,
  }));
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
  const [popularServers, playerCounts] = await Promise.all([
    PrivateServerService.popular(6),
    WorldService.playerCounts(worlds.map((w) => w.world.id)),
  ]);
  res.render('worlds', { worlds, selected, code, popularServers, playerCounts, maxOwned: PrivateServerService.MAX_OWNED, directions: MapPlacer.DIRECTIONS, factions: FACTIONS });
});

// L'accueil connecté est sur /worlds ; hors connexion, / est la page d'accueil publique (référencée).
router.get('/', (req, res, next) => (req.user ? res.redirect(`/worlds${req.originalUrl.slice(1)}`) : worldsPage(req, res, next)));
router.get('/worlds', worldsPage);

// ------------------------------------------------------------ Entrée dans un monde (page dédiée, par étapes)

// Illustration d'une faction : /img/factions/<id>.webp si le fichier existe (sinon la vue dessine un blason de repli).
const FACTION_IMG_DIR = path.join(__dirname, '../../../public/img/factions');
const factionCards = () => FACTIONS.map((f) => ({
  ...f, image: fs.existsSync(path.join(FACTION_IMG_DIR, `${f.id}.webp`)) ? `/img/factions/${f.id}.webp` : null,
}));

/**
 * Étapes de l'entrée dans un monde, une par choix : la faction (monde à factions, première inscription seulement :
 * elle est définitive), puis la position de départ sur la carte.
 */
function joinSteps(world, player) {
  return [
    ...(world.getConfig().factions.active && !(player && player.faction) ? ['faction'] : []),
    'direction',
  ];
}

/** Choix déjà faits, lus dans la requête (étapes précédentes) ; les valeurs invalides sont ignorées. */
const joinChoices = (q) => ({
  faction: isFaction(q.faction) ? q.faction : null,
  direction: MapPlacer.DIRECTIONS.includes(q.direction) ? q.direction : null,
});

/** Adresse d'une étape avec les choix déjà faits (et le code d'un serveur privé). */
function joinUrl(slug, step, choices, code) {
  const params = new URLSearchParams();
  if (step) params.set('step', String(step));
  for (const [k, v] of Object.entries(choices)) if (v) params.set(k, v);
  if (code) params.set('code', code);
  const qs = params.toString();
  return `/worlds/${encodeURIComponent(slug)}/join${qs ? `?${qs}` : ''}`;
}

/** Vérifie qu'on peut entrer dans ce monde ; renvoie le joueur existant (recommencer) ou null. */
async function joinable(req, world, code) {
  const player = await WorldService.getPlayer(req.user.id, world.id);
  if (!PrivateServerService.canAccess(world, { userId: req.user.id, isPlayer: Boolean(player), code })) {
    throw new GameError('Ce serveur privé demande son code d’accès.', 403);
  }
  return player;
}

router.get('/worlds/:slug/join', requireAuth, ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  const code = req.query.code || null;
  const player = await joinable(req, world, code);
  if (player && player.villageCount > 0) return res.redirect(`/worlds/${encodeURIComponent(world.slug)}/play`);
  if (!world.isOpen || world.endedAt) {
    flash(req, 'error', "Ce monde n'accepte plus de nouveaux joueurs.");
    return res.redirect(`/worlds?w=${encodeURIComponent(world.slug)}`);
  }
  const steps = joinSteps(world, player);
  const choices = joinChoices(req.query);
  // Une étape ne s'ouvre que si les précédentes sont faites (sinon : la première qui manque).
  let index = Math.max(0, Math.min(steps.length - 1, Number.parseInt(req.query.step, 10) || 0));
  const missing = steps.findIndex((s, i) => i < index && !choices[s]);
  if (missing >= 0) index = missing;
  res.render('join', {
    world, player, steps, index, choices, code, factions: factionCards(), directions: MapPlacer.DIRECTIONS,
    stepUrl: (i) => joinUrl(world.slug, i, choices, code), lobbyPage: 'worlds',
  });
}));

router.post('/worlds/:slug/join', requireAuth, ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  await joinable(req, world, req.body.code);
  const choices = joinChoices(req.body);
  try {
    const { village } = await WorldService.join(req.user, req.params.slug, { direction: choices.direction || 'random', faction: choices.faction });
    res.redirect(`/village/${village.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status >= 403) throw err;
    // Retour à l'entrée dans le monde, choix conservés.
    flash(req, 'error', err.message);
    res.redirect(joinUrl(world.slug, 0, choices, req.body.code));
  }
}));

// ------------------------------------------------------------ Serveurs privés

/**
 * Tous les serveurs : mondes officiels et serveurs privés ouverts (plus les serveurs sur code du créateur et de leurs
 * joueurs). Filtre ?type= (all | official | private), tri par colonne ?tri= (clé de SERVER_SORTS) et ?ordre= (asc | desc,
 * sens propre à la colonne par défaut), recherche ?q= sur le nom.
 */
const SERVER_TYPES = ['all', 'official', 'private'];
// État : tu y joues, inscriptions ouvertes, fermé, terminé.
const serverState = (r) => (r.world.endedAt ? 3 : r.player && r.player.villageCount > 0 ? 0 : r.world.isOpen ? 1 : 2);
const SERVER_SORTS = {
  name: { dir: 'asc', key: (r) => r.world.name.toLowerCase() },
  players: { dir: 'desc', key: (r) => r.players },
  recent: { dir: 'desc', key: (r) => new Date(r.world.createdAt).getTime() },
  speed: { dir: 'desc', key: (r) => { const c = r.world.getConfig(); return c.speed * 1000 + c.unitSpeed; } },
  modules: { dir: 'desc', key: (r) => worldModules(r.world.getConfig()).length },
  victory: { dir: 'asc', key: (r) => VICTORY_NAMES[r.world.getConfig().victory.type] || '' },
  state: { dir: 'asc', key: serverState },
};
router.get('/servers', ah(async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const type = SERVER_TYPES.includes(req.query.type) ? req.query.type : 'all';
  // Par défaut : les serveurs les plus récents d'abord.
  const sort = Object.hasOwn(SERVER_SORTS, req.query.tri) ? req.query.tri : 'recent';
  const dir = ['asc', 'desc'].includes(req.query.ordre) ? req.query.ordre : SERVER_SORTS[sort].dir;
  const q = String(req.query.q || '').trim();
  const visible = (await WorldService.listForUser(userId))
    .filter((w) => PrivateServerService.canAccess(w.world, { userId, isPlayer: Boolean(w.player) }));
  const counts = await WorldService.playerCounts(visible.map((w) => w.world.id));
  const key = SERVER_SORTS[sort].key;
  const cmp = (a, b) => { const x = key(a); const y = key(b); return typeof x === 'string' ? x.localeCompare(y, 'fr') : x - y; };
  const rows = visible
    .map((w) => ({ ...w, players: counts.get(w.world.id) || 0 }))
    .filter((r) => type === 'all' || (type === 'private') === r.world.isPrivate())
    .filter((r) => !q || r.world.name.toLowerCase().includes(q.toLowerCase()))
    // Mondes en cours d'abord (sauf tri par état), puis la colonne choisie, puis les plus récents.
    .sort((a, b) => (sort === 'state' ? 0 : Boolean(a.world.endedAt) - Boolean(b.world.endedAt))
      || (dir === 'asc' ? cmp(a, b) : cmp(b, a))
      || new Date(b.world.createdAt) - new Date(a.world.createdAt));
  const totals = { all: visible.length, official: visible.filter((w) => !w.world.isPrivate()).length, private: visible.filter((w) => w.world.isPrivate()).length };
  const sortDirs = Object.fromEntries(Object.entries(SERVER_SORTS).map(([k, v]) => [k, v.dir]));
  res.render('servers', { rows, type, sort, dir, sortDirs, q, totals, lobbyPage: 'servers' });
}));

/** Création d'un serveur privé : nom, accès (ouvert ou sur code) et tous les réglages du monde. */
router.get('/servers/new', requireAuth, (req, res) => {
  res.render('server-new', { groups: serverSettings.GROUPS, formValue: serverSettings.formValue, input: {}, error: null, lobbyPage: 'worlds' });
});

router.post('/servers', requireAuth, ah(async (req, res) => {
  try {
    const world = await PrivateServerService.create(req.user, req.body);
    flash(req, 'success', world.access === 'code'
      ? `Serveur créé. Code d’accès à partager : ${world.joinCode}.`
      : 'Serveur créé : il apparaît dans les serveurs publics.');
    res.redirect(`/worlds?w=${encodeURIComponent(world.slug)}`);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    // Formulaire réaffiché avec la saisie et l'erreur (un retour en arrière la perdrait).
    res.status(400).render('server-new', { groups: serverSettings.GROUPS, formValue: serverSettings.formValue, input: req.body, error: err.message, lobbyPage: 'worlds' });
  }
}));

/** Rejoindre un serveur privé avec son code : ouvre sa fiche (le code suit jusqu'à l'inscription). */
router.post('/servers/join', ah(async (req, res) => {
  const world = await PrivateServerService.findByCode(req.body.code);
  if (!world) {
    flash(req, 'error', 'Aucun serveur privé en cours avec ce code.');
    return res.redirect('/worlds');
  }
  res.redirect(`/worlds?${new URLSearchParams({ w: world.slug, code: world.joinCode })}`);
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
  res.render('ranking', await rankingLocals(world, req.query, player ? { playerId: player.id, tribeId: player.tribeId, faction: player.faction } : {}));
}));

// Exports publics des adversaires vaincus (format Guerre Tribale : rang,id_joueur,score).
for (const [file, kind] of [['kill_att', 'att'], ['kill_def', 'def'], ['kill_sup', 'sup'], ['kill_all', 'all']]) {
  router.get(`/worlds/:slug/map/${file}.txt`, ah(async (req, res) => {
    const world = await findWorld(req.params.slug);
    sendExport(res, await memo(`${file}.txt:${world.id}`, EXPORT_TTL, async () => {
      const rows = await MapService.killRanking(world.id, kind, 1e9);
      return rows.map((r, i) => [i + 1, r.player.id, r.score].join(',')).join('\n');
    }));
  }));
}

router.get('/worlds/:slug/map/ally.txt', ah(async (req, res) => {
  const world = await findWorld(req.params.slug);
  sendExport(res, await memo(`ally.txt:${world.id}`, EXPORT_TTL, async () => {
    const rows = await TribeService.ranking(world.id, 1e9);
    return rows.map((r, i) => [
      r.tribe.id, encodeURIComponent(r.tribe.name), encodeURIComponent(r.tribe.tag), r.members, r.villages, r.points, r.points, i + 1,
    ].join(',')).join('\n');
  }));
}));

module.exports = router;
module.exports.rankingLocals = rankingLocals;
module.exports.victoryLocals = victoryLocals;
