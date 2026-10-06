'use strict';

// Tribu et forum de la tribu (pages d'un village, montées par ./index.js).

const express = require('express');
const { Player } = require('../../../models');
const TribeService = require('../../../services/TribeService');
const TribeForumService = require('../../../services/TribeForumService');
const GameError = require('../../../services/GameError');
const { ah, back, flash, ownerOnly } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Tribu

router.get('/tribe', ah(async (req, res) => {
  const player = await Player.findByPk(me(req));
  if (!player.tribeId) {
    const invites = await TribeService.invitesFor(player.id);
    return res.render('tribe-none', { page: 'tribe', player, invites });
  }
  // Onglet Forum : ouvre directement le premier sous-forum, comme sur Guerre Tribale.
  if (req.query.tab === 'forum') return res.redirect(`${base(req)}/tribe/forum/${(await TribeForumService.firstSection(player.id)).id}`);
  // Droits et Invitations : réservés aux barons / à ceux qui peuvent inviter (sinon l'aperçu).
  const allowed = { rights: 'baron', invites: 'invite' };
  const asked = ['overview', 'properties', 'members', 'rights', 'invites', 'diplomacy'].includes(req.query.tab) ? req.query.tab : 'overview';
  const tab = allowed[asked] && !TribeService.can(player, allowed[asked]) ? 'overview' : asked;
  // Aperçu : fil des événements de la tribu, filtré (?cat=) et paginé (?page=), comme sur GT.
  const feed = tab === 'overview' ? await require('../../../services/TribeEventService').list(player.tribeId, { category: req.query.cat, page: req.query.page }) : null;
  await renderTribe(res, player, tab, null, 200, { feed });
}));

/** Page de la tribu (en-tête et onglets), avec au besoin une vue du forum de tribu. */
async function renderTribe(res, player, tab, forum, status = 200, extra = {}) {
  const data = await TribeService.dashboard(player);
  const forumUnread = await TribeForumService.unreadCount(player.id);
  const can = (right) => TribeService.can(player, right);
  // Pastille « Réglages du forum » : demandes de partage de forum en attente de réponse.
  // Lien « Réglages du forum » : modérateurs de la tribu, même sur un forum partagé reçu (qu'ils ne modèrent pas).
  if (forum && can('forumMod')) Object.assign(forum, { settings: true, pendingShares: await TribeForumService.pendingShares(player.tribeId) });
  res.status(status).render('tribe', { page: 'tribe', tab, player, can, canEdit: (m) => TribeService.canEdit(player, m), forum, forumUnread, feed: null, TribeCategories: require('../../../services/TribeEventService').CATEGORIES, ...data, ...extra });
}

// ------------------------------------------------------------ Forum de la tribu

const tribeForumBase = (req) => `${base(req)}/tribe/forum`;

router.get('/tribe/forum/t/:threadId', ah(async (req, res) => {
  const data = await TribeForumService.thread(me(req), req.params.threadId, req.query.page === 'last' ? 'last' : req.query.page);
  await renderTribe(res, data.player, 'forum', { view: 'thread', ...data, form: {}, error: null });
}));

/** Vue d'un sous-forum : encadré des nouveaux messages, sujets (ou recherche, ou formulaire de nouveau sujet). */
async function sectionView(req, extra = {}) {
  const data = await TribeForumService.section(me(req), req.params.sectionId, req.query.page);
  const recent = await TribeForumService.recent(me(req), { excludeMuted: req.query.sourdine !== '0', page: req.query.np });
  const q = String(req.query.q || '').trim();
  const results = q ? await TribeForumService.search(me(req), q) : null;
  const compose = ['sujet', 'sondage'].includes(req.query.nouveau) ? req.query.nouveau : null;
  return { view: 'section', ...data, recent, q, results, compose, query: req.query, form: {}, error: null, ...extra };
}

router.get('/tribe/forum/settings', ah(async (req, res) => {
  const data = await TribeForumService.overview(me(req));
  if (!data.manager) throw new GameError('Réservé aux chefs de la tribu.', 403);
  await renderTribe(res, await Player.findByPk(me(req)), 'forum', { view: 'settings', ...data });
}));

router.get('/tribe/forum/:sectionId', ah(async (req, res) => {
  const forum = await sectionView(req);
  await renderTribe(res, forum.player, 'forum', forum);
}));

