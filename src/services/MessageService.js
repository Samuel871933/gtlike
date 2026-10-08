'use strict';

const { Op } = require('sequelize');
const { sequelize, Player, Conversation, ConversationParticipant, ConversationMessage } = require('../models');
const GameError = require('./GameError');
const { paginate } = require('./PaginationService');
const tribeRights = require('../game/tribeRights');

const MAX_RECIPIENTS = 10;

/**
 * Destinataires groupés de la tribu (menu « Tribu » du champ À, comme sur GT). « Tribu entière » est le courrier
 * circulaire et demande ce droit ; les autres groupes permettent à tout membre d'écrire aux ducs, barons ou diplomates.
 */
const GROUPS = {
  tribe: { name: 'Tribu entière', right: 'massMail', match: () => true },
  duke: { name: 'Duc', match: (p) => p.tribeRole === 'duke' },
  baron: { name: 'Baron', match: (p) => p.tribeRole === 'baron' },
  diplomacy: { name: 'Diplomatie', match: (p) => p.tribeRole === 'member' && tribeRights.has(p, 'diplomacy') },
};

function cleanBody(body) {
  const text = String(body || '').trim();
  if (!text) throw new GameError('Le message est vide.');
  if (text.length > 5000) throw new GameError('Message trop long (5 000 caractères maximum).');
  return text;
}

class MessageService {
  /** Groupes de la tribu du menu « Tribu », avec `blocker` quand le joueur ne peut pas y écrire (sans tribu, sans droit). */
  static groupsFor(player) {
    return Object.entries(GROUPS).map(([id, g]) => ({
      id,
      name: g.name,
      blocker: !player.tribeId ? "Vous n'êtes dans aucune tribu."
        : g.right && !tribeRights.has(player, g.right) ? 'Il faut le droit de courrier circulaire.' : null,
    }));
  }

