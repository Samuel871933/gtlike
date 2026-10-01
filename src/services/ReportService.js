'use strict';

const { Op } = require('sequelize');
const { Report } = require('../models');
const GameError = require('./GameError');
const { paginate } = require('./PaginationService');

// Filtres de la boîte de rapports : clé → types de rapport.
const FILTERS = {
  all: null,
  attack: ['attack'],
  defense: ['defense'],
  support: ['support'],
  trade: ['trade'],
  award: ['award'],
  scavenge: ['scavenge'],
};

function parseIds(input) {
  const list = Array.isArray(input) ? input : input == null ? [] : [input];
  return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

class ReportService {
  /** Page de la boîte de rapports ; `perPage` : réglage du joueur (PaginationService). */
  static async list(playerId, { filter = 'all', page = 1, perPage = 25 } = {}) {
    const types = FILTERS[filter] === undefined ? null : FILTERS[filter];
    const where = { playerId, ...(types ? { type: { [Op.in]: types } } : {}) };
    const p = paginate(await Report.count({ where }), page, perPage);
    const reports = await Report.findAll({
      where,
      order: [['happenedAt', 'DESC'], ['id', 'DESC']],
      limit: p.perPage,
      offset: p.offset,
    });
    return { reports, ...p };
  }

  /** Rapports non lus par filtre de la boîte : { all: 4, attack: 2, … } (menu « Rapports » de l'en-tête). */
  static async unreadByFilter(playerId) {
    const rows = await Report.findAll({
      where: { playerId, isRead: false },
      attributes: ['type', [Report.sequelize.fn('COUNT', Report.sequelize.col('id')), 'n']],
      group: ['type'],
      raw: true,
    });
    const byType = Object.fromEntries(rows.map((r) => [r.type, Number(r.n)]));
    return Object.fromEntries(Object.entries(FILTERS).map(([key, types]) => [
      key,
      types ? types.reduce((s, t) => s + (byType[t] || 0), 0) : Object.values(byType).reduce((s, n) => s + n, 0),
    ]));
  }

  static async get(playerId, reportId) {
    const report = await Report.findOne({ where: { id: Number(reportId), playerId } });
    if (!report) throw new GameError('Rapport introuvable.', 404);
    return report;
  }

  /** Rapports voisins dans la boîte (flèches ↑ ↓ de GT) : `newer` le plus proche plus récent, `older` le plus ancien suivant. */
  static async neighbours(playerId, report) {
    const at = report.happenedAt;
    const [newer, older] = await Promise.all([
      Report.findOne({
        where: { playerId, [Op.or]: [{ happenedAt: { [Op.gt]: at } }, { happenedAt: at, id: { [Op.gt]: report.id } }] },
        order: [['happenedAt', 'ASC'], ['id', 'ASC']], attributes: ['id'],
      }),
      Report.findOne({
        where: { playerId, [Op.or]: [{ happenedAt: { [Op.lt]: at } }, { happenedAt: at, id: { [Op.lt]: report.id } }] },
        order: [['happenedAt', 'DESC'], ['id', 'DESC']], attributes: ['id'],
      }),
    ]);
    return { newer: newer ? newer.id : null, older: older ? older.id : null };
  }

  /** Action groupée sur des rapports du joueur : read | unread | delete. Renvoie le nombre traité. */
  static async bulk(playerId, action, ids) {
    const list = parseIds(ids);
    if (!list.length) throw new GameError('Aucun rapport sélectionné.');
    const where = { playerId, id: { [Op.in]: list } };
    if (action === 'delete') return Report.destroy({ where });
    if (action === 'read' || action === 'unread') {
      const [n] = await Report.update({ isRead: action === 'read' }, { where });
      return n;
    }
    throw new GameError('Action inconnue.');
  }

  static async markAllRead(playerId) {
    const [n] = await Report.update({ isRead: true }, { where: { playerId, isRead: false } });
    return n;
  }
}

ReportService.FILTERS = Object.keys(FILTERS);

module.exports = ReportService;
