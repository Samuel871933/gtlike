'use strict';

const { Op } = require('sequelize');
const { Command, Player, Village } = require('../models');
const { orderBadge } = require('../web/helpers');

/**
 * Ordres en route associés à chaque village, limités au joueur et aux membres qui les partagent : les attaques,
 * soutiens et déplacements sur leur cible ; les retours sur le village d'où les troupes reviennent (la cible de
 * l'attaque, `targetVillageId` d'un ordre de retour), avec le village où elles rentrent.
 */
async function visible(viewer, villageIds) {
  const byVillage = new Map();
  if (!villageIds.length) return byVillage;
  const authors = [viewer.id];
  if (viewer.tribeId && viewer.showTribeOrders) {
    const sharing = await Player.findAll({
      where: { tribeId: viewer.tribeId, shareTribeOrders: true, id: { [Op.ne]: viewer.id } },
      attributes: ['id'], raw: true,
    });
    authors.push(...sharing.map((p) => p.id));
  }
  const commands = await Command.findAll({
    where: {
      [Op.or]: [
        { targetVillageId: villageIds, type: { [Op.in]: ['attack', 'support', 'relocate'] }, cancelled: false },
        { targetVillageId: villageIds, type: 'return' },
      ],
      arrivesAt: { [Op.gt]: new Date() },
    },
    attributes: ['originVillageId', 'targetVillageId', 'type', 'units', 'arrivesAt'],
    include: [{ association: 'origin', required: true, attributes: ['id', 'name', 'x', 'y', 'playerId'],
      where: { playerId: authors }, include: [{ model: Player, attributes: ['id', 'name'] }] },
    { association: 'target', required: true, attributes: ['id', 'name', 'x', 'y'] }],
    order: [['arrivesAt', 'ASC']],
  });
  for (const command of commands) {
    const origin = command.origin;
    // Retour : la ligne de l'infobulle nomme le village où les troupes rentrent ; sinon, celui d'où l'ordre est parti.
    const villageId = command.targetVillageId;
    const from = origin;
    const list = byVillage.get(villageId) || { own: [], tribe: [] };
    list[origin.playerId === viewer.id ? 'own' : 'tribe'].push({
      type: command.type, arrivesAt: command.arrivesAt, origin: from.name,
      x: from.x, y: from.y, player: origin.Player ? origin.Player.name : '',
      badge: orderBadge(command.type, command.units, 'sm'),
      mapBadge: orderBadge(command.type, command.units, 'map'),
    });
    byVillage.set(villageId, list);
  }
  return byVillage;
}

module.exports = { visible };