router.post('/tribe/forum/read-all', ah(async (req, res) => {
  await TribeForumService.markRead(me(req), null);
  flash(req, 'success', 'Tous les forums sont marqués comme lus.');
  res.redirect(back(req, `${base(req)}/tribe?tab=forum`));
}));
router.post('/tribe/forum/:sectionId/read', ah(async (req, res) => {
  await TribeForumService.markRead(me(req), req.params.sectionId);
  flash(req, 'success', 'Forum marqué comme lu.');
  res.redirect(back(req, `${tribeForumBase(req)}/${Number(req.params.sectionId)}`));
}));
router.post('/tribe/forum/:sectionId/mute', ah(async (req, res) => {
  const muted = await TribeForumService.toggleMute(me(req), req.params.sectionId);
  flash(req, 'success', muted ? 'Forum ignoré : il est mis en sourdine.' : 'Tu suis de nouveau ce forum.');
  res.redirect(back(req, `${tribeForumBase(req)}/${Number(req.params.sectionId)}`));
}));
router.post('/tribe/forum/t/:threadId/vote', ah(async (req, res) => {
  const thread = await TribeForumService.vote(me(req), req.params.threadId, req.body.option);
  flash(req, 'success', 'Vote enregistré.');
  res.redirect(`${tribeForumBase(req)}/t/${thread.id}`);
}));

router.post('/tribe/forum/sections', ah(async (req, res) => {
  await TribeForumService.createSection(me(req), req.body.name);
  flash(req, 'success', 'Sous-forum créé.');
  res.redirect(`${tribeForumBase(req)}/settings`);
}));
router.post('/tribe/forum/sections/:sectionId/rename', ah(async (req, res) => {
  await TribeForumService.renameSection(me(req), req.params.sectionId, req.body.name);
  flash(req, 'success', 'Sous-forum renommé.');
  res.redirect(`${tribeForumBase(req)}/settings`);
}));
router.post('/tribe/forum/sections/:sectionId/move', ah(async (req, res) => {
  await TribeForumService.moveSection(me(req), req.params.sectionId, req.body.dir);
  res.redirect(`${tribeForumBase(req)}/settings`);
}));
router.post('/tribe/forum/sections/:sectionId/delete', ah(async (req, res) => {
  await TribeForumService.deleteSection(me(req), req.params.sectionId);
  flash(req, 'success', 'Sous-forum supprimé.');
  res.redirect(`${tribeForumBase(req)}/settings`);
}));

const settingsAction = (fn, message) => ah(async (req, res) => {
  await fn(req);
  if (message) flash(req, 'success', typeof message === 'function' ? message(req) : message);
  res.redirect(`${tribeForumBase(req)}/settings`);
});
const on = (req) => req.body.on === '1';

router.post('/tribe/forum/sections/:sectionId/hidden', settingsAction(
  (req) => TribeForumService.setHidden(me(req), req.params.sectionId, on(req)),
  (req) => (on(req) ? 'Le forum est désormais caché.' : 'Le forum est de nouveau visible de tous.'),
));
router.post('/tribe/forum/sections/:sectionId/share', settingsAction((req) => TribeForumService.share(me(req), req.params.sectionId, req.body.tag), 'Demande de partage envoyée : la tribu doit l\'accepter dans ses réglages du forum.'));
router.post('/tribe/forum/shares/:shareId/unshare', settingsAction((req) => TribeForumService.unshare(me(req), req.params.shareId), 'Partage retiré.'));
router.post('/tribe/forum/shares/:shareId/accept', settingsAction((req) => TribeForumService.answerShare(me(req), req.params.shareId, true), 'Forum partagé accepté.'));
router.post('/tribe/forum/shares/:shareId/decline', settingsAction((req) => TribeForumService.answerShare(me(req), req.params.shareId, false), 'Demande de partage refusée.'));
router.post('/tribe/forum/shares/:shareId/leave', settingsAction((req) => TribeForumService.leaveShare(me(req), req.params.shareId), 'Ta tribu a quitté ce forum partagé.'));
router.post('/tribe/forum/shares/:shareId/hidden', settingsAction(
  (req) => TribeForumService.setShareHidden(me(req), req.params.shareId, on(req)),
  (req) => (on(req) ? 'Le forum partagé est désormais caché.' : 'Le forum partagé est de nouveau visible de tous.'),
));

