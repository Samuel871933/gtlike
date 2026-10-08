'use strict';

const GameError = require('../services/GameError');
const VillageService = require('../services/VillageService');
const CommandService = require('../services/CommandService');
const EventService = require('../services/EventService');
const MessageService = require('../services/MessageService');
const ReportService = require('../services/ReportService');
const TribeForumService = require('../services/TribeForumService');
const BuildRewardService = require('../services/BuildRewardService');
const TutorialService = require('../services/TutorialService');
const { gameStyleFor } = require('./gameStyles');
const { memo } = require('./memo');
const { villageDesignFor } = require('./villageDesigns');
const ShopService = require('../services/ShopService');
const VillageGroupService = require('../services/VillageGroupService');
const { gameLayoutFor, shadowsFor } = require('./gameLayouts');
const { User, Village, VillageGroupMember, TribeInvite, Player, Tribe } = require('../models');

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

/** Adresse de retour après connexion : seulement une page de notre site (pas de redirection ouverte). */
function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : null;
}

/** Page réservée aux comptes connectés : sinon la connexion, puis retour à la page demandée (GET) ou précédente. */
function requireAuth(req, res, next) {
  if (req.user) return next();
  const target = req.method === 'GET' ? req.originalUrl : back(req, null);
  res.redirect(target ? `/login?${new URLSearchParams({ next: target })}` : '/login');
}

// Routes JSON (carte, alertes d'attaques) servies sans le contexte complet (voir loadVillage).
const MAP_DATA = /^\/(map\/(sectors?|mini|world)|alerts)$/;

/**
 * Place du village courant dans les villages parcourus (ceux du groupe actif) : rang, villages précédent et suivant
 * (en boucle). Hors du groupe : les flèches mènent au dernier et au premier village du groupe.
 */
function villageNav(list, currentId) {
  const idx = list.findIndex((v) => v.id === currentId);
  const others = list.filter((v) => v.id !== currentId);
  if (!others.length) return { idx, prev: null, next: null, count: list.length };
  if (idx < 0) return { idx, prev: list[list.length - 1], next: list[0], count: list.length };
  return { idx, prev: list[(idx - 1 + list.length) % list.length], next: list[(idx + 1) % list.length], count: list.length };
}

/** Adresse de la page courante avec un autre groupe actif (id, ou '' pour tous les villages), sans numéro de page. */
function groupHref(req) {
  return (id) => {
    const url = new URL(req.originalUrl, 'http://local');
    url.searchParams.set('group', id || '0');
    url.searchParams.delete('page');
    return url.pathname + url.search;
  };
}

/**
 * Joueurs du monde qui ont plus de points (rang de l'en-tête : 1 + ce nombre). Points de tout le monde triés, gardés 30 s
 * et partagés par toutes les pages : un COUNT par page parcourait jusqu'à tous les joueurs d'un grand monde.
 */
async function betterThan(player) {
  const points = await memo(`pointsDesc:${player.worldId}`, 30000, async () => (
    await Player.findAll({ where: { worldId: player.worldId }, attributes: ['points'], order: [['points', 'DESC']], raw: true })
  ).map((p) => p.points));
  // Premier indice dont les points ne dépassent pas ceux du joueur : autant de joueurs devant lui.
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] > player.points) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Compteurs de l'en-tête d'une page du jeu. */
async function headerCounters(res, player, myVillages, cfg) {
  const playerId = player.id;
  const [unreadByFilter, tribeInvites, unreadMessages, incomingAttacks, betterPlayers, tribeForumUnread, rewardsPending, questHints] = await Promise.all([
    ReportService.unreadByFilter(playerId),
    TribeInvite.count({ where: { playerId } }),
    MessageService.unreadCount(playerId),
    CommandService.incomingAttackCount(playerId, myVillages.map((v) => v.id)),
    betterThan(player),
    // Pastille de l'onglet Tribu : invitations reçues, ou sujets non lus du forum de la tribu.
    TribeForumService.unreadCount(player),
    // Récompenses de construction à récupérer (bouton à gauche de la barre du village).
    BuildRewardService.pendingCount(playerId),
    // Quête en cours du tutoriel : boutons et liens à faire clignoter (game.js).
    TutorialService.hints(player, cfg),
  ]);
  Object.assign(res.locals, {
    unreadByFilter, unreadReports: unreadByFilter.all, incomingAttacks, playerRank: 1 + betterPlayers, tribeInvites, tribeForumUnread, unreadMessages, rewardsPending, questHints,
  });
}

/** `load` lancé au premier res.render de la réponse (page, ou morceau de page renvoyé en JSON), qui l'attend. */
function deferUntilRender(res, load) {
  const render = res.render.bind(res);
  let loading = null;
  res.render = (...args) => {
    loading = loading || load().catch((err) => console.error(err));
    loading.then(() => render(...args));
  };
}

