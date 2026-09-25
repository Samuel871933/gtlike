'use strict';

const express = require('express');
const ForumService = require('../../services/ForumService');
const GameError = require('../../services/GameError');
const { ah, flash, requireAuth } = require('../middleware');

// Forum communautaire : lecture ouverte à tous, écriture réservée aux comptes connectés.
const router = express.Router();

router.get('/forum', ah(async (req, res) => {
  res.render('forum', { lobbyPage: 'forum', sections: await ForumService.sections() });
}));

router.get('/forum/:section', ah(async (req, res) => {
  const data = await ForumService.threads(req.params.section, req.query.page);
  res.render('forum-section', { lobbyPage: 'forum', ...data, form: {}, error: null });
}));

router.post('/forum/:section', requireAuth, ah(async (req, res) => {
  try {
    const thread = await ForumService.createThread(req.user.id, req.params.section, req.body);
    res.redirect(`/forum/t/${thread.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status === 404) throw err;
    const data = await ForumService.threads(req.params.section, 1);
    res.status(400).render('forum-section', { lobbyPage: 'forum', ...data, form: req.body, error: err.message });
  }
}));

router.get('/forum/t/:threadId', ah(async (req, res) => {
  const data = await ForumService.thread(req.params.threadId, req.query.page === 'last' ? 'last' : req.query.page);
  res.render('forum-thread', { lobbyPage: 'forum', ...data, form: {}, error: null });
}));

router.post('/forum/t/:threadId', requireAuth, ah(async (req, res) => {
  try {
    const post = await ForumService.reply(req.user.id, req.params.threadId, req.body);
    res.redirect(`/forum/t/${post.threadId}?page=last#p${post.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status === 404) throw err;
    const data = await ForumService.thread(req.params.threadId, 'last');
    res.status(400).render('forum-thread', { lobbyPage: 'forum', ...data, form: req.body, error: err.message });
  }
}));

router.post('/forum/p/:postId/edit', requireAuth, ah(async (req, res) => {
  const post = await ForumService.edit(req.user.id, req.params.postId, req.body);
  flash(req, 'success', 'Message modifié.');
  res.redirect(`/forum/t/${post.threadId}?page=${Number(req.body.page) || 1}#p${post.id}`);
}));

router.post('/forum/p/:postId/delete', requireAuth, ah(async (req, res) => {
  const { threadDeleted, thread } = await ForumService.remove(req.user.id, req.params.postId);
  flash(req, 'success', threadDeleted ? 'Sujet supprimé.' : 'Message supprimé.');
  res.redirect(threadDeleted ? `/forum/${thread.section}` : `/forum/t/${thread.id}?page=last`);
}));

module.exports = router;
