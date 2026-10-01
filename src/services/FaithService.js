'use strict';

const { Village } = require('../models');
const faith = require('../game/faith');

// Foi des villages (mondes avec église, voir game/faith.js) : lit les églises d'un joueur en base.
class FaithService {
  /**
   * Églises d'un joueur : [{ x, y, radius }]. `override` : niveaux à jour d'un de ses villages ({ id, buildings }),
   * prioritaires sur la base (village en cours de traitement).
   */
  static async churches(playerId, cfg, { t, override } = {}) {
    if (!playerId || !cfg.hasFeature('church')) return [];
    const villages = await Village.findAll({ where: { playerId }, attributes: ['id', 'x', 'y', 'buildings'], transaction: t });
    return faith.churchesOf(villages.map((v) => (override && v.id === override.id ? { x: v.x, y: v.y, buildings: override.buildings } : v)), cfg);
  }

  /** Facteur de force (1 ou cfg.church.faithless) des troupes d'un village { id, x, y, playerId }. */
  static async factor(village, cfg, { t, buildings } = {}) {
    if (!village.playerId || !cfg.hasFeature('church')) return 1;
    const churches = await FaithService.churches(village.playerId, cfg, { t, override: buildings ? { id: village.id, buildings } : null });
    return faith.factorFor(village, churches, cfg);
  }
}

module.exports = FaithService;
