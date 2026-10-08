'use strict';

const { Player } = require('../models');
const GameError = require('./GameError');

// Listes dont le joueur choisit le nombre de lignes par page : colonne du joueur (nulle : valeur par défaut), bornes
// et nom des lignes (« Rapports par page »). Un réglage par liste, enregistré par la route commune /per-page.
const LISTS = {
  reports: { field: 'reportsPerPage', default: 25, min: 5, max: 200, noun: 'rapports' },
  messages: { field: 'messagesPerPage', default: 12, min: 5, max: 100, noun: 'messages' },
  market: { field: 'marketPerPage', default: 20, min: 5, max: 100, noun: 'offres' },
  incomings: { field: 'incomingsPerPage', default: 100, min: 20, max: 1000, noun: 'ordres' },
  farm: { field: 'farmPerPage', default: 15, min: 5, max: 200, noun: 'entrées' },
  manager: { field: 'managerPerPage', default: 100, min: 20, max: 1000, noun: 'villages' },
  villages: { field: 'villagesPerPage', default: 100, min: 20, max: 1000, noun: 'villages' },
};

class PaginationService {
  /**
   * Page demandée ramenée entre 1 et le nombre de pages (`'last'` : la dernière).
   * @returns {{ page, pages, perPage, offset, total }}
   */
  static paginate(total, page, perPage) {
    const pages = Math.max(1, Math.ceil(total / perPage));
    const asked = page === 'last' ? pages : Math.floor(Number(page)) || 1;
    const current = Math.min(pages, Math.max(1, asked));
    return { page: current, pages, perPage, offset: (current - 1) * perPage, total };
  }

  /** Page d'une liste déjà en mémoire : ses lignes et la pagination (voir paginate). */
  static slice(list, page, perPage) {
    const pagination = PaginationService.paginate(list.length, page, perPage);
    return { rows: list.slice(pagination.offset, pagination.offset + pagination.perPage), pagination };
  }

  /** Lignes par page choisies par le joueur pour une liste (bornées), sinon la valeur par défaut. */
  static perPage(player, list) {
    const def = LISTS[list];
    const n = Math.floor(Number(player && player[def.field]));
    return Number.isFinite(n) && n > 0 ? Math.min(def.max, Math.max(def.min, n)) : def.default;
  }

  static async setPerPage(playerId, list, value) {
    const def = LISTS[list];
    if (!def) throw new GameError('Liste inconnue.');
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < def.min || n > def.max) throw new GameError(`Entre ${def.min} et ${def.max} ${def.noun} par page.`);
    await Player.update({ [def.field]: n }, { where: { id: playerId } });
  }
}

PaginationService.LISTS = LISTS;

module.exports = PaginationService;
