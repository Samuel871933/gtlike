'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Player, Tribe, TribeForumSection, TribeForumThread, TribeForumPost, TribeForumRead, TribeForumMute, TribeForumPoll, TribeForumVote,
  TribeForumShare,
} = require('../models');
const GameError = require('./GameError');
const { paginate } = require('./PaginationService');
const TribeService = require('./TribeService');

// Forum interne d'une tribu (comme sur Guerre Tribale) : réservé à ses membres. Un sous-forum peut être caché (droit
// « Forum caché ») ou partagé avec d'autres tribus, qui l'acceptent dans leurs réglages du forum ; seuls les
// modérateurs de la tribu propriétaire modèrent un forum partagé.
const PAGE_SIZE = 20;
const TITLE_MAX = 80;
const BODY_MAX = 5000;
const SECTION_MAX = 40;
const MAX_SECTIONS = 20;
const MAX_SHARES = 10;
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

/**
 * Sous-forums visibles du joueur : ceux de sa tribu, puis les forums partagés qu'elle a acceptés ; un forum caché
 * (chez la tribu propriétaire, ou par la tribu invitée pour un forum reçu) seulement avec le droit « Forum caché ».
 * Chaque sous-forum porte `isHidden` et `owner` (tribu propriétaire d'un forum reçu, sinon null).
 */
