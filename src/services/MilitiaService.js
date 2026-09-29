'use strict';

const { Village } = require('../models');
const VillageService = require('./VillageService');
const GameError = require('./GameError');

/**
 * Milice, comme sur GT (module `militia` du monde, réglages `militia`) : depuis la ferme, un joueur qui a au plus
 * `maxVillages` villages appelle `perFarmLevel` miliciens par niveau de ferme (jusqu'au niveau `maxFarmLevel`).
 * Ils défendent le village pendant `hours` heures sans pouvoir le quitter ; la production des ressources est
 * multipliée par `productionFactor` jusqu'à leur départ.
 */
class MilitiaService {
  static enabled(cfg) {
    return cfg.hasFeature('militia');
  }

  /** Taille de la milice pour ce niveau de ferme. */
  static size(cfg, farmLevel) {
    return cfg.militia.perFarmLevel * Math.min(farmLevel, cfg.militia.maxFarmLevel);
  }

  /** Pourquoi la milice ne peut pas être appelée maintenant (ou null). */
  static async blocker(ctx, t) {
    const { cfg, state, village } = ctx;
    if (!MilitiaService.enabled(cfg)) return 'La milice n’existe pas sur ce monde.';
    if (state.level('farm') < 1) return 'Il faut une ferme.';
    if (state.militiaActive(ctx.now)) return 'La milice est déjà stationnée dans ce village.';
    const villages = await Village.count({ where: { playerId: village.playerId }, transaction: t });
    if (villages > cfg.militia.maxVillages) return `Dès que tu possèdes plus de ${cfg.militia.maxVillages} villages, tu ne peux plus créer de milice.`;
    return null;
  }

  static async call(villageId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const blocker = await MilitiaService.blocker(ctx, t);
      if (blocker) throw new GameError(blocker);
      const { state, cfg } = ctx;
      const size = MilitiaService.size(cfg, state.level('farm'));
      state.units.militia = (state.units.militia || 0) + size;
      state.militiaUntil = new Date(ctx.now.getTime() + cfg.militia.hours * 3600000);
      await ctx.village.update({ units: state.units, militiaUntil: state.militiaUntil }, { transaction: t });
      return { size, until: state.militiaUntil };
    }, { now });
  }
}

module.exports = MilitiaService;
