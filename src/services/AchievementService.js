'use strict';

const { Op, fn, col, UniqueConstraintError } = require('sequelize');
const { sequelize, World, Player, Village, PlayerAchievement, Report } = require('../models');
const registry = require('../game/registry');
const DEFINITIONS = require('../game/data/achievements');

const TIER_NAMES = ['bois', 'bronze', 'argent', 'or'];
const DAY = 86400000;
// Succès de rang : il faut être dans cette part du classement (10 % : premier d'un monde ou d'un continent d'au moins
// 10 joueurs, top 20 d'au moins 200…), pour que la place reflète une vraie compétition.
const RANK_SHARE = 0.1;
// Succès de rang : aucun avant ce nombre de jours de monde, le temps que le classement se forme.
const RANK_MIN_DAYS = 10;

function tierFor(def, value) {
  if (value == null) return 0;
  return def.tiers.filter((threshold) => (def.rank ? value > 0 && value <= threshold : value >= threshold)).length;
}

class AchievementService {
  /**
   * Ajoute des compteurs aux statistiques du joueur. `attacked` : identifiant d'un joueur attaqué
   * (compté une seule fois) ; les autres clés sont additionnées.
   */
  /**
   * Ajoute aux compteurs des succès (JSON stats) ; renvoie le joueur, lu sous verrou dans une transaction : deux combats
   * simultanés ne perdent pas l'un l'autre leurs compteurs, et l'appelant peut le réutiliser (SealService.onKills).
   */
  static async addStats(playerId, deltas, t) {
    if (!playerId) return null;
    const player = await Player.findByPk(playerId, { transaction: t, ...(t ? { lock: t.LOCK.UPDATE } : {}) });
    if (!player) return null;
    const stats = { ...player.stats };
    for (const [key, value] of Object.entries(deltas)) {
      if (!value) continue;
      if (key === 'attacked') {
        stats.attacked = [...new Set([...(stats.attacked || []), value])];
      } else {
        stats[key] = (stats[key] || 0) + value;
      }
    }
    await player.update({ stats }, { transaction: t });
    return player;
  }

