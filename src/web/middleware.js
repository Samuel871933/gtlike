'use strict';

const GameError = require('../services/GameError');
const VillageService = require('../services/VillageService');
const CommandService = require('../services/CommandService');
const MessageService = require('../services/MessageService');
const { gameStyleFor } = require('./gameStyles');
const { Op } = require('sequelize');
const { User, Report, Village, TribeInvite, Player } = require('../models');

/** Enveloppe un handler async pour transmettre les erreurs à Express 4. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function flash(req, type, message) {
  req.session.flash = { type, message };
}

/** Charge l'utilisateur connecté et le message flash éventuel. */
const loadUser = ah(async (req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.user = null;
  if (req.session.userId) {
    const user = await User.findByPk(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.user = user;
    } else {
      delete req.session.userId;
    }
  }
  next();
});

/** Page précédente, uniquement si elle est sur notre propre site. */
function back(req, fallback = '/') {
  try {
    const ref = new URL(req.get('Referrer'));
    if (ref.host === req.get('host')) return ref.pathname + ref.search;
  } catch {
    // pas de Referer ou Referer invalide
  }
  return fallback;
}

/** Actions réservées au titulaire du compte (interdites au remplaçant). */
function ownerOnly(req, res, next) {
  if (req.asSitter) return next(new GameError('Action réservée au titulaire du compte.', 403));
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

/** Vérifie la propriété du village, le rafraîchit et expose le contexte aux vues. */
const loadVillage = ah(async (req, res, next) => {
  const { village: owned, asSitter } = await VillageService.assertAccess(Number(req.params.villageId), req.user.id);
  req.asSitter = asSitter;
  res.locals.asSitter = asSitter;
  await CommandService.processDue(new Date());
  req.ctx = await VillageService.withVillage(owned.id, async (ctx) => ctx);
  res.locals.ctx = req.ctx;
  res.locals.unreadReports = await Report.count({ where: { playerId: owned.playerId, isRead: false } });
  res.locals.incomingAttacks = await CommandService.incomingAttackCount(owned.playerId);
  const player = await Player.findByPk(owned.playerId);
  res.locals.player = player;
  res.locals.gameStyle = gameStyleFor(req.user);
  res.locals.playerRank = 1 + await Player.count({ where: { worldId: player.worldId, points: { [Op.gt]: player.points } } });
  res.locals.tribeInvites = await TribeInvite.count({ where: { playerId: owned.playerId } });
  res.locals.unreadMessages = await MessageService.unreadCount(owned.playerId);
  res.locals.myVillages = await Village.findAll({
    where: { playerId: owned.playerId }, attributes: ['id', 'name', 'x', 'y'], order: [['name', 'ASC'], ['id', 'ASC']],
  });
  next();
});

/**
 * Erreurs métier : sur un POST, message flash et retour à la page ; sinon page d'erreur.
 */
function errorHandler(err, req, res, _next) {
  if (err instanceof GameError) {
    if (req.method === 'POST' && err.status < 500 && err.status !== 404) {
      flash(req, 'error', err.message);
      return res.redirect(back(req));
    }
    return res.status(err.status).render('error', { message: err.message });
  }
  console.error(err);
  res.status(500).render('error', { message: 'Erreur interne du serveur.' });
}

module.exports = { ah, back, flash, loadUser, requireAuth, loadVillage, ownerOnly, errorHandler };
