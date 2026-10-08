'use strict';

const { Op, fn, col } = require('sequelize');
const { Report, ReportFolder, Player } = require('../models');
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

// Conservation, comme sur Guerre Tribale : 100 rapports + 10 par village du joueur dans la boîte ; au-delà, les plus
// anciens sont supprimés (boucle de jeu, toutes les 10 minutes). Les rapports rangés dans un dossier d'archives
// (premium) n'entrent pas dans cette limite : ils sont supprimés après la durée choisie par le joueur.
const KEEP_BASE = 100;
const KEEP_PER_VILLAGE = 10;
const ARCHIVE_MONTHS = { default: 3, min: 1, max: 24 };
const MAX_FOLDERS = 20;

function parseIds(input) {
  const list = Array.isArray(input) ? input : input == null ? [] : [input];
  return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

// Nettoyage des boîtes (boucle de jeu) : dernier identifiant de rapport vu, et dernier passage complet.
const FULL_PRUNE_MS = 6 * 3600000;
const pruneState = { fromId: 0, fullAt: 0 };

class ReportService {
  /** Page de la boîte de rapports ; `perPage` : réglage du joueur (PaginationService). */
  /**
   * `folderId` : dossier d'archives (déjà vérifié, voir folder()), null pour la boîte de réception, ou 'all' pour tout
   * (boîte et archives, le « Tout » de GT).
   */
  static async list(playerId, { filter = 'all', folderId = null, page = 1, perPage = 25 } = {}) {
    const types = FILTERS[filter] === undefined ? null : FILTERS[filter];
    const where = { playerId, ...(folderId === 'all' ? {} : { folderId }), ...(types ? { type: { [Op.in]: types } } : {}) };
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
    // Dans le même dossier (ou la boîte de réception).
    const folderId = report.folderId ?? null;
    const [newer, older] = await Promise.all([
      Report.findOne({
        where: { playerId, folderId, [Op.or]: [{ happenedAt: { [Op.gt]: at } }, { happenedAt: at, id: { [Op.gt]: report.id } }] },
        order: [['happenedAt', 'ASC'], ['id', 'ASC']], attributes: ['id'],
      }),
      Report.findOne({
        where: { playerId, folderId, [Op.or]: [{ happenedAt: { [Op.lt]: at } }, { happenedAt: at, id: { [Op.lt]: report.id } }] },
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

  /** Nombre de rapports gardés pour un joueur qui a `villageCount` villages (110 pour un village). */
  static keepLimit(villageCount) {
    return KEEP_BASE + KEEP_PER_VILLAGE * Math.max(0, villageCount || 0);
  }

  /** Supprime les rapports du joueur au-delà des `limit` plus récents (ordre de la boîte de rapports). */
  static async prune(playerId, limit) {
    const cutoff = await Report.findOne({
      where: { playerId, folderId: null }, attributes: ['id', 'happenedAt'], order: [['happenedAt', 'DESC'], ['id', 'DESC']], offset: limit,
    });
    if (!cutoff) return 0;
    return Report.destroy({
      where: {
        playerId,
        folderId: null,
        [Op.or]: [{ happenedAt: { [Op.lt]: cutoff.happenedAt } }, { happenedAt: cutoff.happenedAt, id: { [Op.lte]: cutoff.id } }],
      },
    });
  }

  /**
   * Boucle de jeu : ramène la boîte de chaque joueur à sa limite et supprime les archives plus anciennes que la durée
   * choisie par leur propriétaire. @returns {Promise<number>} rapports supprimés
   */
  static async pruneAll(now = new Date()) {
    return (await ReportService.pruneInboxes()) + (await ReportService.pruneArchives(now));
  }

  /**
   * Boîtes au-delà de leur limite. Passage incrémental : seuls les joueurs qui ont reçu un rapport depuis le passage
   * précédent (identifiants plus grands que le dernier vu) ; passage complet au démarrage puis toutes les 6 heures
   * (limite abaissée sans nouveau rapport : village perdu).
   */
  static async pruneInboxes({ now = Date.now() } = {}) {
    const full = !pruneState.fromId || now - pruneState.fullAt >= FULL_PRUNE_MS;
    const maxId = (await Report.max('id')) || 0;
    let only = null;
    if (!full) {
      only = (await Report.findAll({ where: { id: { [Op.gt]: pruneState.fromId } }, attributes: ['playerId'], group: ['playerId'], raw: true })).map((r) => r.playerId);
    }
    pruneState.fromId = maxId;
    if (full) pruneState.fullAt = now;
    if (only && !only.length) return 0;
    const counts = await Report.findAll({
      where: { folderId: null, ...(only ? { playerId: { [Op.in]: only } } : {}) },
      attributes: ['playerId', [fn('COUNT', col('id')), 'n']],
      group: ['playerId'],
      having: Report.sequelize.where(fn('COUNT', col('id')), { [Op.gt]: KEEP_BASE }),
      raw: true,
    });
    if (!counts.length) return 0;
    const players = await Player.findAll({ where: { id: counts.map((c) => c.playerId) }, attributes: ['id', 'villageCount'], raw: true });
    const villagesOf = new Map(players.map((p) => [p.id, p.villageCount]));
    let deleted = 0;
    for (const { playerId, n } of counts) {
      const limit = ReportService.keepLimit(villagesOf.get(playerId));
      if (Number(n) > limit) deleted += await ReportService.prune(playerId, limit);
    }
    return deleted;
  }

  /** Archives plus anciennes que la durée choisie (une requête par durée réglée, 24 au plus). */
  static async pruneArchives(now = new Date()) {
    const rows = await Player.findAll({ attributes: ['reportArchiveMonths'], group: ['reportArchiveMonths'], raw: true });
    let deleted = 0;
    for (const { reportArchiveMonths: months } of rows) {
      const before = new Date(now);
      before.setUTCMonth(before.getUTCMonth() - ReportService.archiveMonths({ reportArchiveMonths: months }));
      const owners = Player.sequelize.literal(`(SELECT "id" FROM "Players" WHERE "reportArchiveMonths" = ${Number(months)})`);
      deleted += await Report.destroy({
        where: { folderId: { [Op.ne]: null }, happenedAt: { [Op.lt]: before }, playerId: { [Op.in]: owners } },
      });
    }
    return deleted;
  }

  // ---------------------------------------------------------------- Archives (premium)

  /** Durée de conservation des archives du joueur, en mois. */
  static archiveMonths(player) {
    const n = Math.floor(Number(player && player.reportArchiveMonths));
    return Number.isFinite(n) && n > 0 ? Math.min(ARCHIVE_MONTHS.max, Math.max(ARCHIVE_MONTHS.min, n)) : ARCHIVE_MONTHS.default;
  }

  static async setArchiveMonths(playerId, value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < ARCHIVE_MONTHS.min || n > ARCHIVE_MONTHS.max) {
      throw new GameError(`Entre ${ARCHIVE_MONTHS.min} et ${ARCHIVE_MONTHS.max} mois.`);
    }
    await Player.update({ reportArchiveMonths: n }, { where: { id: playerId } });
  }

  /** Dossiers du joueur, avec leur nombre de rapports et de non lus, par nom. */
  static async folders(playerId) {
    const [folders, counts] = await Promise.all([
      ReportFolder.findAll({ where: { playerId }, order: [['name', 'ASC'], ['id', 'ASC']] }),
      Report.findAll({
        where: { playerId, folderId: { [Op.ne]: null } },
        attributes: ['folderId', 'isRead', [fn('COUNT', col('id')), 'n']], group: ['folderId', 'isRead'], raw: true,
      }),
    ]);
    const total = new Map();
    const unread = new Map();
    for (const c of counts) {
      total.set(c.folderId, (total.get(c.folderId) || 0) + Number(c.n));
      if (!c.isRead) unread.set(c.folderId, Number(c.n));
    }
    return folders.map((f) => ({ folder: f, total: total.get(f.id) || 0, unread: unread.get(f.id) || 0 }));
  }

  static async folder(playerId, folderId) {
    const folder = await ReportFolder.findOne({ where: { id: Number(folderId), playerId } });
    if (!folder) throw new GameError('Dossier introuvable.', 404);
    return folder;
  }

  static cleanFolderName(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (clean.length < 1 || clean.length > 32) throw new GameError('Le nom du dossier doit faire 1 à 32 caractères.');
    return clean;
  }

  /** Nouveau dossier : réservé au premium, comme sur Guerre Tribale. */
  static async createFolder(playerId, name, { premium }) {
    if (!premium) throw new GameError('Les dossiers d’archives sont réservés au premium.');
    const clean = ReportService.cleanFolderName(name);
    if (await ReportFolder.count({ where: { playerId } }) >= MAX_FOLDERS) throw new GameError(`${MAX_FOLDERS} dossiers au plus.`);
    return ReportFolder.create({ playerId, name: clean });
  }

  static async renameFolder(playerId, folderId, name) {
    const folder = await ReportService.folder(playerId, folderId);
    await folder.update({ name: ReportService.cleanFolderName(name) });
    return folder;
  }

  /** Supprime un dossier : ses rapports reviennent dans la boîte de réception (et dans sa limite). */
  static async deleteFolder(playerId, folderId) {
    const folder = await ReportService.folder(playerId, folderId);
    await Report.update({ folderId: null }, { where: { playerId, folderId: folder.id } });
    await folder.destroy();
  }

  /**
   * Range des rapports dans un dossier (premium) ou les remet dans la boîte de réception (`folderId` vide, toujours
   * possible, même après la fin du premium). Renvoie le nombre déplacé.
   */
  static async move(playerId, ids, folderId, { premium }) {
    const list = parseIds(ids);
    if (!list.length) throw new GameError('Aucun rapport sélectionné.');
    let target = null;
    if (folderId) {
      if (!premium) throw new GameError('Archiver des rapports est réservé au premium.');
      target = (await ReportService.folder(playerId, folderId)).id;
    }
    const [n] = await Report.update({ folderId: target }, { where: { playerId, id: { [Op.in]: list } } });
    return n;
  }

  static async markAllRead(playerId) {
    const [n] = await Report.update({ isRead: true }, { where: { playerId, isRead: false } });
    return n;
  }
}

ReportService.FILTERS = Object.keys(FILTERS);
ReportService.ARCHIVE_MONTHS = ARCHIVE_MONTHS;
ReportService.MAX_FOLDERS = MAX_FOLDERS;

module.exports = ReportService;