async function visibleSections(player) {
  const secret = TribeService.can(player, 'hiddenForum');
  const own = await tribeSections(player.tribeId);
  const shares = await TribeForumShare.findAll({
    where: { tribeId: player.tribeId, accepted: true },
    include: [{ model: TribeForumSection, as: 'section', include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
    order: [['id', 'ASC']],
  });
  const list = [
    ...own.map((x) => Object.assign(x, { isHidden: x.hidden, owner: null })),
    ...shares.map((sh) => Object.assign(sh.section, { isHidden: sh.hidden, owner: sh.section.Tribe })),
  ];
  return list.filter((x) => secret || !x.isHidden);
}

async function sectionOf(player, sectionId) {
  const section = (await visibleSections(player)).find((x) => x.id === Number(sectionId));
  if (!section) throw new GameError('Sous-forum introuvable.', 404);
  return section;
}

/** Sous-forum de la tribu du joueur (pas un forum reçu d'une autre tribu). */
async function ownSectionOf(player, sectionId) {
  const section = await sectionOf(player, sectionId);
  if (section.owner) throw new GameError('Ce forum appartient à une autre tribu : seuls ses modérateurs le gèrent.', 403);
  return section;
}

async function threadOf(player, threadId) {
  const thread = await TribeForumThread.findByPk(Number(threadId), { include: [authorOf()] });
  const section = thread && (await visibleSections(player)).find((x) => x.id === thread.sectionId);
  if (!section) throw new GameError('Sujet introuvable.', 404);
  thread.section = section;
  return thread;
}

/** Modérateur de ce sous-forum : modérateur de sa tribu propriétaire. */
const moderates = (manager, section) => manager && !section.owner;

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

/** Sujets des sous-forums visibles du joueur, au besoin hors sous-forums en sourdine. */
async function visibleThreads(player, exclude = new Set()) {
  const ids = (await visibleSections(player)).map((x) => x.id);
  if (!ids.length) return [];
  return TribeForumThread.findAll({
    attributes: ['id', 'sectionId', 'title', 'lastPostAt', 'lastPostId', 'postCount'],
    include: [{ model: TribeForumSection, as: 'section', attributes: ['id', 'name'], where: { id: { [Op.in]: ids } } }],
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

const LAST_OPEN = 'La tribu doit garder au moins un sous-forum visible de tous.';

/** Modérateur du forum qui a aussi le droit « Forum caché » (pour cacher un forum ou le rendre visible). */
async function secretManagerOf(playerId) {
  const manager = await managerOf(playerId);
  if (!TribeService.can(manager, 'hiddenForum')) throw new GameError('Il faut le droit Forum caché.', 403);
  return manager;
}

/** Partage proposé à la tribu du joueur. */
async function receivedShare(player, shareId) {
  const share = await TribeForumShare.findByPk(Number(shareId));
  if (!share || share.tribeId !== player.tribeId) throw new GameError('Partage introuvable.', 404);
  return share;
}

/** Fin d'un partage : les membres de la tribu invitée perdent aussi leur sourdine sur ce forum. */
async function endShare(share, t) {
  const members = await Player.findAll({ where: { tribeId: share.tribeId }, attributes: ['id'], transaction: t });
  if (members.length) await TribeForumMute.destroy({ where: { sectionId: share.sectionId, playerId: { [Op.in]: members.map((m) => m.id) } }, transaction: t });
  await share.destroy({ transaction: t });
}

class TribeForumService {
  /**
   * Réglages du forum : sous-forums de la tribu (sujets, non lus, dernier sujet actif, tribus avec qui ils sont
   * partagés), forums partagés reçus d'autres tribus (acceptés ou en attente) et rangée des sous-forums (`nav`).
   */
  static async overview(playerId) {
    const { player, manager } = await memberOf(playerId);
    // Tribu fondée avant le forum : elle reçoit les sous-forums par défaut à la première visite.
    if (!(await TribeForumSection.count({ where: { tribeId: player.tribeId } }))) await TribeForumService.createDefaults(player.tribeId);
    const nav = await visibleSections(player);
    const sections = nav.filter((x) => !x.owner);
    const shares = await TribeForumShare.findAll({
      where: { sectionId: { [Op.in]: sections.map((x) => x.id) } },
      include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }],
      order: [['id', 'ASC']],
    });
    const secret = TribeService.can(player, 'hiddenForum');
    const received = (await TribeForumShare.findAll({
      where: { tribeId: player.tribeId },
      include: [{ model: TribeForumSection, as: 'section', attributes: ['id', 'name'], include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
      order: [['accepted', 'ASC'], ['id', 'ASC']],
    })).filter((sh) => secret || !sh.accepted || !sh.hidden);
    const threads = await TribeForumThread.findAll({
      where: { sectionId: { [Op.in]: sections.map((s) => s.id) } },
      attributes: ['id', 'sectionId', 'title', 'lastPostAt', 'lastPostId'],
      include: [{ model: TribeForumPost, as: 'lastPost', attributes: ['id'], include: [authorOf()] }],
      order: [['lastPostAt', 'DESC']],
    });
    const unread = await unreadIds(player.id, threads);
    return {
      manager, secret, nav, received,
      sections: sections.map((s) => {
        const own = threads.filter((t) => t.sectionId === s.id);
        return {
          section: s, threads: own.length, unread: own.filter((t) => unread.has(t.id)).length, last: own[0] || null,
          shares: shares.filter((sh) => sh.sectionId === s.id),
        };
      }),
    };
  }

  /** Demandes de partage de forum en attente pour la tribu (pastille des réglages du forum). */
  static pendingShares(tribeId) {
    return TribeForumShare.count({ where: { tribeId, accepted: false } });
  }

  /** Nombre de sujets non lus de la tribu du joueur (pastille de l'onglet Tribu). */
  /** `player` : identifiant, ou joueur déjà lu avec son `tribeId` et ses droits (en-tête des pages). */
  static async unreadCount(playerOrId) {
    const player = typeof playerOrId === 'object' ? playerOrId : await Player.findByPk(playerOrId, { attributes: ['id', 'tribeId', 'tribeRole', 'tribeRights'] });
    if (!player || !player.tribeId) return 0;
    const threads = await visibleThreads(player, await mutedIds(player.id));
    return (await unreadIds(player.id, threads)).size;
  }

  /** Encadré « Nouveaux messages du forum » : sujets non lus, 5 par page, hors sourdine si demandé. */
  static async recent(playerId, { excludeMuted = true, page = 1 } = {}) {
    const { player } = await memberOf(playerId);
    const threads = await visibleThreads(player, excludeMuted ? await mutedIds(player.id) : new Set());
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
    const threads = (await visibleThreads(player)).filter((t) => sectionId == null || t.sectionId === Number(sectionId));
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

  /** Recherche dans les titres et les messages des sous-forums visibles du joueur (au moins 2 caractères). */
  static async search(playerId, text) {
    const { player } = await memberOf(playerId);
    const q = String(text || '').trim().toLowerCase().slice(0, 60);
    if (q.length < 2) return [];
    const pattern = `%${q.replace(/[%_\\]/g, '')}%`;
    const lower = (col) => sequelize.where(sequelize.fn('lower', sequelize.col(col)), { [Op.like]: pattern });
    const sectionIds = (await visibleSections(player)).map((x) => x.id);
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
      manager: moderates(manager, section), player, section, sections: await visibleSections(player), muted, isMuted: muted.has(section.id),
      threads, unread: await unreadIds(player.id, threads), total: count, ...p,
    };
  }

  /** Premier sous-forum visible du joueur (ouvert par l'onglet Forum) ; ceux de la tribu sont créés au besoin. */
  static async firstSection(playerId) {
    const { player } = await memberOf(playerId);
    if (!(await TribeForumSection.count({ where: { tribeId: player.tribeId } }))) await TribeForumService.createDefaults(player.tribeId);
    const [first] = await visibleSections(player);
    if (!first) throw new GameError('Aucun forum accessible.', 404);
    return first;
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
      manager: moderates(manager, thread.section), player, thread, section: thread.section, sections: await visibleSections(player), poll: pollData,
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
    const section = await ownSectionOf(manager, sectionId);
    return section.update({ name: cleanName(name, 1, SECTION_MAX, 'Nom du sous-forum') });
  }

  /** Monter (-1) ou descendre (+1) un sous-forum dans la liste (en sautant les forums cachés que le modérateur ne voit pas). */
  static async moveSection(managerId, sectionId, dir) {
    const manager = await managerOf(managerId);
    const section = await ownSectionOf(manager, sectionId);
    const sections = await tribeSections(manager.tribeId);
    const seen = TribeService.can(manager, 'hiddenForum') ? () => true : (s) => !s.hidden;
    const i = sections.findIndex((s) => s.id === section.id);
    const step = Number(dir) < 0 ? -1 : 1;
    let j = i + step;
    while (j >= 0 && j < sections.length && !seen(sections[j])) j += step;
    if (j < 0 || j >= sections.length) return;
    [sections[i], sections[j]] = [sections[j], sections[i]];
    await sequelize.transaction(async (t) => {
      for (const [k, s] of sections.entries()) if (s.position !== k) await s.update({ position: k }, { transaction: t });
    });
  }

  /** Supprimer un sous-forum, ses sujets et ses partages ; la tribu garde au moins un sous-forum visible de tous. */
  static async deleteSection(managerId, sectionId) {
    const manager = await managerOf(managerId);
    const section = await ownSectionOf(manager, sectionId);
    if (!section.hidden && await TribeForumSection.count({ where: { tribeId: manager.tribeId, hidden: false } }) <= 1) throw new GameError(LAST_OPEN);
    await sequelize.transaction(async (t) => {
      const ids = (await TribeForumThread.findAll({ where: { sectionId: section.id }, attributes: ['id'], transaction: t })).map((x) => x.id);
      await destroyPolls(ids, t);
      await TribeForumShare.destroy({ where: { sectionId: section.id }, transaction: t });
      await TribeForumMute.destroy({ where: { sectionId: section.id }, transaction: t });
      await TribeForumRead.destroy({ where: { threadId: { [Op.in]: ids } }, transaction: t });
      await TribeForumPost.destroy({ where: { threadId: { [Op.in]: ids } }, transaction: t });
      await TribeForumThread.destroy({ where: { sectionId: section.id }, transaction: t });
      await section.destroy({ transaction: t });
    });
  }

  /** Faire d'un sous-forum de la tribu un forum caché, ou le rendre de nouveau visible de tous. */
  static async setHidden(managerId, sectionId, on) {
    const manager = await secretManagerOf(managerId);
    const section = await ownSectionOf(manager, sectionId);
    const hidden = Boolean(on);
    if (hidden && !section.hidden && await TribeForumSection.count({ where: { tribeId: manager.tribeId, hidden: false } }) <= 1) throw new GameError(LAST_OPEN);
    return section.update({ hidden });
  }

  // ---------------------------------------------------------------- Forums partagés

  /** Proposer un sous-forum de la tribu à une autre tribu du monde (par son tag) ; elle doit l'accepter. */
  static async share(managerId, sectionId, tag) {
    const manager = await managerOf(managerId);
    const section = await ownSectionOf(manager, sectionId);
    const tribe = await Tribe.findOne({ where: { worldId: manager.worldId, tag: String(tag || '').trim() } });
    if (!tribe) throw new GameError('Aucune tribu avec ce tag.');
    if (tribe.id === manager.tribeId) throw new GameError('Ce forum appartient déjà à ta tribu.');
    const existing = await TribeForumShare.findOne({ where: { sectionId: section.id, tribeId: tribe.id } });
    if (existing) throw new GameError(existing.accepted ? 'Ce forum est déjà partagé avec cette tribu.' : 'Cette tribu a déjà une demande de partage pour ce forum.');
    if (await TribeForumShare.count({ where: { sectionId: section.id } }) >= MAX_SHARES) throw new GameError(`Un forum se partage avec ${MAX_SHARES} tribus au maximum.`);
    return TribeForumShare.create({ sectionId: section.id, tribeId: tribe.id });
  }

  /** Tribu propriétaire : retirer une demande de partage ou cesser de partager le forum avec une tribu. */
  static async unshare(managerId, shareId) {
    const manager = await managerOf(managerId);
    const share = await TribeForumShare.findByPk(Number(shareId));
    if (!share) throw new GameError('Partage introuvable.', 404);
    await ownSectionOf(manager, share.sectionId);
    await endShare(share);
    return share;
  }

  /** Tribu invitée : accepter (le forum rejoint sa liste) ou refuser une demande de partage. */
  static async answerShare(managerId, shareId, accept) {
    const manager = await managerOf(managerId);
    const share = await receivedShare(manager, shareId);
    if (share.accepted) throw new GameError('Ce partage est déjà accepté.');
    if (accept) return share.update({ accepted: true });
    await share.destroy();
    return share;
  }

  /** Tribu invitée : quitter un forum partagé accepté. */
  static async leaveShare(managerId, shareId) {
    const manager = await managerOf(managerId);
    const share = await receivedShare(manager, shareId);
    await endShare(share);
    return share;
  }

  /** Tribu invitée : faire d'un forum partagé reçu un forum caché pour ses membres, ou non. */
  static async setShareHidden(managerId, shareId, on) {
    const manager = await secretManagerOf(managerId);
    const share = await receivedShare(manager, shareId);
    if (!share.accepted) throw new GameError("Accepte d'abord ce forum partagé.");
    return share.update({ hidden: Boolean(on) });
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
    if (thread.locked && !moderates(manager, thread.section)) throw new GameError('Ce sujet est verrouillé.');
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
    const { player, manager: mod } = await memberOf(playerId);
    const post = await TribeForumPost.findByPk(Number(postId));
    if (!post) throw new GameError('Message introuvable.', 404);
    const thread = await threadOf(player, post.threadId);
    const manager = moderates(mod, thread.section);
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
    if (thread.section.owner) throw new GameError('Ce forum appartient à une autre tribu : seuls ses modérateurs le gèrent.', 403);
    await TribeForumThread.update({ [flag]: Boolean(on) }, { where: { id: thread.id } });
    return thread;
  }

  /** Dissolution d'une tribu : tout son forum disparaît. */
  static async destroyTribe(tribeId, t) {
    // Forums partagés reçus : les membres n'y ont plus accès (sourdines retirées avec le partage).
    for (const share of await TribeForumShare.findAll({ where: { tribeId }, transaction: t })) await endShare(share, t);
    const sectionIds = (await TribeForumSection.findAll({ where: { tribeId }, attributes: ['id'], transaction: t })).map((s) => s.id);
    if (!sectionIds.length) return;
    const threadIds = (await TribeForumThread.findAll({ where: { sectionId: { [Op.in]: sectionIds } }, attributes: ['id'], transaction: t })).map((x) => x.id);
    await destroyPolls(threadIds, t);
    await TribeForumShare.destroy({ where: { sectionId: { [Op.in]: sectionIds } }, transaction: t });
    await TribeForumMute.destroy({ where: { sectionId: { [Op.in]: sectionIds } }, transaction: t });
    await TribeForumRead.destroy({ where: { threadId: { [Op.in]: threadIds } }, transaction: t });
    await TribeForumPost.destroy({ where: { threadId: { [Op.in]: threadIds } }, transaction: t });
    await TribeForumThread.destroy({ where: { id: { [Op.in]: threadIds } }, transaction: t });
    await TribeForumSection.destroy({ where: { id: { [Op.in]: sectionIds } }, transaction: t });
  }
}

Object.assign(TribeForumService, { DEFAULT_SECTIONS, RECENT_PAGE, POLL_MAX, PAGE_SIZE, TITLE_MAX, BODY_MAX, FLOOD_SECONDS, MAX_SECTIONS, MAX_SHARES });

module.exports = TribeForumService;
