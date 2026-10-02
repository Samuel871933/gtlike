'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Player, TribeForumSection, TribeForumThread, TribeForumPost, TribeForumRead, TribeForumMute, TribeForumPoll, TribeForumVote,
} = require('../models');
const GameError = require('./GameError');
const { paginate } = require('./PaginationService');
const TribeService = require('./TribeService');

// Forum interne d'une tribu (comme sur Guerre Tribale) : réservé à ses membres.
const PAGE_SIZE = 20;
const TITLE_MAX = 80;
const BODY_MAX = 5000;
const SECTION_MAX = 40;
const MAX_SECTIONS = 20;
const FLOOD_SECONDS = 10;
const RECENT_PAGE = 5;
const POLL_MIN = 2;
const POLL_MAX = 10;
const OPTION_MAX = 80;
// Sous-forums créés avec chaque tribu (les chefs peuvent ensuite les renommer, réordonner ou supprimer).
const DEFAULT_SECTIONS = ['Annonces', 'Attaque', 'Défense', 'Taverne', 'Vacances', 'Suggestions'];

// Fonction et non objet partagé : Sequelize modifie les `include` qu'on lui passe.
const authorOf = () => ({ model: Player, as: 'author', attributes: ['id', 'name'] });

function cleanBody(text) {
  const body = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new GameError('Le message est vide.');
  if (body.length > BODY_MAX) throw new GameError(`${BODY_MAX} caractères au maximum.`);
  return body;
}

function cleanName(text, min, max, label) {
  const name = String(text || '').replace(/\s+/g, ' ').trim();
  if (name.length < min) throw new GameError(`${label} : ${min} caractère${min > 1 ? 's' : ''} minimum.`);
  if (name.length > max) throw new GameError(`${label} : ${max} caractères au maximum.`);
  return name;
}

const pageOf = (page, count) => paginate(count, page, PAGE_SIZE);

