'use strict';

// Aperçus des villages (overview_villages de Guerre Tribale) : une ligne par village du joueur, avec ses
// ressources, sa ferme, ses troupes, ses bâtiments et l'activité de ses files, à jour à l'instant de la requête.

const { Op } = require('sequelize');
const { Village, Command } = require('../models');
const VillageService = require('./VillageService');
const TradeService = require('./TradeService');

class VillagesOverviewService {
  /** @returns {Promise<object[]>} une ligne par village, dans l'ordre du sélecteur de villages (nom, puis id) */
  static async rows(playerId, now = new Date()) {
    const villages = await Village.findAll({ where: { playerId }, attributes: ['id'], order: [['name', 'ASC'], ['id', 'ASC']], raw: true });
    const ids = villages.map((v) => v.id);
    const attacks = await Command.findAll({ where: { type: 'attack', targetVillageId: { [Op.in]: ids } }, attributes: ['targetVillageId'], raw: true });
    const out = [];
    // Un village après l'autre, chacun dans sa transaction (comme TradeService.villagesSummary).
    for (const id of ids) {
      out.push(await VillageService.withVillage(id, async (ctx, t) => {
        const { village, state } = ctx;
        const recruiting = (b) => ctx.recruitOrders.filter((o) => o.building === b);
        return {
          village,
          points: village.points,
          resources: { ...state.resources },
          production: state.productionPerHour(),
          storage: state.storageCapacity(),
          pop: { used: ctx.popUsed(), max: state.farmCapacity() },
          units: { ...state.units },
          away: ctx.awayUnits,
          buildings: { ...state.buildings },
          buildOrders: ctx.buildOrders,
          recruiting,
          researchOrders: ctx.researchOrders,
          merchants: await TradeService.merchants(ctx, t),
          incomingAttacks: attacks.filter((c) => c.targetVillageId === id).length,
        };
      }, { now }));
    }
    return out;
  }
}

module.exports = VillagesOverviewService;
