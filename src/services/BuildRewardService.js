'use strict';

// Récompenses de construction (comme sur Guerre Tribale, réglages `buildRewards` du monde, voir game/buildRewards.js) :
// chaque niveau de bâtiment construit pour la première fois par le joueur sur le monde lui vaut des ressources, à
// récupérer dans le village de son choix (page Récompenses). Un même niveau ne rapporte qu'une fois, même construit
// dans un autre village ; les bâtiments de départ et ceux d'un village conquis ne rapportent rien.

const { Op } = require('sequelize');
const { BuildReward, Player } = require('../models');
const VillageService = require('./VillageService');
const GameError = require('./GameError');
const buildRewards = require('../game/buildRewards');
const registry = require('../game/registry');

const RESOURCES = ['wood', 'stone', 'iron'];

class BuildRewardService {
  /**
   * Constructions terminées dans un village (`finished` : ordres de VillageState.applyBuildOrders) : une récompense
   * par niveau jamais récompensé, si le monde en donne encore à la fin du chantier. Pas pour les bots.
   */
  static async onBuilt(village, world, cfg, finished, t) {
    const built = finished.filter((o) => !o.demolish && buildRewards.active(cfg, world, o.endsAt));
    if (!village.playerId || !built.length) return;
    const player = await Player.findByPk(village.playerId, { attributes: ['isBot'], transaction: t });
    if (!player || player.isBot) return;
    await BuildReward.bulkCreate(built.map((o) => ({
      playerId: village.playerId, villageId: village.id, building: o.building, level: o.level, earnedAt: o.endsAt,
      ...buildRewards.amount(o.building, o.level, cfg),
    })), { ignoreDuplicates: true, transaction: t });
  }

  /** Récompenses en attente du joueur, les plus anciennes d'abord. */
  static pending(playerId, t) {
    return BuildReward.findAll({ where: { playerId, collectedAt: null }, order: [['earnedAt', 'ASC'], ['id', 'ASC']], transaction: t });
  }

  /** Population occupée par des troupes { id: nombre }. */
  static unitsPop(units) {
    return Object.entries(units || {}).reduce((n, [id, k]) => n + registry.unit(id).pop * k, 0);
  }

  static pendingCount(playerId) {
    return BuildReward.count({ where: { playerId, collectedAt: null } });
  }

  static collectedCount(playerId) {
    return BuildReward.count({ where: { playerId, collectedAt: { [Op.ne]: null } } });
  }

  /**
   * Verse des récompenses dans le village (`ids` : celles-ci, ou toutes si null), dans l'ordre. Rien ne se perd : une
   * récompense qui ferait déborder l'entrepôt, ou des troupes que la ferme ne peut pas loger, restent en attente.
   * @returns {{ collected: number, left: number, total: { wood, stone, iron } }}
   */
  static async collect(playerId, villageId, ids = null, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      if (ctx.village.playerId !== playerId) throw new GameError('Village introuvable.', 404);
      let rewards = await BuildRewardService.pending(playerId, t);
      if (ids) rewards = rewards.filter((r) => ids.includes(r.id));
      if (!rewards.length) throw new GameError(ids ? 'Cette récompense a déjà été récupérée.' : 'Aucune récompense à récupérer.', 404);
      const cap = ctx.state.storageCapacity();
      const total = { wood: 0, stone: 0, iron: 0 };
      let collected = 0;
      let reason = null;
      for (const r of rewards) {
        if (RESOURCES.some((res) => ctx.state.resources[res] + r[res] > cap)) {
          reason = "L'entrepôt est trop plein : libère de la place avant de récupérer.";
          continue;
        }
        // Troupes (quêtes) : elles arrivent au village si la ferme peut les loger.
        if (r.units && ctx.popUsed() + BuildRewardService.unitsPop(r.units) > ctx.state.farmCapacity()) {
          reason = 'La ferme est trop petite pour accueillir ces troupes.';
          continue;
        }
        for (const res of RESOURCES) {
          ctx.state.resources[res] += r[res];
          total[res] += r[res];
        }
        for (const [id, n] of Object.entries(r.units || {})) ctx.state.units[id] = (ctx.state.units[id] || 0) + n;
        await r.update({ collectedAt: ctx.now }, { transaction: t });
        collected += 1;
      }
      if (!collected) throw new GameError(reason);
      await ctx.village.update({ ...ctx.state.resources, units: { ...ctx.state.units } }, { transaction: t });
      return { collected, left: rewards.length - collected, total };
    }, { now });
  }
}

BuildRewardService.endsAt = buildRewards.endsAt;
BuildRewardService.active = buildRewards.active;

module.exports = BuildRewardService;
