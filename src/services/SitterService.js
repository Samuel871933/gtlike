'use strict';

const { Op } = require('sequelize');
const { sequelize, World, Player } = require('../models');
const GameError = require('./GameError');

/**
 * Mode vacances : un joueur désigne un remplaçant du même monde, qui doit accepter.
 * Le remplaçant joue alors les villages du joueur (voir VillageService.assertAccess).
 */
class SitterService {
  static async invite(ownerId, sitterName, { now = new Date() } = {}) {
    return sequelize.transaction(async (t) => {
      const owner = await Player.findByPk(ownerId, { transaction: t, lock: t.LOCK.UPDATE });
      const cfg = (await World.findByPk(owner.worldId, { transaction: t })).getConfig();
      if (!cfg.sitter.allow) throw new GameError("Les remplaçants ne sont pas autorisés sur ce monde.");
      if (owner.sitterId) throw new GameError('Vous avez déjà un remplaçant (ou une demande en attente).');
      const sitter = await Player.findOne({ where: { worldId: owner.worldId, name: String(sitterName || '').trim() }, transaction: t });
      if (!sitter) throw new GameError('Aucun joueur de ce nom sur ce monde.');
      if (sitter.id === owner.id) throw new GameError('Choisissez un autre joueur.');
      await owner.update({ sitterId: sitter.id, sitterAcceptedAt: null }, { transaction: t });
      return sitter;
    });
  }

  /** Le joueur remplacé retire sa demande ou met fin au remplacement. */
  static async revoke(ownerId) {
    const owner = await Player.findByPk(ownerId);
    if (!owner.sitterId) throw new GameError("Vous n'avez pas de remplaçant.");
    await owner.update({ sitterId: null, sitterAcceptedAt: null });
  }

  static async accept(sitterId, ownerId, { now = new Date() } = {}) {
    return sequelize.transaction(async (t) => {
      const sitter = await Player.findByPk(sitterId, { transaction: t, lock: t.LOCK.UPDATE });
      const owner = await Player.findOne({ where: { id: Number(ownerId), sitterId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!owner) throw new GameError('Demande introuvable.', 404);
      if (owner.sitterAcceptedAt) throw new GameError('Vous remplacez déjà ce joueur.');
      if (sitter.sitterId && sitter.sitterAcceptedAt) {
        throw new GameError('Vous ne pouvez pas remplacer quelqu’un pendant que vous êtes vous-même remplacé.');
      }
      const cfg = (await World.findByPk(sitter.worldId, { transaction: t })).getConfig();
      const active = await Player.count({ where: { sitterId, sitterAcceptedAt: { [Op.ne]: null } }, transaction: t });
      if (active >= cfg.sitter.maxAccounts) throw new GameError(`Vous remplacez déjà ${cfg.sitter.maxAccounts} comptes.`);
      await owner.update({ sitterAcceptedAt: now }, { transaction: t });
    });
  }

  /** Le remplaçant refuse la demande ou arrête de remplacer. */
  static async resign(sitterId, ownerId) {
    const owner = await Player.findOne({ where: { id: Number(ownerId), sitterId } });
    if (!owner) throw new GameError('Demande introuvable.', 404);
    await owner.update({ sitterId: null, sitterAcceptedAt: null });
  }

  /** Comptes que le joueur remplace (acceptés) ou qu'on lui demande de remplacer. */
  static async sittingFor(sitterId) {
    return Player.findAll({ where: { sitterId }, order: [['name', 'ASC']] });
  }
}

module.exports = SitterService;
