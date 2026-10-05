'use strict';

const { Op } = require('sequelize');
const { Player, Village, Command, SupportStack, RecruitOrder } = require('../models');
const GameError = require('./GameError');

/**
 * Système de pièces d'or : le n-ième noble demande n pièces de plus que le précédent
 * (1, 3, 6, 10… pièces au total). Chaque village conquis occupe un emplacement,
 * comme chaque noble vivant ou en formation.
 */
class NobleService {
  static maxNobles(coins) {
    return Math.floor((Math.sqrt(8 * coins + 1) - 1) / 2);
  }

  /** Pièces au total nécessaires pour `n` emplacements. */
  static coinsFor(n) {
    return (n * (n + 1)) / 2;
  }

  /**
   * Nombre total d'unités d'un type appartenant au joueur : dans ses villages, en route,
   * en soutien ailleurs et en cours de recrutement.
   */
  static async playerUnitCount(playerId, unitId, t) {
    const villages = await Village.findAll({ where: { playerId }, attributes: ['id', 'units'], transaction: t });
    const ids = villages.map((v) => v.id);
    const [commands, stacks, orders] = await Promise.all([
      Command.findAll({ where: { originVillageId: { [Op.in]: ids } }, attributes: ['units'], transaction: t }),
      SupportStack.findAll({ where: { originVillageId: { [Op.in]: ids } }, attributes: ['units'], transaction: t }),
      RecruitOrder.findAll({ where: { villageId: { [Op.in]: ids }, unit: unitId }, attributes: ['count', 'done'], transaction: t }),
    ]);
    const count = [...villages, ...commands, ...stacks].reduce((n, x) => n + (x.units[unitId] || 0), 0)
      + orders.reduce((n, o) => n + o.count - o.done, 0);
    return { count, villages: villages.length };
  }

  static async slots(playerId, t) {
    const player = await Player.findByPk(playerId, { transaction: t });
    const { count: nobles, villages } = await NobleService.playerUnitCount(playerId, 'snob', t);
    const conquered = Math.max(0, villages - 1);
    const max = NobleService.maxNobles(player.coins);
    const used = conquered + nobles;
    return {
      coins: player.coins,
      max,
      used,
      nobles,
      conquered,
      free: Math.max(0, max - used),
      coinsForNextSlot: NobleService.coinsFor(max + 1) - player.coins,
    };
  }

  /** Coût d'une pièce d'or dans ce village (sceau « coût réduit des pièces » : jusqu'à −24 %). */
  static coinCost(cfg, state) {
    const cut = 1 - require('../game/seals').bonus(state.seal, 'coin');
    const c = cfg.snob.coin;
    return { wood: Math.round(c.wood * cut), stone: Math.round(c.stone * cut), iron: Math.round(c.iron * cut) };
  }

  /** Frappe des pièces d'or dans l'académie du village (paiement immédiat). */
  static async mint(villageId, count, { now } = {}) {
    const VillageService = require('./VillageService');
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1) throw new GameError('Nombre de pièces invalide.');
    return VillageService.withVillage(villageId, async (ctx, t) => {
      if (ctx.state.level('snob') < 1) throw new GameError("Il faut une académie.");
      const c = NobleService.coinCost(ctx.cfg, ctx.state);
      const cost = { wood: c.wood * n, stone: c.stone * n, iron: c.iron * n };
      if (!ctx.state.canAfford(cost)) throw new GameError('Ressources insuffisantes.');
      ctx.state.pay(cost);
      await ctx.village.update(ctx.state.resources, { transaction: t });
      await Player.increment({ coins: n }, { where: { id: ctx.village.playerId }, transaction: t });
      await require('./AchievementService').evaluate(ctx.village.playerId, { now: ctx.now, t });
    }, { now });
  }
}

module.exports = NobleService;
