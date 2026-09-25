'use strict';

const { Op } = require('sequelize');
const { sequelize, ForumThread, ForumPost, User } = require('../models');
const GameError = require('./GameError');

// Sections du forum communautaire (commun à tous les mondes).
const SECTIONS = [
  { id: 'general', name: 'Taverne', description: 'Discussions générales entre joueurs de tous les mondes.' },
  { id: 'strategy', name: 'Stratégie', description: 'Conseils, développement, attaque et défense.' },
  { id: 'tribes', name: 'Tribus', description: 'Présentation et recrutement des tribus.' },
  { id: 'suggestions', name: 'Suggestions', description: 'Idées pour améliorer le jeu.' },
  { id: 'bugs', name: 'Bugs', description: 'Signaler une erreur du jeu (sans l’exploiter).' },
];
const PAGE_SIZE = 20;
const TITLE_MAX = 80;
const BODY_MAX = 5000;
// Anti-flood : délai minimal entre deux messages d'un même compte.
const FLOOD_SECONDS = 15;

const section = (id) => SECTIONS.find((s) => s.id === id) || null;
// Fonction et non objet partagé : Sequelize modifie les `include` qu'on lui passe.
const authorOf = () => ({ model: User, as: 'author', attributes: ['id', 'username'] });

function cleanBody(text) {
  const body = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new GameError('Le message est vide.');
  if (body.length > BODY_MAX) throw new GameError(`${BODY_MAX} caractères au maximum.`);
  return body;
}

async function assertNotFlooding(userId, now) {
  const recent = await ForumPost.count({ where: { userId, createdAt: { [Op.gt]: new Date(now - FLOOD_SECONDS * 1000) } } });
  if (recent) throw new GameError(`Patiente ${FLOOD_SECONDS} secondes entre deux messages.`);
}

const pageOf = (page, count) => {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return { page: Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1)), pages };
};

class ForumService {
  /** Accueil du forum : chaque section avec son nombre de sujets et son dernier sujet actif. */
  static async sections() {
    return Promise.all(SECTIONS.map(async (s) => ({
      ...s,
      threads: await ForumThread.count({ where: { section: s.id } }),
      last: await ForumThread.findOne({ where: { section: s.id }, order: [['lastPostAt', 'DESC']], include: [{ model: ForumPost, as: 'lastPost', include: [authorOf()] }] }),
    })));
  }

  /** Sujets d'une section, du plus récemment actif au plus ancien. */
  static async threads(sectionId, page = 1) {
    const s = section(sectionId);
    if (!s) throw new GameError('Section introuvable.', 404);
    const count = await ForumThread.count({ where: { section: s.id } });
    const p = pageOf(page, count);
    const rows = await ForumThread.findAll({
      where: { section: s.id },
      include: [authorOf(), { model: ForumPost, as: 'lastPost', include: [authorOf()] }],
      order: [['lastPostAt', 'DESC'], ['id', 'DESC']],
      limit: PAGE_SIZE,
      offset: (p.page - 1) * PAGE_SIZE,
    });
    return { section: s, threads: rows, ...p, total: count };
  }

  /** Un sujet et une page de ses messages. `page: 'last'` ouvre la dernière page. */
  static async thread(threadId, page = 1) {
    const thread = await ForumThread.findByPk(Number(threadId), { include: [authorOf()] });
    if (!thread) throw new GameError('Sujet introuvable.', 404);
    const count = await ForumPost.count({ where: { threadId: thread.id } });
    const p = pageOf(page === 'last' ? Infinity : page, count);
    const posts = await ForumPost.findAll({
      where: { threadId: thread.id },
      include: [authorOf()],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit: PAGE_SIZE,
      offset: (p.page - 1) * PAGE_SIZE,
    });
    const first = await ForumPost.findOne({ where: { threadId: thread.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']], attributes: ['id'] });
    return { thread, section: section(thread.section), posts, firstPostId: first && first.id, ...p, total: count };
  }

  static async createThread(userId, sectionId, { title, body }, now = new Date()) {
    const s = section(sectionId);
    if (!s) throw new GameError('Section introuvable.', 404);
    const name = String(title || '').replace(/\s+/g, ' ').trim();
    if (name.length < 3) throw new GameError('Le titre doit faire au moins 3 caractères.');
    if (name.length > TITLE_MAX) throw new GameError(`Titre : ${TITLE_MAX} caractères au maximum.`);
    const text = cleanBody(body);
    await assertNotFlooding(userId, now);
    return sequelize.transaction(async (t) => {
      const thread = await ForumThread.create({ section: s.id, title: name, userId, postCount: 1, lastPostAt: now }, { transaction: t });
      const post = await ForumPost.create({ threadId: thread.id, userId, body: text, createdAt: now, updatedAt: now }, { transaction: t });
      await thread.update({ lastPostId: post.id }, { transaction: t });
      return thread;
    });
  }

  static async reply(userId, threadId, { body }, now = new Date()) {
    const thread = await ForumThread.findByPk(Number(threadId));
    if (!thread) throw new GameError('Sujet introuvable.', 404);
    const text = cleanBody(body);
    await assertNotFlooding(userId, now);
    return sequelize.transaction(async (t) => {
      const post = await ForumPost.create({ threadId: thread.id, userId, body: text, createdAt: now, updatedAt: now }, { transaction: t });
      await thread.update({ postCount: thread.postCount + 1, lastPostAt: now, lastPostId: post.id }, { transaction: t });
      return post;
    });
  }

  /** Modifier son propre message. */
  static async edit(userId, postId, { body }, now = new Date()) {
    const post = await ForumPost.findByPk(Number(postId));
    if (!post || post.userId !== userId) throw new GameError('Tu ne peux modifier que tes propres messages.', 403);
    await post.update({ body: cleanBody(body), editedAt: now });
    return post;
  }

  /**
   * Supprimer son propre message. Le premier message d'un sujet ne se supprime qu'avec le sujet entier, et
   * seulement tant que personne n'y a répondu. Renvoie { threadDeleted, thread }.
   */
  static async remove(userId, postId) {
    const post = await ForumPost.findByPk(Number(postId));
    if (!post || post.userId !== userId) throw new GameError('Tu ne peux supprimer que tes propres messages.', 403);
    const thread = await ForumThread.findByPk(post.threadId);
    const first = await ForumPost.findOne({ where: { threadId: thread.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
    return sequelize.transaction(async (t) => {
      if (first.id === post.id) {
        if (thread.postCount > 1) throw new GameError('Ce sujet a des réponses : son premier message ne peut plus être supprimé.');
        await ForumPost.destroy({ where: { threadId: thread.id }, transaction: t });
        await thread.destroy({ transaction: t });
        return { threadDeleted: true, thread };
      }
      await post.destroy({ transaction: t });
      const last = await ForumPost.findOne({ where: { threadId: thread.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']], transaction: t });
      await thread.update({ postCount: thread.postCount - 1, lastPostAt: last.createdAt, lastPostId: last.id }, { transaction: t });
      return { threadDeleted: false, thread };
    });
  }
}

Object.assign(ForumService, { SECTIONS, PAGE_SIZE, TITLE_MAX, BODY_MAX, FLOOD_SECONDS });

module.exports = ForumService;