/** Vérifie la propriété du village, le rafraîchit et expose le contexte aux vues. */
const loadVillage = ah(async (req, res, next) => {
  // Même instant pour les arrivées résolues et l'état du village : une arrivée ne peut pas tomber entre les deux.
  // Les arrivées d'abord : le village lu ensuite en tient compte (conquête, pillage). Seulement si l'une concerne les
  // villages du joueur : sinon la page n'attend pas le traitement global (boucle de jeu, autres joueurs), qui passe
  // par un verrou commun à tout le processus. Après traitement, l'accès est revérifié (village conquis entre-temps).
  const now = new Date();
  const villageId = Number(req.params.villageId);
  let access = await VillageService.assertAccess(villageId, req.user.id);
  if (await EventService.dueFor(access.village.playerId, now)) {
    // Une tranche au plus, et seulement si personne ne traite déjà ce monde : en surcharge, la page s'affiche avec l'état
    // connu (quelques secondes de retard) plutôt que d'attendre derrière l'arriéré, que ce traitement en cours résorbe.
    await CommandService.processDue(now, { worldId: access.village.worldId, max: EventService.CHUNK, ifIdle: true });
    access = await VillageService.assertAccess(villageId, req.user.id);
  }
  const { village: owned, asSitter } = access;
  // Partie du matchup terminée (temps écoulé, conquête, abandon) : plus rien ne se joue, écran de fin de partie.
  const ownedWorld = await VillageService.cachedWorld(owned.worldId);
  if (ownedWorld.access === 'match') {
    const ended = await require('../services/MatchService').endedFor(ownedWorld, now);
    if (ended) {
      const url = `/matchup/partie/${ended.id}`;
      return req.get('accept') === 'application/json' ? res.status(409).json({ error: 'La partie est terminée.', url }) : res.redirect(url);
    }
  }
  req.asSitter = asSitter;
  res.locals.asSitter = asSitter;
  // Chemin de la page (sans paramètres) : l'encart de quête de l'en-tête ne s'affiche que sur les pages concernées.
  res.locals.currentPath = req.originalUrl.split('?')[0].replace(/\/$/, '');
  // Données de la carte (JSON lu en continu pendant les déplacements) : ni état du village (transaction avec
  // verrou), ni en-tête de page. Le village et la configuration du monde suffisent.
  if (req.method === 'GET' && MAP_DATA.test(req.path)) {
    const world = await VillageService.cachedWorld(owned.worldId);
    req.ctx = { village: owned, cfg: world.getConfig() };
    return next();
  }
  // Sans échéance passée dans le village, rien à enregistrer, donc ni transaction ni verrou. Vaut aussi pour les
  // actions : chacune reprend le village sous verrou dans son service (withVillage), req.ctx ne sert qu'à lire.
  req.ctx = await VillageService.peek(owned, now)
    || await VillageService.withVillage(owned.id, async (ctx) => ctx, { now });
  res.locals.ctx = req.ctx;
  // Partie du matchup : barre de la partie (équipes, score, temps restant) en haut des pages.
  res.locals.inMatch = req.ctx.world.access === 'match';
  if (req.method === 'GET' && res.locals.inMatch) res.locals.matchBar = await require('../services/MatchService').forWorld(req.ctx.world);
  const playerId = owned.playerId;
  const [myVillages, player, rights] = await Promise.all([
    Village.findAll({ where: { playerId }, attributes: ['id', 'name', 'x', 'y'], order: [['name', 'ASC'], ['id', 'ASC']] }),
    Player.findByPk(playerId, { include: [{ model: Tribe, attributes: ['id', 'tag'] }] }),
    // Thème et design : le choix du compte, s'il le possède sur ce monde (boutique : compte, monde ou serveur entier).
    // Le titulaire a déjà ses droits dans le contexte du village ; un remplaçant garde les siens.
    !asSitter && req.ctx.ownerRights ? req.ctx.ownerRights : ShopService.rightsFor(req.user.id, owned.worldId),
  ]);
  // Groupe de villages actif (contexte, comme sur GT) : choisi par ?group= sur une page (menu des groupes des aperçus,
  // de l'en-tête), il ne fait parcourir que ses villages aux flèches et à la liste de l'en-tête.
  if (req.method === 'GET' && req.query.group !== undefined) {
    // Groupe inconnu (supprimé, lien d'un autre joueur) : retour à tous les villages.
    player.villageGroupId = await VillageGroupService.select(playerId, req.query.group).catch(() => VillageGroupService.select(playerId, ''));
  }
  const [groups, villageGroupRows] = await Promise.all([
    VillageGroupService.context(player),
    VillageGroupMember.findAll({ where: { villageId: owned.id }, attributes: ['groupId'], raw: true }),
  ]);
  // Groupes proposés par la liste de l'en-tête : ceux du village courant, et le groupe actif (contexte en cours).
  const currentGroupIds = new Set(villageGroupRows.map((r) => r.groupId));
  const headerGroups = groups.groups.filter((g) => currentGroupIds.has(g.id) || (groups.active && g.id === groups.active.id));
  const navVillages = groups.ids ? myVillages.filter((v) => groups.ids.includes(v.id)) : myVillages;
  // Dernière page vue par le titulaire (à la minute près) : notifications d'attaque « seulement si je ne suis pas connecté ».
  if (!asSitter && (!player.lastSeenAt || now - player.lastSeenAt >= 60000)) {
    await Player.update({ lastSeenAt: now }, { where: { id: playerId }, silent: true });
  }
  Object.assign(res.locals, {
    myVillages, villageGroups: groups.groups, headerGroups, activeGroup: groups.active, navVillages, villageNav: villageNav(navVillages, owned.id), groupHref: groupHref(req), player, shopRights: rights,
    gameStyle: gameStyleFor(req.user, rights), villageDesign: villageDesignFor(req.user, rights, asSitter ? null : player.faction), gameLayout: gameLayoutFor(req.user),
    gameShadows: shadowsFor(req.user),
    quickbarPos: require('./quickbarPositions').quickbarPositionFor(req.user),
  });
  // Compteurs de l'en-tête (rapports, messages, attaques, rang, forum, invitations) : lus d'avance pour une page,
  // sinon (action, réponse JSON) seulement si la réponse rend une vue — une redirection ne les affiche pas.
  if (req.method === 'GET' && req.get('accept') !== 'application/json') await headerCounters(res, player, myVillages, req.ctx.cfg);
  else deferUntilRender(res, () => headerCounters(res, player, myVillages, req.ctx.cfg));
  // Happy hour des Adartons : popup en jeu tant que ce créneau n'a pas été vu par le compte (la popup le signale
  // elle-même en s'ouvrant, POST happy-hour/seen : une requête de fond ne la consomme pas).
  const happy = require('../game/shopCatalog').happyHour(now);
  if (happy.active && req.user.happyHourSeen !== happy.endsAt.toISOString()) res.locals.happyPopup = happy;
  next();
});

