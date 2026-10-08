'use strict';

const express = require('express');
const MatchService = require('../../services/MatchService');
const GameError = require('../../services/GameError');
const { MatchQueue } = require('../../models');
const mu = require('../../game/matchup');
const { ah, flash, requireAuth } = require('../middleware');

const router = express.Router();

/** Action du matchup : erreur de jeu affichée en message sur la page, puis retour à la page. */
const action = (fn) => ah(async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    flash(req, 'error', err.message);
  }
  if (!res.headersSent) res.redirect('/matchup');
});

/**
 * Page du matchup (publique : les règles se lisent sans compte). Connecté : ses ligues, son groupe, la recherche en
 * cours ou la partie à reprendre, ses dernières parties. Le classement a sa page (/matchup/classement).
 */
router.get('/matchup', ah(async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const [ratings, status, history, queue] = await Promise.all([
    MatchService.ratingsOf(userId),
    userId ? MatchService.status(userId) : null,
    userId ? MatchService.history(userId, 8) : [],
    MatchQueue.findAll({ attributes: ['format', 'size'] }),
  ]);
  // Joueurs en recherche par format (indication d'attente).
  const searching = Object.fromEntries(Object.keys(mu.FORMATS).map((f) => [f, queue.filter((e) => e.format === f).reduce((s, e) => s + e.size, 0)]));
  res.render('matchup', { ratings, status, history, searching, mu, lobbyPage: 'matchup' });
}));

// Classement : une page par ladder (?ladder=duel | team), 25 lignes par page ; sans ?page=, celle du joueur connecté.
const RANKING_PAGE = 25;
router.get('/matchup/classement', ah(async (req, res) => {
  const ladder = Object.hasOwn(mu.LADDERS, req.query.ladder) ? req.query.ladder : 'duel';
  const userId = req.user ? req.user.id : null;
  const [ratings, position] = await Promise.all([
    MatchService.ratingsOf(userId),
    userId ? MatchService.positionOf(userId, ladder) : null,
  ]);
  const asked = Number.parseInt(req.query.page, 10);
  let page = Number.isFinite(asked) && asked > 0 ? asked : position ? Math.ceil(position / RANKING_PAGE) : 1;
  let board = await MatchService.leaderboard(ladder, { offset: (page - 1) * RANKING_PAGE, limit: RANKING_PAGE });
  const pages = Math.max(1, Math.ceil(board.total / RANKING_PAGE));
  if (page > pages) {
    page = pages;
    board = await MatchService.leaderboard(ladder, { offset: (page - 1) * RANKING_PAGE, limit: RANKING_PAGE });
  }
  const leagueCounts = await MatchService.leagueCounts(ladder);
  res.render('matchup-ranking', {
    ladder, ratings, position, board, page, pages, perPage: RANKING_PAGE, leagueCounts, mu, lobbyPage: 'matchup',
  });
}));

/** État relu par la page toutes les quelques secondes (garde l'entrée dans la file, annonce la partie trouvée). */
router.get('/matchup/status', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await MatchService.status(req.user.id));
}));

router.post('/matchup/queue', requireAuth, action((req) => MatchService.enqueue(req.user, String(req.body.format || ''))));
router.post('/matchup/cancel', requireAuth, action((req) => MatchService.cancel(req.user)));
router.post('/matchup/group', requireAuth, action((req) => MatchService.createGroup(req.user)));
router.post('/matchup/group/join', requireAuth, action((req) => MatchService.joinGroup(req.user, req.body.code)));
router.post('/matchup/group/leave', requireAuth, action((req) => MatchService.leaveGroup(req.user)));
router.post('/matchup/forfeit', requireAuth, action(async (req) => {
  await MatchService.forfeit(req.user);
  flash(req, 'success', 'Tu as abandonné la partie : elle se termine quand toute ton équipe a abandonné.');
}));

module.exports = router;