  /**
   * Places qui comptent pour les succès de rang, dans un classement [[id du joueur, points], …]. Une égalité compte
   * contre le joueur (place = 1 + joueurs ayant au moins autant de points), et il faut être dans les RANK_SHARE premiers
   * du classement : seul inscrit d'un monde neuf, ou à égalité avec tous au départ, on n'est encore premier de rien.
   * @returns {Map<number, number>} id du joueur → place (joueurs qualifiés seulement)
   */
  static qualifiedPlaces(entries) {
    const sorted = [...entries].sort((a, b) => b[1] - a[1]);
    const places = new Map();
    let end = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i >= end) for (end = i + 1; end < sorted.length && sorted[end][1] === sorted[i][1];) end++;
      if (end <= sorted.length * RANK_SHARE) places.set(sorted[i][0], end);
    }
    return places;
  }

  /** Place qualifiée du joueur au classement du monde (voir qualifiedPlaces), null sinon. */
  static async rankOf(player, t) {
    const where = { worldId: player.worldId, villageCount: { [Op.gt]: 0 } };
    const [ahead, pool] = await Promise.all([
      Player.count({ where: { ...where, id: { [Op.ne]: player.id }, points: { [Op.gte]: player.points } }, transaction: t }),
      Player.count({ where, transaction: t }),
    ]);
    return ahead + 1 <= pool * RANK_SHARE ? ahead + 1 : null;
  }

  /**
   * Meilleure place qualifiée (voir qualifiedPlaces) de chaque joueur parmi les continents où il a des villages
   * (points de ses villages dans le continent). `continents` : limite le calcul à ces continents (tous sinon).
   * Une seule lecture des villages, sans jointure : la boucle de jeu l'appelle pour tout un monde.
   * @returns {Promise<Map<number, number>>} id du joueur → meilleure place
   */
  static async bestContinentRanks(worldId, { continents = null, t } = {}) {
    const MapService = require('./MapService');
    const where = { worldId, playerId: { [Op.ne]: null } };
    if (continents) {
      const bounds = continents.map((k) => MapService.continentBounds(k)).filter(Boolean);
      if (!bounds.length) return new Map();
      where[Op.or] = bounds.map((b) => ({ x: { [Op.between]: b.x }, y: { [Op.between]: b.y } }));
    }
    const villages = await Village.findAll({ where, attributes: ['playerId', 'x', 'y', 'points'], raw: true, transaction: t });
    const byContinent = new Map();
    for (const v of villages) {
      const k = `K${Math.floor(v.y / 100)}${Math.floor(v.x / 100)}`;
      if (!byContinent.has(k)) byContinent.set(k, new Map());
      const points = byContinent.get(k);
      points.set(v.playerId, (points.get(v.playerId) || 0) + v.points);
    }
    const best = new Map();
    for (const points of byContinent.values()) {
      for (const [playerId, place] of AchievementService.qualifiedPlaces(points)) {
        if (!best.has(playerId) || place < best.get(playerId)) best.set(playerId, place);
      }
    }
    return best;
  }

  /** Meilleure place qualifiée du joueur parmi les continents où il a des villages. */
  static async bestContinentRank(player, t) {
    const villages = await Village.findAll({ where: { playerId: player.id }, attributes: ['x', 'y'], raw: true, transaction: t });
    const continents = [...new Set(villages.map((v) => `K${Math.floor(v.y / 100)}${Math.floor(v.x / 100)}`))];
    if (!continents.length) return null;
    return (await AchievementService.bestContinentRanks(player.worldId, { continents, t })).get(player.id) ?? null;
  }

  /**
   * `ranks` : places déjà calculées pour tout le monde ({ rank, continent } : id → place, voir evaluateWorld), ou
   * `false` pour ne pas les calculer (succès de rang laissés à la boucle de jeu).
   */
  static async metrics(player, cfg, { now = new Date(), t, ranks = null } = {}) {
    const s = player.stats || {};
    let rank = null;
    let continentRank = null;
    if (ranks) {
      rank = player.villageCount > 0 ? ranks.rank.get(player.id) ?? null : null;
      continentRank = ranks.continent.get(player.id) ?? null;
    } else if (ranks === null) {
      rank = player.villageCount > 0 ? await AchievementService.rankOf(player, t) : null;
      continentRank = await AchievementService.bestContinentRank(player, t);
    }
    return {
      points: player.points,
      rank,
      continentRank,
      lootTotal: s.lootTotal || 0,
      plunders: s.plunders || 0,
      conquests: s.conquests || 0,
      unitsKilled: s.unitsKilled || 0,
      supportLosses: s.supportLosses || 0,
      levelsDestroyed: s.levelsDestroyed || 0,
      wallLevelsDestroyed: s.wallLevelsDestroyed || 0,
      battlesWon: s.battlesWon || 0,
      noblesKilled: s.noblesKilled || 0,
      supportBattles: s.supportBattles || 0,
      spyDefenses: s.spyDefenses || 0,
      attackedPlayers: (s.attacked || []).length,
      luckyNoble: s.luckyNoble || 0,
      unluckyNoble: s.unluckyNoble || 0,
      tradesCompleted: s.tradesCompleted || 0,
      coins: player.coins,
      tribeDays: player.tribeId && player.tribeJoinedAt ? Math.floor((now - new Date(player.tribeJoinedAt)) / DAY) : 0,
      allItems: player.knightItems.length >= registry.itemsFor(cfg).length ? 1 : 0,
      restarts: s.restarts || 0,
      worldWinner: s.worldWinner || 0,
    };
  }

  static definitionsFor(cfg) {
    return DEFINITIONS.filter((d) => cfg.hasFeature(d.feature));
  }

  /** Succès du joueur : palier atteint et valeur actuelle de chaque succès du monde. */
  static async overview(playerId, { now = new Date() } = {}) {
    const player = await Player.findByPk(playerId);
    const cfg = (await World.findByPk(player.worldId)).getConfig();
    const [values, unlocked] = await Promise.all([
      AchievementService.metrics(player, cfg, { now }),
      PlayerAchievement.findAll({ where: { playerId } }),
    ]);
    const byKey = new Map(unlocked.map((a) => [a.key, a]));
    return AchievementService.definitionsFor(cfg).map((def) => ({
      def, value: values[def.metric], tier: byKey.get(def.key)?.tier || 0, unlockedAt: byKey.get(def.key)?.unlockedAt || null,
    }));
  }

  /**
   * Débloque les paliers atteints (jamais de retour en arrière, même si le rang baisse ensuite)
   * et prévient le joueur par un rapport. Renvoie les succès débloqués.
   */
  static async evaluate(playerId, { now = new Date(), t, ranks = null } = {}) {
    const player = await Player.findByPk(playerId, { transaction: t });
    if (!player) return [];
    const world = await World.cached(player.worldId);
    const existing = await PlayerAchievement.findAll({ where: { playerId }, transaction: t });
    return AchievementService.unlock(player, world, existing, { now, t, ranks });
  }

  /**
   * Tous les joueurs d'un monde (boucle de jeu) : rangs et places par continent calculés une seule fois, succès
   * déjà débloqués lus d'un coup. Seuls les nouveaux paliers donnent lieu à une écriture.
   */
  static async evaluateWorld(world, { now = new Date() } = {}) {
    const players = await Player.findAll({ where: { worldId: world.id } });
    if (!players.length) return [];
    const ranks = !AchievementService.ranksOpen(world, now) ? false : {
      rank: AchievementService.qualifiedPlaces(players.filter((p) => p.villageCount > 0).map((p) => [p.id, p.points])),
      continent: await AchievementService.bestContinentRanks(world.id),
    };
    const existing = new Map(players.map((p) => [p.id, []]));
    const rows = await PlayerAchievement.findAll({
      include: [{ model: Player, attributes: [], where: { worldId: world.id }, required: true }],
    });
    for (const a of rows) existing.get(a.playerId)?.push(a);
    const unlocked = [];
    for (const player of players) {
      // Un joueur par transaction : un combat peut débloquer le même succès pendant ce passage (lecture du début
      // périmée). Ce joueur est alors repris au passage suivant, sans arrêter celui des autres.
      try {
        unlocked.push(...await sequelize.transaction((t) => AchievementService.unlock(player, world, existing.get(player.id), { now, ranks, t })));
      } catch (err) {
        if (!(err instanceof UniqueConstraintError)) throw err;
      }
    }
    return unlocked;
  }

  /** Succès de rang ouverts : monde d'au moins RANK_MIN_DAYS jours. */
  static ranksOpen(world, now = new Date()) {
    return now - new Date(world.createdAt) >= RANK_MIN_DAYS * DAY;
  }

  /** Paliers nouvellement atteints par le joueur : enregistrés, avec un rapport chacun. */
  static async unlock(player, world, achievements, { now, t, ranks = null }) {
    const cfg = world.getConfig();
    if (!AchievementService.ranksOpen(world, now)) ranks = false;
    // Membres de tribu d'avant les succès : le compteur de jours démarre maintenant.
    if (player.tribeId && !player.tribeJoinedAt) await player.update({ tribeJoinedAt: now }, { transaction: t });
    const values = await AchievementService.metrics(player, cfg, { now, t, ranks });
    const existing = new Map(achievements.map((a) => [a.key, a]));
    const playerId = player.id;
    const unlocked = [];
    for (const def of AchievementService.definitionsFor(cfg)) {
      const tier = tierFor(def, values[def.metric]);
      const current = existing.get(def.key);
      if (tier <= (current?.tier || 0)) continue;
      if (current) await current.update({ tier, unlockedAt: now }, { transaction: t });
      else await PlayerAchievement.create({ playerId, key: def.key, tier, unlockedAt: now }, { transaction: t });
      unlocked.push({ def, tier });
      // Sceaux (mondes officiels avec le module) : un sceau du niveau de chaque palier nouvellement atteint.
      for (let reached = (current?.tier || 0) + 1; reached <= tier; reached++) {
        await require('./SealService').onAchievement(player, def, reached, { t, now });
      }
      const label = def.tiers.length > 1 ? ` (${TIER_NAMES[tier - 1]})` : '';
      await Report.create({
        playerId, type: 'award', happenedAt: now, title: `Succès débloqué : ${def.name}${label}`,
        data: {
          perspective: 'award', key: def.key, tier, tiers: def.tiers.length, name: def.name, description: def.description,
          goal: def.tiers[tier - 1], next: def.tiers[tier] ?? null,
        },
      }, { transaction: t });
    }
    return unlocked;
  }

  /** Plusieurs joueurs d'un coup (participants d'un combat) : joueurs et succès lus ensemble, monde une fois. */
  static async evaluateMany(playerIds, { now = new Date(), t, ranks = null } = {}) {
    const ids = [...new Set(playerIds.filter(Boolean))];
    if (!ids.length) return;
    const [players, rows] = await Promise.all([
      Player.findAll({ where: { id: { [Op.in]: ids } }, transaction: t }),
      PlayerAchievement.findAll({ where: { playerId: { [Op.in]: ids } }, transaction: t }),
    ]);
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const id of ids) {
      const player = byId.get(id);
      if (!player) continue;
      await AchievementService.unlock(player, await World.cached(player.worldId), rows.filter((a) => a.playerId === id), { now, t, ranks });
    }
  }

  /** Classement des succès : bois 1, bronze 2, argent 3, or 4 points par succès ; 4 par succès quotidien. */
  static async ranking(worldId, limit = 100) {
    const rows = await PlayerAchievement.findAll({
      attributes: ['playerId', [fn('SUM', col('tier')), 'score'], [fn('COUNT', col('PlayerAchievement.id')), 'count']],
      include: [{ model: Player, attributes: ['id', 'name', 'userId', 'isBot', 'avatar'], where: { worldId } }],
      group: ['playerId', 'Player.id'],
      raw: true,
      nest: true,
    });
    const { DailyAward } = require('../models');
    const daily = await DailyAward.findAll({ where: { worldId }, attributes: ['playerId'], raw: true });
    const byPlayer = new Map(rows.map((r) => [r.Player.id, { player: r.Player, score: Number(r.score), count: Number(r.count) }]));
    // Gagnants quotidiens sans succès : lus d'un coup.
    const missing = [...new Set(daily.map((d) => d.playerId).filter((id) => !byPlayer.has(id)))];
    const others = missing.length ? await Player.findAll({ where: { id: { [Op.in]: missing } }, attributes: ['id', 'name', 'userId', 'isBot', 'avatar'], raw: true }) : [];
    const otherById = new Map(others.map((p) => [p.id, p]));
    for (const { playerId } of daily) {
      if (!byPlayer.has(playerId)) byPlayer.set(playerId, { player: otherById.get(playerId) || null, score: 0, count: 0 });
      const row = byPlayer.get(playerId);
      row.score += 4; // les succès quotidiens valent toujours un cadre or
      row.count += 1;
    }
    return [...byPlayer.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

AchievementService.TIER_NAMES = TIER_NAMES;
AchievementService.tierFor = tierFor;
AchievementService.RANK_SHARE = RANK_SHARE;
AchievementService.RANK_MIN_DAYS = RANK_MIN_DAYS;

module.exports = AchievementService;