router.post('/tribe/forum/t/:threadId', ah(async (req, res) => {
  try {
    const post = await TribeForumService.reply(me(req), req.params.threadId, req.body);
    res.redirect(`${tribeForumBase(req)}/t/${post.threadId}?page=last#p${post.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status >= 403) throw err;
    const data = await TribeForumService.thread(me(req), req.params.threadId, 'last');
    await renderTribe(res, data.player, 'forum', { view: 'thread', ...data, form: req.body, error: err.message }, 400);
  }
}));
router.post('/tribe/forum/t/:threadId/flag', ah(async (req, res) => {
  const flag = req.body.flag === 'locked' ? 'locked' : 'pinned';
  await TribeForumService.setFlag(me(req), req.params.threadId, flag, req.body.on === '1');
  res.redirect(back(req, tribeForumBase(req)));
}));
router.post('/tribe/forum/p/:postId/edit', ah(async (req, res) => {
  const post = await TribeForumService.edit(me(req), req.params.postId, req.body);
  flash(req, 'success', 'Message modifié.');
  res.redirect(`${tribeForumBase(req)}/t/${post.threadId}?page=${Number(req.body.page) || 1}#p${post.id}`);
}));
router.post('/tribe/forum/p/:postId/delete', ah(async (req, res) => {
  const { threadDeleted, thread } = await TribeForumService.remove(me(req), req.params.postId);
  flash(req, 'success', threadDeleted ? 'Sujet supprimé.' : 'Message supprimé.');
  res.redirect(threadDeleted ? `${tribeForumBase(req)}/${thread.sectionId}` : `${tribeForumBase(req)}/t/${thread.id}?page=last`);
}));
router.post('/tribe/forum/:sectionId', ah(async (req, res) => {
  try {
    const thread = await TribeForumService.createThread(me(req), req.params.sectionId, req.body);
    res.redirect(`${tribeForumBase(req)}/t/${thread.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status >= 403) throw err;
    req.query.nouveau = req.body.options !== undefined ? 'sondage' : 'sujet';
    const forum = await sectionView(req, { form: req.body, error: err.message });
    await renderTribe(res, forum.player, 'forum', forum, 400);
  }
}));

router.get('/tribes/:tribeId', ah(async (req, res) => {
  const data = await TribeService.profile(req.params.tribeId);
  if (data.tribe.worldId !== req.ctx.village.worldId) throw new GameError('Tribu introuvable.', 404);
  res.render('tribe-profile', { page: 'tribe', ...data });
}));

// Toutes les actions de tribu redirigent vers la page de la tribu (onglet d'origine conservé).
const tribeAction = (fn, message) => ah(async (req, res) => {
  await fn(req);
  if (message) flash(req, 'success', message);
  res.redirect(back(req, `${base(req)}/tribe`));
});

router.post('/tribe/create', ah(async (req, res) => {
  await TribeService.create(me(req), req.body);
  flash(req, 'success', 'Tribu fondée.');
  res.redirect(`${base(req)}/tribe`);
}));
router.post('/tribe/invites/:inviteId/accept', ah(async (req, res) => {
  await TribeService.acceptInvite(me(req), req.params.inviteId);
  flash(req, 'success', 'Bienvenue dans la tribu !');
  res.redirect(`${base(req)}/tribe`);
}));
router.post('/tribe/invites/:inviteId/decline', tribeAction((req) => TribeService.declineInvite(me(req), req.params.inviteId), 'Invitation refusée.'));
router.post('/tribe/invite', tribeAction((req) => TribeService.invite(me(req), req.body.name), 'Invitation envoyée.'));
router.post('/tribe/invites/:inviteId/cancel', tribeAction((req) => TribeService.cancelInvite(me(req), req.params.inviteId), 'Invitation retirée.'));
router.post('/tribe/members/:playerId/kick', tribeAction((req) => TribeService.kick(me(req), req.params.playerId), 'Membre exclu.'));
// Droits de tous les membres modifiables (onglet « Droits », un seul formulaire) : `members` (identifiants), puis
// `title-<id>` et `rights-<id>` (cases cochées) pour chacun.
router.post('/tribe/rights', tribeAction((req) => {
  const ids = [].concat(req.body.members || []);
  return TribeService.setAllRights(me(req), ids.map((id) => ({ memberId: id, title: req.body[`title-${id}`], rights: req.body[`rights-${id}`] })));
}, 'Droits enregistrés.'));
router.post('/tribe/description', tribeAction((req) => TribeService.updateDescription(me(req), req.body.description), 'Description enregistrée.'));
router.post('/tribe/avatar', tribeAction((req) => {
  if (!req.file) throw new GameError('Choisissez une image.');
  return TribeService.updateAvatar(me(req), req.file.buffer);
}, 'Image de la tribu enregistrée.'));
router.post('/tribe/avatar/delete', tribeAction((req) => TribeService.updateAvatar(me(req), null), 'Image de la tribu supprimée.'));
router.post('/tribe/announcement', tribeAction((req) => TribeService.updateAnnouncement(me(req), req.body.announcement), 'Annonces internes enregistrées.'));
router.post('/tribe/relations', tribeAction((req) => TribeService.setRelation(me(req), req.body.tag, req.body.type), 'Diplomatie mise à jour.'));
router.post('/tribe/relations/:relationId/delete', tribeAction((req) => TribeService.removeRelation(me(req), req.params.relationId), 'Relation supprimée.'));
router.post('/tribe/leave', ownerOnly, ah(async (req, res) => {
  await TribeService.leave(me(req));
  flash(req, 'success', 'Vous avez quitté la tribu.');
  res.redirect(`${base(req)}/tribe`);
}));

module.exports = router;
