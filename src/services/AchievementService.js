'use strict';

const { Op, fn, col } = require('sequelize');
const { World, Player, Village, PlayerAchievement, Report } = require('../models');
const registry = require('../game/registry');
const DEFINITIONS = require('../game/data/achievements');

const TIER_NAMES = ['bois', 'bronze', 'argent', 'or'];
const DAY = 86400000;

function tierFor(def, value) {
  if (value == null) return 0;
  return def.tiers.filter((threshold) => (def.rank ? value > 0 && value <= threshold : value >= threshold)).length;
}

class AchievementService {
  /**
   * Ajoute des compteurs aux statistiques du joueur. `attacked` : identifiant d'un joueur attaqué
   * (compté une seule fois) ; les autres clés sont additionnées.
   */
  static async addStats(playerId, deltas, t) {
    if (!playerId) return;
    const player = await Player.findByPk(playerId, { transaction: t });
    if (!player) return;
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
  }

  static async rankOf(player, t) {
    const better = await Player.count({
      where: { worldId: player.worldId, [Op.or]: [{ points: { [Op.gt]: player.points } }, { points: player.points, id: { [Op.lt]: player.id } }] },
      transaction: t,
    });
    return better + 1;
  }

  /** Meilleure place du joueur parmi les continents où il a des villages. */
  static async bestContinentRank(player, t) {
    const MapService = require('./MapService');
    const villages = await Village.findAll({ where: { playerId: player.id }, attributes: ['x', 'y'], raw: true, transaction: t });
    const ks = [...new Set(villages.map((v) => `K${Math.floor(v.y / 100)}${Math.floor(v.x / 100)}`))];
    let best = null;
    for (const k of ks) {
      const rows = await MapService.continentRanking(player.worldId, k, { limit: 1e9 });
      const i = rows.findIndex((r) => r.player.id === player.id);
      if (i >= 0 && (best == null || i + 1 < best)) best = i + 1;
    }
    return best;
  }

  static async metrics(player, cfg, { now = new Date(), t } = {}) {
    const s = player.stats || {};
    return {
      points: player.points,
      rank: player.villageCount > 0 ? await AchievementService.rankOf(player, t) : null,
      continentRank: await AchievementService.bestContinentRank(player, t),
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
  static async evaluate(playerId, { now = new Date(), t } = {}) {
    const player = await Player.findByPk(playerId, { transaction: t });
    if (!player) return [];
    // Membres de tribu d'avant les succès : le compteur de jours démarre maintenant.
    if (player.tribeId && !player.tribeJoinedAt) await player.update({ tribeJoinedAt: now }, { transaction: t });
    const cfg = (await World.findByPk(player.worldId, { transaction: t })).getConfig();
    const values = await AchievementService.metrics(player, cfg, { now, t });
    const existing = new Map((await PlayerAchievement.findAll({ where: { playerId }, transaction: t })).map((a) => [a.key, a]));
    const unlocked = [];
    for (const def of AchievementService.definitionsFor(cfg)) {
      const tier = tierFor(def, values[def.metric]);
      const current = existing.get(def.key);
      if (tier <= (current?.tier || 0)) continue;
      if (current) await current.update({ tier, unlockedAt: now }, { transaction: t });
      else await PlayerAchievement.create({ playerId, key: def.key, tier, unlockedAt: now }, { transaction: t });
      unlocked.push({ def, tier });
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

  static async evaluateMany(playerIds, options) {
    for (const id of new Set(playerIds.filter(Boolean))) await AchievementService.evaluate(id, options);
  }

  /** Classement des succès : bois 1, bronze 2, argent 3, or 4 points par succès ; 4 par succès quotidien. */
  static async ranking(worldId, limit = 100) {
    const rows = await PlayerAchievement.findAll({
      attributes: ['playerId', [fn('SUM', col('tier')), 'score'], [fn('COUNT', col('PlayerAchievement.id')), 'count']],
      include: [{ model: Player, attributes: ['id', 'name', 'userId'], where: { worldId } }],
      group: ['playerId', 'Player.id'],
      raw: true,
      nest: true,
    });
    const { DailyAward } = require('../models');
    const daily = await DailyAward.findAll({ where: { worldId }, attributes: ['playerId'], raw: true });
    const byPlayer = new Map(rows.map((r) => [r.Player.id, { player: r.Player, score: Number(r.score), count: Number(r.count) }]));
    for (const { playerId } of daily) {
      if (!byPlayer.has(playerId)) {
        const p = await Player.findByPk(playerId, { attributes: ['id', 'name', 'userId'], raw: true });
        byPlayer.set(playerId, { player: p, score: 0, count: 0 });
      }
      const row = byPlayer.get(playerId);
      row.score += 4; // les succès quotidiens valent toujours un cadre or
      row.count += 1;
    }
    return [...byPlayer.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

AchievementService.TIER_NAMES = TIER_NAMES;
AchievementService.tierFor = tierFor;

module.exports = AchievementService;