/**
 * Erreurs métier : sur un POST, message flash et retour à la page ; sinon page d'erreur.
 */
/** Valeurs par défaut des vues (en-tête hors partie), posées pour chaque requête et par la page d'erreur. */
const BASE_LOCALS = () => ({
  ctx: null, page: null, unreadReports: 0, unreadByFilter: {}, incomingAttacks: 0, myVillages: [], navVillages: [], villageGroups: [], headerGroups: [], activeGroup: null, villageNav: null, groupHref: () => '', tribeInvites: 0, unreadMessages: 0, rewardsPending: 0, questHints: null, currentPath: '', player: null,
  playerRank: null, gameStyle: null, villageDesign: null, gameLayout: null, gameShadows: true, quickbarPos: 'top', asSitter: false, happyPopup: null,
  inMatch: false, matchBar: null,
});

function errorHandler(err, req, res, _next) {
  // Erreur levée avant les valeurs des vues (lecture du formulaire, session) : la page d'erreur doit quand même s'afficher.
  if (!('ctx' in res.locals)) Object.assign(res.locals, require('./helpers'), BASE_LOCALS(), { now: new Date(), csrfToken: '', seo: null, user: null, flash: null });
  // Formulaire refusé par la lecture du corps (trop de champs, trop lourd) : message clair plutôt qu'une erreur interne.
  if (err.type === 'parameters.too.many' || err.type === 'entity.too.large') {
    err = new GameError('Formulaire trop volumineux : sélectionnez moins d’éléments à la fois.', 413);
  }
  // Appel AJAX (accept: application/json) : l'erreur en JSON, le script affiche le message sans quitter la page.
  if (req.get('accept') === 'application/json') {
    if (!(err instanceof GameError)) console.error(err);
    return res.status(err instanceof GameError ? err.status : 500).json({ error: err instanceof GameError ? err.message : 'Erreur interne du serveur.' });
  }
  if (err instanceof GameError) {
    // Sur un POST, un « introuvable » vient le plus souvent d'un objet disparu entre l'affichage et le clic
    // (construction terminée, offre déjà prise…) : retour sur la page avec le message, comme les autres refus.
    if (req.method === 'POST' && req.session && err.status < 500) {
      flash(req, 'error', err.message);
      return res.redirect(back(req));
    }
    return res.status(err.status).render('error', { message: err.message });
  }
  console.error(err);
  res.status(500).render('error', { message: 'Erreur interne du serveur.' });
}

module.exports = { ah, back, flash, loadUser, requireAuth, safeNext, loadVillage, ownerOnly, errorHandler, BASE_LOCALS };
