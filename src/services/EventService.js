'use strict';

const { Op } = require('sequelize');
const { Command, Transport } = require('../models');
const CommandService = require('./CommandService');
const TradeService = require('./TradeService');

/**
 * Traite toutes les arrivées échues (troupes et marchands) dans un seul ordre chronologique :
 * une livraison arrivée juste avant une attaque peut être pillée.
 */
class EventService {
  static async processDue(now = new Date(), { rng = Math.random, max = 500 } = {}) {
    const due = { where: { arrivesAt: { [Op.lte]: now } }, order: [['arrivesAt', 'ASC'], ['id', 'ASC']], attributes: ['id', 'arrivesAt'] };
    let processed = 0;
    while (processed < max) {
      const [cmd, tr] = await Promise.all([Command.findOne(due), Transport.findOne(due)]);
      if (!cmd && !tr) break;
      if (tr && (!cmd || new Date(tr.arrivesAt) <= new Date(cmd.arrivesAt))) await TradeService.process(tr.id);
      else await CommandService.process(cmd.id, { rng });
      processed++;
    }
    return processed;
  }
}

module.exports = EventService;
