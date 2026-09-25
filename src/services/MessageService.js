'use strict';

const { Op } = require('sequelize');
const { sequelize, Player, Conversation, ConversationParticipant, ConversationMessage } = require('../models');
const GameError = require('./GameError');

const MAX_RECIPIENTS = 10;

function cleanBody(body) {
  const text = String(body || '').trim();
  if (!text) throw new GameError('Le message est vide.');
  if (text.length > 5000) throw new GameError('Message trop long (5 000 caractères maximum).');
  return text;
}

class MessageService {
  /** Nouvelle conversation. `to` : pseudos séparés par des virgules. */
  static async start(playerId, { to, subject, body }, { now = new Date() } = {}) {
    const text = cleanBody(body);
    const title = String(subject || '').trim();
    if (!title || title.length > 100) throw new GameError("L'objet doit faire 1 à 100 caractères.");
    const names = [...new Set(String(to || '').split(',').map((n) => n.trim()).filter(Boolean))];
    if (!names.length) throw new GameError('Indiquez au moins un destinataire.');
    if (names.length > MAX_RECIPIENTS) throw new GameError(`${MAX_RECIPIENTS} destinataires maximum.`);

    return sequelize.transaction(async (t) => {
      const author = await Player.findByPk(playerId, { transaction: t });
      const recipients = await Player.findAll({ where: { worldId: author.worldId, name: { [Op.in]: names } }, transaction: t });
      const missing = names.filter((n) => !recipients.some((r) => r.name === n));
      if (missing.length) throw new GameError(`Joueur introuvable : ${missing.join(', ')}.`);
      const others = recipients.filter((r) => r.id !== author.id);
      if (!others.length) throw new GameError('Vous ne pouvez pas vous écrire à vous-même.');

      const conv = await Conversation.create({ worldId: author.worldId, subject: title, lastMessageAt: now }, { transaction: t });
      await ConversationParticipant.bulkCreate([
        { conversationId: conv.id, playerId: author.id, lastReadAt: now },
        ...others.map((r) => ({ conversationId: conv.id, playerId: r.id, lastReadAt: null })),
      ], { transaction: t });
      await ConversationMessage.create({ conversationId: conv.id, playerId: author.id, body: text, createdAt: now }, { transaction: t });
      return conv;
    });
  }

  static async participant(playerId, conversationId, t) {
    const p = await ConversationParticipant.findOne({ where: { playerId, conversationId: Number(conversationId) }, transaction: t });
    if (!p) throw new GameError('Conversation introuvable.', 404);
    return p;
  }

  static async reply(playerId, conversationId, body, { now = new Date() } = {}) {
    const text = cleanBody(body);
    return sequelize.transaction(async (t) => {
      const me = await MessageService.participant(playerId, conversationId, t);
      const others = await ConversationParticipant.count({ where: { conversationId: me.conversationId, playerId: { [Op.ne]: playerId } }, transaction: t });
      if (!others) throw new GameError('Tous les autres participants ont quitté cette conversation.');
      await ConversationMessage.create({ conversationId: me.conversationId, playerId, body: text, createdAt: now }, { transaction: t });
      await Conversation.update({ lastMessageAt: now }, { where: { id: me.conversationId }, transaction: t });
      await me.update({ lastReadAt: now }, { transaction: t });
    });
  }

  /** Conversations du joueur, les plus récentes d'abord, avec l'indicateur « non lu ». */
  static async inbox(playerId) {
    const rows = await ConversationParticipant.findAll({
      where: { playerId },
      include: [{ model: Conversation, include: [{ association: 'participants', include: [Player] }] }],
      order: [[Conversation, 'lastMessageAt', 'DESC']],
      limit: 100,
    });
    return rows.map((p) => ({
      conversation: p.Conversation,
      unread: !p.lastReadAt || new Date(p.Conversation.lastMessageAt) > new Date(p.lastReadAt),
      others: p.Conversation.participants.filter((x) => x.playerId !== playerId).map((x) => x.Player.name),
    }));
  }

  /** Lecture d'une conversation : la marque comme lue. */
  static async read(playerId, conversationId, { now = new Date() } = {}) {
    const me = await MessageService.participant(playerId, conversationId);
    const conversation = await Conversation.findByPk(me.conversationId, {
      include: [
        { association: 'participants', include: [Player] },
        { association: 'messages', include: [{ association: 'author' }] },
      ],
      order: [[{ model: ConversationMessage, as: 'messages' }, 'createdAt', 'ASC'], [{ model: ConversationMessage, as: 'messages' }, 'id', 'ASC']],
    });
    await me.update({ lastReadAt: now });
    return conversation;
  }

  /** Quitter une conversation ; elle disparaît quand plus personne n'y participe. */
  static async leave(playerId, conversationId) {
    return sequelize.transaction(async (t) => {
      const me = await MessageService.participant(playerId, conversationId, t);
      await me.destroy({ transaction: t });
      const left = await ConversationParticipant.count({ where: { conversationId: me.conversationId }, transaction: t });
      if (!left) await Conversation.destroy({ where: { id: me.conversationId }, transaction: t });
    });
  }

  static async unreadCount(playerId) {
    return ConversationParticipant.count({
      where: {
        playerId,
        [Op.or]: [{ lastReadAt: null }, { lastReadAt: { [Op.lt]: sequelize.col('Conversation.lastMessageAt') } }],
      },
      include: [{ model: Conversation, attributes: [] }],
    });
  }
}

MessageService.MAX_RECIPIENTS = MAX_RECIPIENTS;

module.exports = MessageService;
