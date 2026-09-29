'use strict';

const { Op } = require('sequelize');
const { Player, VillageNote } = require('../models');

/**
 * Notes de village visibles par un joueur : les siennes, et celles des membres de sa tribu qui partagent leurs notes
 * quand il a choisi de les afficher (réglages tribu du compte).
 */
class VillageNoteService {
  /** Map villageId → [{ mine, author, text }] (sa note d'abord), pour les villages demandés. */
  static async visible(viewer, villageIds) {
    const byVillage = new Map();
    if (!villageIds.length) return byVillage;
    let authors = [viewer.id];
    if (viewer.tribeId && viewer.showTribeNotes) {
      const sharing = await Player.findAll({
        where: { tribeId: viewer.tribeId, shareVillageNotes: true, id: { [Op.ne]: viewer.id } }, attributes: ['id'], raw: true,
      });
      authors = authors.concat(sharing.map((p) => p.id));
    }
    const notes = await VillageNote.findAll({
      where: { villageId: villageIds, playerId: authors },
      include: [{ model: Player, attributes: ['id', 'name'] }],
      order: [['updatedAt', 'DESC']],
    });
    for (const n of notes) {
      const list = byVillage.get(n.villageId) || [];
      const entry = { mine: n.playerId === viewer.id, author: n.Player ? n.Player.name : '', authorId: n.playerId, text: n.text, updatedAt: n.updatedAt };
      if (entry.mine) list.unshift(entry); else list.push(entry);
      byVillage.set(n.villageId, list);
    }
    return byVillage;
  }

  /** Enregistre les réglages tribu du joueur : `values` { colonne: vrai/faux } pour les colonnes de TRIBE_SHARING. */
  static async setTribeSettings(playerId, values) {
    const patch = {};
    for (const item of TRIBE_SHARING) for (const col of [item.share, item.show]) patch[col] = Boolean(values[col]);
    await Player.update(patch, { where: { id: playerId } });
  }
}

/**
 * Réglages tribu du compte (tableau « Partager avec la tribu » / « Afficher la tribu ») : un élément par ligne, avec
 * les colonnes de Player qui le règlent. Ajouter un élément partageable = une entrée ici (et ses deux colonnes).
 */
const TRIBE_SHARING = [
  {
    id: 'villageNotes', label: 'Notes de village', share: 'shareVillageNotes', show: 'showTribeNotes',
    text: "Sur la carte (icône et infobulle) et dans l'aperçu du village.",
  },
  {
    id: 'tribeOrders', label: 'Ordres de troupes', share: 'shareTribeOrders', show: 'showTribeOrders',
    text: 'Afficher sur la carte les ordres envoyés vers chaque village et leurs heures d’arrivée.',
  },
];

VillageNoteService.TRIBE_SHARING = TRIBE_SHARING;

module.exports = VillageNoteService;