/** Joueur membre d'une tribu (sinon erreur), avec son droit de modérateur du forum. */
async function memberOf(playerId) {
  const player = await Player.findByPk(playerId);
  if (!player || !player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.", 403);
  return { player, manager: TribeService.can(player, 'forumMod') };
}

/** Modérateur du forum (droit forumMod, ou duc ou baron), sinon erreur. */
async function managerOf(playerId) {
  const { player, manager } = await memberOf(playerId);
  if (!manager) throw new GameError('Il faut le droit de modérateur du forum.', 403);
  return player;
}

async function sectionOf(player, sectionId) {
  const section = await TribeForumSection.findByPk(Number(sectionId));
  if (!section || section.tribeId !== player.tribeId) throw new GameError('Sous-forum introuvable.', 404);
  return section;
}

async function threadOf(player, threadId) {
  const thread = await TribeForumThread.findByPk(Number(threadId), { include: [{ model: TribeForumSection, as: 'section' }, authorOf()] });
  if (!thread || thread.section.tribeId !== player.tribeId) throw new GameError('Sujet introuvable.', 404);
  return thread;
}

async function assertNotFlooding(playerId, now) {
  const recent = await TribeForumPost.count({ where: { playerId, createdAt: { [Op.gt]: new Date(now - FLOOD_SECONDS * 1000) } } });
  if (recent) throw new GameError(`Patiente ${FLOOD_SECONDS} secondes entre deux messages.`);
}

async function markRead(playerId, threadId, now, t) {
  const read = await TribeForumRead.findOne({ where: { playerId, threadId }, transaction: t });
  if (read) await read.update({ readAt: now }, { transaction: t });
  else await TribeForumRead.create({ playerId, threadId, readAt: now }, { transaction: t });
}

/** Sujets non lus parmi `threads` : jamais ouverts ou avec un message plus récent que la dernière lecture. */
async function unreadIds(playerId, threads) {
  if (!threads.length) return new Set();
  const reads = await TribeForumRead.findAll({ where: { playerId, threadId: { [Op.in]: threads.map((t) => t.id) } } });
  const at = new Map(reads.map((r) => [r.threadId, r.readAt]));
  return new Set(threads.filter((t) => !at.has(t.id) || at.get(t.id) < t.lastPostAt).map((t) => t.id));
}

/** Sondages (et leurs votes) des sujets donnés. */
async function destroyPolls(threadIds, t) {
  if (!threadIds.length) return;
  const polls = await TribeForumPoll.findAll({ where: { threadId: { [Op.in]: threadIds } }, attributes: ['id'], transaction: t });
  await TribeForumVote.destroy({ where: { pollId: { [Op.in]: polls.map((x) => x.id) } }, transaction: t });
  await TribeForumPoll.destroy({ where: { threadId: { [Op.in]: threadIds } }, transaction: t });
}

async function mutedIds(playerId) {
  return new Set((await TribeForumMute.findAll({ where: { playerId }, attributes: ['sectionId'] })).map((m) => m.sectionId));
}

async function tribeSections(tribeId) {
  return TribeForumSection.findAll({ where: { tribeId }, order: [['position', 'ASC'], ['id', 'ASC']] });
}

/** Sujets de la tribu, au besoin hors sous-forums en sourdine. */
async function tribeThreads(tribeId, exclude = new Set()) {
  return TribeForumThread.findAll({
    attributes: ['id', 'sectionId', 'title', 'lastPostAt', 'lastPostId', 'postCount'],
    include: [{ model: TribeForumSection, as: 'section', attributes: ['id', 'name'], where: { tribeId } }],
    order: [['lastPostAt', 'DESC'], ['id', 'DESC']],
  }).then((rows) => rows.filter((t) => !exclude.has(t.sectionId)));
}

/** Réponses d'un sondage : 2 à 10 lignes non vides et distinctes. */
function cleanOptions(input) {
  const list = (Array.isArray(input) ? input : String(input || '').split('\n')).map((o) => String(o).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const unique = [...new Set(list)];
  if (unique.length < POLL_MIN) throw new GameError(`Un sondage demande au moins ${POLL_MIN} réponses différentes.`);
  if (unique.length > POLL_MAX) throw new GameError(`${POLL_MAX} réponses au maximum.`);
  if (unique.some((o) => o.length > OPTION_MAX)) throw new GameError(`Une réponse fait ${OPTION_MAX} caractères au maximum.`);
  return unique;
}

class TribeForumService {
  /** Accueil du forum : sous-forums (le premier est créé au besoin), sujets, non lus et dernier sujet actif. */
  static async overview(playerId) {
    const { player, manager } = await memberOf(playerId);
    let sections = await TribeForumSection.findAll({ where: { tribeId: player.tribeId }, order: [['position', 'ASC'], ['id', 'ASC']] });
    // Tribu fondée avant le forum : elle reçoit les sous-forums par défaut à la première visite.
    if (!sections.length) sections = await TribeForumService.createDefaults(player.tribeId);
    const threads = await TribeForumThread.findAll({
      where: { sectionId: { [Op.in]: sections.map((s) => s.id) } },
      attributes: ['id', 'sectionId', 'title', 'lastPostAt', 'lastPostId'],
      include: [{ model: TribeForumPost, as: 'lastPost', attributes: ['id'], include: [authorOf()] }],
      order: [['lastPostAt', 'DESC']],
    });
    const unread = await unreadIds(player.id, threads);
    return {
      manager,
      sections: sections.map((s) => {
        const own = threads.filter((t) => t.sectionId === s.id);
        return { section: s, threads: own.length, unread: own.filter((t) => unread.has(t.id)).length, last: own[0] || null };
      }),
    };
  }

  /** Nombre de sujets non lus de la tribu du joueur (pastille de l'onglet Tribu). */
  /** `player` : identifiant, ou joueur déjà lu avec son `tribeId` (en-tête des pages). */
  static async unreadCount(playerOrId) {
    const player = typeof playerOrId === 'object' ? playerOrId : await Player.findByPk(playerOrId, { attributes: ['id', 'tribeId'] });
    if (!player || !player.tribeId) return 0;
    const threads = await tribeThreads(player.tribeId, await mutedIds(player.id));
    return (await unreadIds(player.id, threads)).size;
  }

  /** Encadré « Nouveaux messages du forum » : sujets non lus, 5 par page, hors sourdine si demandé. */
  static async recent(playerId, { excludeMuted = true, page = 1 } = {}) {
    const { player } = await memberOf(playerId);
    const threads = await tribeThreads(player.tribeId, excludeMuted ? await mutedIds(player.id) : new Set());
    const unread = await unreadIds(player.id, threads);
    const list = threads.filter((t) => unread.has(t.id));
    const pages = Math.max(1, Math.ceil(list.length / RECENT_PAGE));
    const current = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
    const rows = list.slice((current - 1) * RECENT_PAGE, current * RECENT_PAGE);
    const lastPosts = rows.length ? await TribeForumPost.findAll({ where: { id: { [Op.in]: rows.map((t) => t.lastPostId).filter(Boolean) } }, include: [authorOf()] }) : [];
    const byId = new Map(lastPosts.map((p) => [p.id, p]));
    return { threads: rows.map((t) => ({ thread: t, lastPost: byId.get(t.lastPostId) || null })), page: current, pages, total: list.length, excludeMuted };
  }

  /** Marquer comme lus les sujets d'un sous-forum, ou de tout le forum (sectionId nul). */
  static async markRead(playerId, sectionId = null, now = new Date()) {
    const { player } = await memberOf(playerId);
    if (sectionId != null) await sectionOf(player, sectionId);
    const threads = (await tribeThreads(player.tribeId)).filter((t) => sectionId == null || t.sectionId === Number(sectionId));
    await sequelize.transaction(async (t) => {
      for (const th of threads) await markRead(player.id, th.id, now, t);
    });
    return threads.length;
  }

  /** Ignorer un sous-forum (sourdine) ou ne plus l'ignorer. Renvoie true s'il est désormais en sourdine. */
  static async toggleMute(playerId, sectionId) {
    const { player } = await memberOf(playerId);
    const section = await sectionOf(player, sectionId);
    const existing = await TribeForumMute.findOne({ where: { playerId: player.id, sectionId: section.id } });
    if (existing) {
      await existing.destroy();
      return false;
    }
    await TribeForumMute.create({ playerId: player.id, sectionId: section.id });
    return true;
  }

  /** Recherche dans les titres et les messages du forum de la tribu (au moins 2 caractères). */
  static async search(playerId, text) {
    const { player } = await memberOf(playerId);
    const q = String(text || '').trim().toLowerCase().slice(0, 60);
    if (q.length < 2) return [];
    const pattern = `%${q.replace(/[%_\\]/g, '')}%`;
    const lower = (col) => sequelize.where(sequelize.fn('lower', sequelize.col(col)), { [Op.like]: pattern });
    const sectionIds = (await tribeSections(player.tribeId)).map((x) => x.id);
    const inPosts = await TribeForumPost.findAll({ where: { [Op.and]: [lower('body')] }, attributes: ['threadId'], group: ['threadId'], raw: true });
    return TribeForumThread.findAll({
      where: { sectionId: { [Op.in]: sectionIds }, [Op.or]: [lower('TribeForumThread.title'), { id: { [Op.in]: inPosts.map((r) => r.threadId) } }] },
      include: [authorOf(), { model: TribeForumSection, as: 'section', attributes: ['id', 'name'] }, { model: TribeForumPost, as: 'lastPost', include: [authorOf()] }],
      order: [['lastPostAt', 'DESC']],
      limit: 30,
    });
  }

  /** Sujets d'un sous-forum : épinglés d'abord, puis du plus récemment actif au plus ancien. */
  static async section(playerId, sectionId, page = 1) {
    const { player, manager } = await memberOf(playerId);
    const section = await sectionOf(player, sectionId);
    const count = await TribeForumThread.count({ where: { sectionId: section.id } });
    const p = pageOf(page, count);
    const threads = await TribeForumThread.findAll({
      where: { sectionId: section.id },
      include: [authorOf(), { model: TribeForumPost, as: 'lastPost', include: [authorOf()] }, { model: TribeForumPoll, as: 'poll', attributes: ['id'] }],
      order: [['pinned', 'DESC'], ['lastPostAt', 'DESC'], ['id', 'DESC']],
      limit: PAGE_SIZE,
      offset: (p.page - 1) * PAGE_SIZE,
    });
    const muted = await mutedIds(player.id);
    return {
      manager, player, section, sections: await tribeSections(player.tribeId), muted, isMuted: muted.has(section.id),
      threads, unread: await unreadIds(player.id, threads), total: count, ...p,
    };
  }

  /** Premier sous-forum de la tribu (ouvert par l'onglet Forum), créés au besoin. */
  static async firstSection(playerId) {
    const { player } = await memberOf(playerId);
    let sections = await tribeSections(player.tribeId);
    if (!sections.length) sections = await TribeForumService.createDefaults(player.tribeId);
    return sections[0];
  }

  /** Un sujet et une page de ses messages (`'last'` : dernière page). L'ouvrir le marque comme lu. */
  static async thread(playerId, threadId, page = 1, now = new Date()) {
    const { player, manager } = await memberOf(playerId);
    const thread = await threadOf(player, threadId);
    const count = await TribeForumPost.count({ where: { threadId: thread.id } });
    const p = pageOf(page, count);
    const posts = await TribeForumPost.findAll({
      where: { threadId: thread.id },
      include: [authorOf()],
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
      limit: PAGE_SIZE,
      offset: (p.page - 1) * PAGE_SIZE,
    });
    const first = await TribeForumPost.findOne({ where: { threadId: thread.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']], attributes: ['id'] });
    await markRead(player.id, thread.id, now);
    const poll = await TribeForumPoll.findOne({ where: { threadId: thread.id } });
    let pollData = null;
    if (poll) {
      const votes = await TribeForumVote.findAll({ where: { pollId: poll.id }, attributes: ['option', 'playerId'] });
      const counts = poll.options.map((_, i) => votes.filter((v) => v.option === i).length);
      const mine = votes.find((v) => v.playerId === player.id);
      pollData = { options: poll.options, counts, total: votes.length, mine: mine ? mine.option : null };
    }
    return {
      manager, player, thread, section: thread.section, sections: await tribeSections(player.tribeId), poll: pollData,
      posts, firstPostId: first && first.id, total: count, ...p,
    };
  }

  /** Voter (ou changer son vote) dans le sondage d'un sujet. */
  static async vote(playerId, threadId, option) {
    const { player } = await memberOf(playerId);
    const thread = await threadOf(player, threadId);
    const poll = await TribeForumPoll.findOne({ where: { threadId: thread.id } });
    if (!poll) throw new GameError("Ce sujet n'a pas de sondage.", 404);
    if (thread.locked) throw new GameError('Ce sujet est verrouillé.');
    const i = Math.floor(Number(option));
    if (!Number.isInteger(i) || i < 0 || i >= poll.options.length) throw new GameError('Choisis une réponse.');
    const existing = await TribeForumVote.findOne({ where: { pollId: poll.id, playerId: player.id } });
    if (existing) await existing.update({ option: i });
    else await TribeForumVote.create({ pollId: poll.id, playerId: player.id, option: i });
    return thread;
  }

  // ---------------------------------------------------------------- Sous-forums (chefs)

  /** Sous-forums par défaut d'une nouvelle tribu. */
  static createDefaults(tribeId, t) {
    return TribeForumSection.bulkCreate(DEFAULT_SECTIONS.map((name, position) => ({ tribeId, name, position })), { transaction: t });
  }

  static async createSection(managerId, name) {
    const manager = await managerOf(managerId);
    const label = cleanName(name, 1, SECTION_MAX, 'Nom du sous-forum');
    const count = await TribeForumSection.count({ where: { tribeId: manager.tribeId } });
    if (count >= MAX_SECTIONS) throw new GameError(`${MAX_SECTIONS} sous-forums au maximum.`);
    const last = await TribeForumSection.max('position', { where: { tribeId: manager.tribeId } });
    return TribeForumSection.create({ tribeId: manager.tribeId, name: label, position: (Number.isFinite(last) ? last : -1) + 1 });
  }

  static async renameSection(managerId, sectionId, name) {
    const manager = await managerOf(managerId);
    const section = await sectionOf(manager, sectionId);
    return section.update({ name: cleanName(name, 1, SECTION_MAX, 'Nom du sous-forum') });
  }

  /** Monter (-1) ou descendre (+1) un sous-forum dans la liste. */
  static async moveSection(managerId, sectionId, dir) {
    const manager = await managerOf(managerId);
    const sections = await TribeForumSection.findAll({ where: { tribeId: manager.tribeId }, order: [['position', 'ASC'], ['id', 'ASC']] });
    const i = sections.findIndex((s) => s.id === Number(sectionId));
    if (i < 0) throw new GameError('Sous-forum introuvable.', 404);
    const j = i + (Number(dir) < 0 ? -1 : 1);
    if (j < 0 || j >= sections.length) return;
    [sections[i], sections[j]] = [sections[j], sections[i]];
    await sequelize.transaction(async (t) => {
      for (const [k, s] of sections.entries()) if (s.position !== k) await s.update({ position: k }, { transaction: t });
    });
  }

  /** Supprimer un sous-forum et tous ses sujets ; le dernier sous-forum ne peut pas être supprimé. */
  static async deleteSection(managerId, sectionId) {
    const manager = await managerOf(managerId);
    const section = await sectionOf(manager, sectionId);
    if (await TribeForumSection.count({ where: { tribeId: manager.tribeId } }) <= 1) throw new GameError('La tribu doit garder au moins un sous-forum.');
    await sequelize.transaction(async (t) => {
      const ids = (await TribeForumThread.findAll({ where: { sectionId: section.id }, attributes: ['id'], transaction: t })).map((x) => x.id);
      await destroyPolls(ids, t);
      await TribeForumMute.destroy({ where: { sectionId: section.id }, transaction: t });
      await TribeForumRead.destroy({ where: { threadId: { [Op.in]: ids } }, transaction: t });
      await TribeForumPost.destroy({ where: { threadId: { [Op.in]: ids } }, transaction: t });
      await TribeForumThread.destroy({ where: { sectionId: section.id }, transaction: t });
      await section.destroy({ transaction: t });
    });
  }

  // ---------------------------------------------------------------- Sujets et messages

  /** Nouveau sujet ; avec `options` (une réponse par ligne), c'est un sondage dont le titre est la question. */
  static async createThread(playerId, sectionId, { title, body, options }, now = new Date()) {
    const { player } = await memberOf(playerId);
    const section = await sectionOf(player, sectionId);
    const name = cleanName(title, 3, TITLE_MAX, 'Titre');
    const text = cleanBody(body);
    const pollOptions = options !== undefined ? cleanOptions(options) : null;
    await assertNotFlooding(player.id, now);
    return sequelize.transaction(async (t) => {
      const thread = await TribeForumThread.create({ sectionId: section.id, playerId: player.id, title: name, postCount: 1, lastPostAt: now }, { transaction: t });
      const post = await TribeForumPost.create({ threadId: thread.id, playerId: player.id, body: text, createdAt: now, updatedAt: now }, { transaction: t });
      await thread.update({ lastPostId: post.id }, { transaction: t });
      if (pollOptions) await TribeForumPoll.create({ threadId: thread.id, options: pollOptions }, { transaction: t });
      await markRead(player.id, thread.id, now, t);
      return thread;
    });
  }

  /** Répondre ; un sujet verrouillé n'accepte que les réponses des chefs. */
  static async reply(playerId, threadId, { body }, now = new Date()) {
    const { player, manager } = await memberOf(playerId);
    const thread = await threadOf(player, threadId);
    if (thread.locked && !manager) throw new GameError('Ce sujet est verrouillé.');
    const text = cleanBody(body);
    await assertNotFlooding(player.id, now);
    return sequelize.transaction(async (t) => {
      const post = await TribeForumPost.create({ threadId: thread.id, playerId: player.id, body: text, createdAt: now, updatedAt: now }, { transaction: t });
      await thread.update({ postCount: thread.postCount + 1, lastPostAt: now, lastPostId: post.id }, { transaction: t });
      await markRead(player.id, thread.id, now, t);
      return post;
    });
  }

  /** Modifier son propre message. */
  static async edit(playerId, postId, { body }, now = new Date()) {
    const { player } = await memberOf(playerId);
    const post = await TribeForumPost.findByPk(Number(postId));
    if (!post) throw new GameError('Message introuvable.', 404);
    await threadOf(player, post.threadId);
    if (post.playerId !== player.id) throw new GameError('Tu ne peux modifier que tes propres messages.', 403);
    return post.update({ body: cleanBody(body), editedAt: now });
  }

  /**
   * Supprimer un message : le sien, ou n'importe lequel pour un chef. Le premier message part avec le sujet entier :
   * un membre ne peut le faire que tant qu'il n'y a pas de réponse. Renvoie { threadDeleted, thread }.
   */
  static async remove(playerId, postId) {
    const { player, manager } = await memberOf(playerId);
    const post = await TribeForumPost.findByPk(Number(postId));
    if (!post) throw new GameError('Message introuvable.', 404);
    const thread = await threadOf(player, post.threadId);
    if (post.playerId !== player.id && !manager) throw new GameError('Tu ne peux supprimer que tes propres messages.', 403);
    const first = await TribeForumPost.findOne({ where: { threadId: thread.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
    return sequelize.transaction(async (t) => {
      if (first.id === post.id) {
        if (thread.postCount > 1 && !manager) throw new GameError('Ce sujet a des réponses : son premier message ne peut plus être supprimé.');
        await destroyPolls([thread.id], t);
        await TribeForumRead.destroy({ where: { threadId: thread.id }, transaction: t });
        await TribeForumPost.destroy({ where: { threadId: thread.id }, transaction: t });
        await TribeForumThread.destroy({ where: { id: thread.id }, transaction: t });
        return { threadDeleted: true, thread };
      }
      await post.destroy({ transaction: t });
      const last = await TribeForumPost.findOne({ where: { threadId: thread.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']], transaction: t });
      await TribeForumThread.update({ postCount: thread.postCount - 1, lastPostAt: last.createdAt, lastPostId: last.id }, { where: { id: thread.id }, transaction: t });
      return { threadDeleted: false, thread };
    });
  }

  /** Chefs : épingler / verrouiller un sujet (flag : 'pinned' ou 'locked'). */
  static async setFlag(managerId, threadId, flag, on) {
    if (!['pinned', 'locked'].includes(flag)) throw new GameError('Action inconnue.');
    const manager = await managerOf(managerId);
    const thread = await threadOf(manager, threadId);
    await TribeForumThread.update({ [flag]: Boolean(on) }, { where: { id: thread.id } });
    return thread;
  }

  /** Dissolution d'une tribu : tout son forum disparaît. */
  static async destroyTribe(tribeId, t) {
    const sectionIds = (await TribeForumSection.findAll({ where: { tribeId }, attributes: ['id'], transaction: t })).map((s) => s.id);
    if (!sectionIds.length) return;
    const threadIds = (await TribeForumThread.findAll({ where: { sectionId: { [Op.in]: sectionIds } }, attributes: ['id'], transaction: t })).map((x) => x.id);
    await destroyPolls(threadIds, t);
    await TribeForumMute.destroy({ where: { sectionId: { [Op.in]: sectionIds } }, transaction: t });
    await TribeForumRead.destroy({ where: { threadId: { [Op.in]: threadIds } }, transaction: t });
    await TribeForumPost.destroy({ where: { threadId: { [Op.in]: threadIds } }, transaction: t });
    await TribeForumThread.destroy({ where: { id: { [Op.in]: threadIds } }, transaction: t });
    await TribeForumSection.destroy({ where: { id: { [Op.in]: sectionIds } }, transaction: t });
  }
}

Object.assign(TribeForumService, { DEFAULT_SECTIONS, RECENT_PAGE, POLL_MAX, PAGE_SIZE, TITLE_MAX, BODY_MAX, FLOOD_SECONDS, MAX_SECTIONS });

module.exports = TribeForumService;
