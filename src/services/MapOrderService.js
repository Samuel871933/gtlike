'use strict';

const { Op } = require('sequelize');
const { Command, Player, Village } = require('../models');
const { orderBadge } = require('../web/helpers');

/** Ordres associés aux villages ciblés, limités au joueur et aux membres qui les partagent. */
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
      targetVillageId: villageIds,
      [Op.or]: [
        { type: { [Op.in]: ['attack', 'support', 'relocate'] }, cancelled: false },
        { type: 'return' },
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