  /**
   * Nouvelle conversation. `to` : pseudos séparés par des virgules ; ou `group` (tribe | duke | baron | diplomacy) :
   * tous les membres de la tribu de ce groupe, sans limite de nombre (courrier circulaire). `supportRequest` : demande
   * de soutien envoyée à la tribu depuis les attaques entrantes, permise sans le droit de courrier circulaire.
   */
  static async start(playerId, { to, group, subject, body }, { now = new Date(), supportRequest = false } = {}) {
    const text = cleanBody(body);
    const title = String(subject || '').trim();
    if (!title || title.length > 100) throw new GameError("L'objet doit faire 1 à 100 caractères.");
    const groupId = String(group || '').trim() || null;
    if (groupId && !GROUPS[groupId]) throw new GameError('Groupe de destinataires inconnu.');
    const names = [...new Set(String(to || '').split(',').map((n) => n.trim()).filter(Boolean))];
    if (!groupId && !names.length) throw new GameError('Indiquez au moins un destinataire.');
    if (!groupId && names.length > MAX_RECIPIENTS) throw new GameError(`${MAX_RECIPIENTS} destinataires maximum.`);

    return sequelize.transaction(async (t) => {
      const author = await Player.findByPk(playerId, { transaction: t });
      let others;
      if (groupId) {
        if (!author.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.");
        const g = GROUPS[groupId];
        // Demande de soutien (aperçu Arrivant) : toute la tribu, même sans le droit de courrier circulaire.
        if (g.right && !supportRequest && !tribeRights.has(author, g.right)) throw new GameError('Il faut le droit de courrier circulaire.', 403);
        const members = await Player.findAll({ where: { tribeId: author.tribeId, id: { [Op.ne]: author.id } }, transaction: t });
        others = members.filter(g.match);
        if (!others.length) throw new GameError(`Aucun autre membre de la tribu dans le groupe « ${g.name} ».`);
      } else {
        const recipients = await Player.findAll({ where: { worldId: author.worldId, name: { [Op.in]: names } }, transaction: t });
        const missing = names.filter((n) => !recipients.some((r) => r.name === n));
        if (missing.length) throw new GameError(`Joueur introuvable : ${missing.join(', ')}.`);
        const bots = recipients.filter((r) => r.isBot);
        if (bots.length) throw new GameError(`${bots.map((r) => r.name).join(', ')} : les bots ne lisent pas les messages.`);
        others = recipients.filter((r) => r.id !== author.id);
        if (!others.length) throw new GameError('Vous ne pouvez pas vous écrire à vous-même.');
      }

      const conv = await Conversation.create({
        worldId: author.worldId, subject: title, lastMessageAt: now, authorId: author.id, recipientGroup: groupId,
      }, { transaction: t });
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

  /**
   * Boîte de réception paginée, les plus récentes d'abord : non-lu, autres participants, auteur, nombre de messages.
   * `search` filtre sur l'objet et le texte des messages.
   */
  static async inbox(playerId, { page = 1, perPage = 12, search = '' } = {}) {
    const where = { playerId };
    const q = String(search || '').trim().toLowerCase().slice(0, 100);
    if (q) {
      const like = `%${q}%`;
      // Recherche limitée aux conversations du joueur : sinon elle parcourt tous les messages du serveur.
      const mine = (await ConversationParticipant.findAll({ where: { playerId }, attributes: ['conversationId'], raw: true })).map((r) => r.conversationId);
      const [inBody, bySubject] = mine.length ? await Promise.all([
        ConversationMessage.findAll({
          attributes: ['conversationId'],
          where: { conversationId: { [Op.in]: mine }, [Op.and]: [sequelize.where(sequelize.fn('lower', sequelize.col('body')), { [Op.like]: like })] },
          raw: true,
        }),
        Conversation.findAll({
          attributes: ['id'],
          where: { id: { [Op.in]: mine }, [Op.and]: [sequelize.where(sequelize.fn('lower', sequelize.col('subject')), { [Op.like]: like })] },
          raw: true,
        }),
      ]) : [[], []];
      where.conversationId = { [Op.in]: [...new Set([...inBody.map((r) => r.conversationId), ...bySubject.map((r) => r.id)])] };
    }
    const total = await ConversationParticipant.count({ where });
    const pg = paginate(total, page, perPage);
    const rows = await ConversationParticipant.findAll({
      where,
      include: [{ model: Conversation, include: [{ association: 'participants', include: [Player] }] }],
      order: [[Conversation, 'lastMessageAt', 'DESC'], [Conversation, 'id', 'DESC']],
      limit: pg.perPage,
      offset: pg.offset,
    });
    const counts = await MessageService.messageCounts(rows.map((p) => p.conversationId));
    return {
      page: pg.page, pages: pg.pages, total, search: q,
      rows: rows.map((p) => MessageService.summary(p.Conversation, playerId, {
        unread: !p.lastReadAt || new Date(p.Conversation.lastMessageAt) > new Date(p.lastReadAt),
        count: counts.get(p.conversationId) || 0,
      })),
    };
  }

  /** Courriers circulaires (envois à un groupe de la tribu) lancés par le joueur, les plus récents d'abord. */
  static async circulars(playerId) {
    const conversations = await Conversation.findAll({
      where: { authorId: playerId, recipientGroup: { [Op.ne]: null } },
      include: [{ association: 'participants', include: [Player] }],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: 200,
    });
    const counts = await MessageService.messageCounts(conversations.map((c) => c.id));
    return conversations.map((c) => MessageService.summary(c, playerId, { count: counts.get(c.id) || 0 }));
  }

  static async messageCounts(ids) {
    if (!ids.length) return new Map();
    const rows = await ConversationMessage.findAll({
      attributes: ['conversationId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
      where: { conversationId: { [Op.in]: ids } },
      group: ['conversationId'],
      raw: true,
    });
    return new Map(rows.map((r) => [r.conversationId, Number(r.n)]));
  }

  static summary(conversation, playerId, extra) {
    const others = conversation.participants.filter((x) => x.playerId !== playerId).map((x) => x.Player);
    const author = conversation.participants.find((x) => x.playerId === conversation.authorId);
    return {
      conversation,
      others,
      author: author ? author.Player : null,
      group: conversation.recipientGroup ? GROUPS[conversation.recipientGroup]?.name || null : null,
      ...extra,
    };
  }

  /** Lecture paginée : page 1 = derniers messages, affichés dans l'ordre chronologique. */
  static async read(playerId, conversationId, { now = new Date(), limit = MessageService.READ_LIMIT, page = 1 } = {}) {
    const me = await MessageService.participant(playerId, conversationId);
    const where = { conversationId: me.conversationId };
    const total = await ConversationMessage.count({ where });
    const pagination = paginate(total, page, limit || Math.max(1, total));
    const [conversation, latest] = await Promise.all([
      Conversation.findByPk(me.conversationId, { include: [{ association: 'participants', include: [Player] }] }),
      ConversationMessage.findAll({
        where, include: [{ association: 'author' }], order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: pagination.perPage, offset: pagination.offset,
      }),
    ]);
    conversation.messages = latest.reverse();
    conversation.pagination = pagination;
    conversation.olderCount = Math.max(0, total - pagination.offset - latest.length);
    await me.update({ lastReadAt: now });
    return conversation;
  }

  /** Quitter une conversation ; elle disparaît quand plus personne n'y participe. */
  static async leave(playerId, conversationId) {
    return MessageService.leaveMany(playerId, [conversationId]);
  }

  /** Quitter plusieurs conversations d'un coup (bouton « Effacer » de la boîte de réception). */
  static async leaveMany(playerId, conversationIds) {
    const ids = [...new Set([].concat(conversationIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) throw new GameError('Aucun message sélectionné.');
    return sequelize.transaction(async (t) => {
      const mine = await ConversationParticipant.findAll({ where: { playerId, conversationId: { [Op.in]: ids } }, transaction: t });
      if (!mine.length) throw new GameError('Conversation introuvable.', 404);
      for (const me of mine) {
        await me.destroy({ transaction: t });
        const left = await ConversationParticipant.count({ where: { conversationId: me.conversationId }, transaction: t });
        if (!left) await Conversation.destroy({ where: { id: me.conversationId }, transaction: t });
      }
      return mine.length;
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
MessageService.GROUPS = GROUPS;

// Messages affichés à l'ouverture d'une conversation (les plus récents) ; les autres sur demande.
MessageService.READ_LIMIT = 50;

module.exports = MessageService;
