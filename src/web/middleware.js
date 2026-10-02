'use strict';

const GameError = require('../services/GameError');
const VillageService = require('../services/VillageService');
const CommandService = require('../services/CommandService');
const MessageService = require('../services/MessageService');
const ReportService = require('../services/ReportService');
const TribeForumService = require('../services/TribeForumService');
const { gameStyleFor } = require('./gameStyles');
const { villageDesignFor } = require('./villageDesigns');
const ShopService = require('../services/ShopService');
const { gameLayoutFor } = require('./gameLayouts');
const { Op } = require('sequelize');
const { User, Village, TribeInvite, Player, Tribe, World } = require('../models');

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

// Routes JSON de la carte servies sans le contexte complet (voir loadVillage).
const MAP_DATA = /^\/map\/(sectors?|mini|world)$/;

/** Vérifie la propriété du village, le rafraîchit et expose le contexte aux vues. */
const loadVillage = ah(async (req, res, next) => {
  // Même instant pour les arrivées résolues et l'état du village : une arrivée ne peut pas tomber entre les deux.
  // Les arrivées d'abord : le village lu ensuite en tient compte (conquête, pillage).
  const now = new Date();
  await CommandService.processDue(now);
  const { village: owned, asSitter } = await VillageService.assertAccess(Number(req.params.villageId), req.user.id);
  req.asSitter = asSitter;
  res.locals.asSitter = asSitter;
  // Données de la carte (JSON lu en continu pendant les déplacements) : ni état du village (transaction avec
  // verrou), ni en-tête de page. Le village et la configuration du monde suffisent.
  if (req.method === 'GET' && MAP_DATA.test(req.path)) {
    const world = await World.findByPk(owned.worldId);
    req.ctx = { village: owned, cfg: world.getConfig() };
    return next();
  }
  // Affichage d'une page : sans échéance passée dans le village, rien à enregistrer, donc ni transaction ni verrou.
  req.ctx = (req.method === 'GET' && await VillageService.peek(owned, now))
    || await VillageService.withVillage(owned.id, async (ctx) => ctx, { now });
  res.locals.ctx = req.ctx;
  const playerId = owned.playerId;
  // Compteurs de l'en-tête : lectures indépendantes, lancées ensemble.
  const [unreadByFilter, myVillages, player, rights, tribeInvites, unreadMessages] = await Promise.all([
    ReportService.unreadByFilter(playerId),
    Village.findAll({ where: { playerId }, attributes: ['id', 'name', 'x', 'y'], order: [['name', 'ASC'], ['id', 'ASC']] }),
    Player.findByPk(playerId, { include: [{ model: Tribe, attributes: ['id', 'tag'] }] }),
    // Thème et design : le choix du compte, s'il le possède sur ce monde (boutique : compte, monde ou serveur entier).
    // Le titulaire a déjà ses droits dans le contexte du village ; un remplaçant garde les siens.
    !asSitter && req.ctx.ownerRights ? req.ctx.ownerRights : ShopService.rightsFor(req.user.id, owned.worldId),
    TribeInvite.count({ where: { playerId } }),
    MessageService.unreadCount(playerId),
  ]);
  const [incomingAttacks, betterPlayers, tribeForumUnread] = await Promise.all([
    CommandService.incomingAttackCount(playerId, myVillages.map((v) => v.id)),
    Player.count({ where: { worldId: player.worldId, points: { [Op.gt]: player.points } } }),
    // Pastille de l'onglet Tribu : invitations reçues, ou sujets non lus du forum de la tribu.
    TribeForumService.unreadCount(player),
  ]);
  Object.assign(res.locals, {
    unreadByFilter, unreadReports: unreadByFilter.all, myVillages, incomingAttacks, player, shopRights: rights,
    gameStyle: gameStyleFor(req.user, rights), villageDesign: villageDesignFor(req.user, rights), gameLayout: gameLayoutFor(req.user),
    playerRank: 1 + betterPlayers, tribeInvites, tribeForumUnread, unreadMessages,
  });
  // Happy hour des Adartons : popup en jeu tant que ce créneau n'a pas été vu par le compte (la popup le signale
  // elle-même en s'ouvrant, POST happy-hour/seen : une requête de fond ne la consomme pas).
  const happy = require('../game/shopCatalog').happyHour(now);
  if (happy.active && req.user.happyHourSeen !== happy.endsAt.toISOString()) res.locals.happyPopup = happy;
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
