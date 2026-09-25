'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize, User, World, Player, Village, BuildOrder, RecruitOrder, ResearchOrder, Command, SupportStack,
  Transport, MarketOffer, Report, TribeInvite, ConversationParticipant, Conversation, ScavengeRun, ArmyTemplate, MapFavorite, PasswordReset, ForumThread, ForumPost,
  TribeForumThread, TribeForumPost, TribeForumRead, TribeForumMute, TribeForumVote,
} = require('../models');
const GameError = require('./GameError');

const HOUR = 3600000;

/** Réglages du compte sur un monde : mode sommeil (et remplaçant, voir SitterService). */
class AccountService {
  static async world(player, t) {
    return (await World.findByPk(player.worldId, { transaction: t })).getConfig();
  }

  /**
   * Programme un sommeil de `hours` heures, qui commence après le délai du monde.
   * Il faut être resté éveillé assez longtemps depuis le sommeil précédent.
   */
  static async startSleep(playerId, hours, { now = new Date() } = {}) {
    return sequelize.transaction(async (t) => {
      const player = await Player.findByPk(playerId, { transaction: t, lock: t.LOCK.UPDATE });
      const { sleep } = await AccountService.world(player, t);
      if (!sleep.active) throw new GameError("Le mode sommeil n'existe pas sur ce monde.");
      const h = Number(hours);
      if (!Number.isFinite(h) || h < sleep.minHours || h > sleep.maxHours) {
        throw new GameError(`Durée entre ${sleep.minHours} et ${sleep.maxHours} heures.`);
      }
      if (player.sleepEndsAt && new Date(player.sleepEndsAt) > now) throw new GameError('Un sommeil est déjà programmé.');
      const start = new Date(now.getTime() + sleep.delayMinutes * 60000);
      if (player.sleepEndsAt) {
        const awakeUntil = new Date(new Date(player.sleepEndsAt).getTime() + sleep.minAwakeHours * HOUR);
        if (start < awakeUntil) throw new GameError(`Vous devez rester éveillé jusqu'au ${awakeUntil.toLocaleString('fr-FR')}.`);
      }
      await player.update({ sleepStartsAt: start, sleepEndsAt: new Date(start.getTime() + h * HOUR) }, { transaction: t });
      return player;
    });
  }

  /** Annule un sommeil programmé, ou y met fin s'il a commencé. */
  static async stopSleep(playerId, { now = new Date() } = {}) {
    const player = await Player.findByPk(playerId);
    if (!player.sleepEndsAt || new Date(player.sleepEndsAt) <= now) throw new GameError('Aucun sommeil en cours.');
    if (new Date(player.sleepStartsAt) > now) await player.update({ sleepStartsAt: null, sleepEndsAt: null });
    else await player.update({ sleepEndsAt: now });
  }
}


async function checkPassword(userId, password) {
  const user = await User.findByPk(userId);
  if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
    throw new GameError('Mot de passe incorrect.', 401);
  }
  return user;
}

/**
 * Retire un joueur d'un monde : ses villages redeviennent barbares (avec leurs troupes),
 * ses files, troupes et marchands à l'extérieur, offres, rapports et invitations disparaissent,
 * la tribu passe à un autre membre (ou est dissoute), puis le joueur est supprimé.
 */
AccountService.removePlayer = async function removePlayer(playerId, t) {
  const player = await Player.findByPk(playerId, { transaction: t });
  if (!player) return;
  const villages = await Village.findAll({ where: { playerId }, attributes: ['id'], transaction: t });
  const ids = villages.map((v) => v.id);
  if (ids.length) {
    const byVillage = { villageId: { [Op.in]: ids } };
    const byOrigin = { originVillageId: { [Op.in]: ids } };
    await BuildOrder.destroy({ where: byVillage, transaction: t });
    await RecruitOrder.destroy({ where: byVillage, transaction: t });
    await ResearchOrder.destroy({ where: byVillage, transaction: t });
    await MarketOffer.destroy({ where: byVillage, transaction: t });
    await Command.destroy({ where: byOrigin, transaction: t });
    await SupportStack.destroy({ where: byOrigin, transaction: t });
    await Transport.destroy({ where: byOrigin, transaction: t });
    await ScavengeRun.destroy({ where: byVillage, transaction: t });
    await Village.update(
      { playerId: null, name: 'Village barbare', loyalty: 100, grownAt: new Date() },
      { where: { id: { [Op.in]: ids } }, transaction: t },
    );
  }

  if (player.tribeId) {
    const others = await Player.findAll({
      where: { tribeId: player.tribeId, id: { [Op.ne]: player.id } }, order: [['points', 'DESC']], transaction: t,
    });
    if (!others.length) {
      await require('./TribeService').dissolve(player.tribeId, t);
    } else if (player.tribeRole === 'founder') {
      const heir = others.find((o) => o.tribeRole === 'leader') || others[0];
      await heir.update({ tribeRole: 'founder' }, { transaction: t });
    }
  }

  await Player.update({ sitterId: null, sitterAcceptedAt: null }, { where: { sitterId: player.id }, transaction: t });
  await TribeInvite.destroy({ where: { playerId }, transaction: t });
  await Report.destroy({ where: { playerId }, transaction: t });
  await ArmyTemplate.destroy({ where: { playerId }, transaction: t });
  await MapFavorite.destroy({ where: { playerId }, transaction: t });
  // Forum de tribu : les messages restent, sans auteur.
  await TribeForumRead.destroy({ where: { playerId }, transaction: t });
  await TribeForumMute.destroy({ where: { playerId }, transaction: t });
  await TribeForumVote.destroy({ where: { playerId }, transaction: t });
  await TribeForumPost.update({ playerId: null }, { where: { playerId }, transaction: t });
  await TribeForumThread.update({ playerId: null }, { where: { playerId }, transaction: t });
  const convs = await ConversationParticipant.findAll({ where: { playerId }, attributes: ['conversationId'], transaction: t });
  await ConversationParticipant.destroy({ where: { playerId }, transaction: t });
  for (const { conversationId } of convs) {
    if (!(await ConversationParticipant.count({ where: { conversationId }, transaction: t }))) {
      await Conversation.destroy({ where: { id: conversationId }, transaction: t });
    }
  }
  await player.destroy({ transaction: t });
};

/** Quitter un monde (mot de passe requis). */
AccountService.leaveWorld = async function leaveWorld(userId, playerId, password) {
  await checkPassword(userId, password);
  const player = await Player.findOne({ where: { id: playerId, userId } });
  if (!player) throw new GameError('Joueur introuvable.', 404);
  await sequelize.transaction((t) => AccountService.removePlayer(player.id, t));
};

/** Supprimer le compte : le joueur quitte tous ses mondes, puis le compte est supprimé. */
AccountService.deleteAccount = async function deleteAccount(userId, password) {
  const user = await checkPassword(userId, password);
  await sequelize.transaction(async (t) => {
    const players = await Player.findAll({ where: { userId }, attributes: ['id'], transaction: t });
    for (const p of players) await AccountService.removePlayer(p.id, t);
    await PasswordReset.destroy({ where: { userId }, transaction: t });
    // Le forum garde ses messages, signés « Compte supprimé ».
    await ForumPost.update({ userId: null }, { where: { userId }, transaction: t });
    await ForumThread.update({ userId: null }, { where: { userId }, transaction: t });
    await user.destroy({ transaction: t });
  });
};

module.exports = AccountService;
