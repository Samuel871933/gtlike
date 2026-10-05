'use strict';

// Profils des joueurs et messagerie (pages d'un village, montées par ./index.js).

const express = require('express');
const { Player, Village, Tribe } = require('../../../models');
const MapService = require('../../../services/MapService');
const TribeService = require('../../../services/TribeService');
const MessageService = require('../../../services/MessageService');
const AchievementService = require('../../../services/AchievementService');
const DailyService = require('../../../services/DailyService');
const ArmyTemplateService = require('../../../services/ArmyTemplateService');
const FavoriteService = require('../../../services/FavoriteService');
const mapView = require('../../mapView');
const ImageService = require('../../../services/ImageService');
const PaginationService = require('../../../services/PaginationService');
const GameError = require('../../../services/GameError');
const registry = require('../../../game/registry');
const combat = require('../../../game/combat');
const { ah, back, flash, ownerOnly } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Joueurs et messagerie

router.get('/players/:playerId', ah(async (req, res) => {
  const profile = await MapService.playerProfile(req.ctx.village.worldId, req.params.playerId);
  if (!profile) throw new GameError('Joueur introuvable.', 404);
  const achievements = await AchievementService.overview(profile.player.id);
  const daily = await DailyService.countsFor(profile.player.id);
  const isMe = profile.player.id === me(req);
  // Invitation possible depuis le profil : on dirige une tribu et le joueur n'en fait pas partie.
  const viewer = await Player.findByPk(me(req), { attributes: ['id', 'tribeId', 'tribeRole', 'tribeRights', 'faction'] });
  const canInvite = !isMe && TribeService.can(viewer, 'invite') && profile.player.tribeId !== viewer.tribeId
    // Monde à factions : une tribu n'accueille que sa faction (celle de ses membres).
    && profile.player.faction === viewer.faction;
  // `subject` et non `player` : `player` est le joueur connecté, utilisé par l'en-tête.
  const { player: subject, ...rest } = profile;
  // Le contenu du profil s'affiche dans le thème de jeu de son propriétaire (les bots, sans compte, ont le thème par
  // défaut) ; l'en-tête et le pied de page gardent celui du visiteur.
  const owner = subject.userId ? await require('../../../models').User.findByPk(subject.userId, { attributes: ['gameStyle'] }) : null;
  const ownerRights = await require('../../../services/ShopService').rightsFor(subject.userId, subject.worldId);
  const ownerStyle = require('../../gameStyles').gameStyleFor(owner, ownerRights);
  const profileStyle = ownerStyle.id === res.locals.gameStyle?.id ? null : ownerStyle;
  res.render('player', { ...rest, subject, profileStyle, ownerPremium: ownerRights.premium, page: isMe ? 'profile' : null, achievements, daily, TIER_NAMES: AchievementService.TIER_NAMES, isMe, canInvite });
}));

// Texte personnel du profil (réservé au titulaire du compte, pas au remplaçant).
router.post('/profile/text', ownerOnly, ah(async (req, res) => {
  const text = String(req.body.profileText || '').replace(/\r\n/g, '\n').trim();
  if (text.length > 2000) throw new GameError('Le texte personnel est limité à 2 000 caractères.');
  await Player.update({ profileText: text || null }, { where: { id: me(req) } });
  flash(req, 'success', 'Profil mis à jour.');
  res.redirect(`${base(req)}/players/${me(req)}`);
}));

// Image du profil (titulaire du compte seulement) : réduite et convertie en WebP, l'original n'est pas gardé.
// Réservée au premium, comme le blason du profil sur Guerre Tribale ; la supprimer reste toujours possible.
router.post('/profile/avatar', ownerOnly, ah(async (req, res) => {
  if (!req.ctx.premium) throw new GameError('L’image de profil est réservée au premium.');
  if (!req.file) throw new GameError('Choisissez une image.');
  await ImageService.replaceAvatar(await Player.findByPk(me(req)), 'player', req.file.buffer);
  flash(req, 'success', 'Image du profil enregistrée.');
  res.redirect(`${base(req)}/players/${me(req)}`);
}));
router.post('/profile/avatar/delete', ownerOnly, ah(async (req, res) => {
  await ImageService.replaceAvatar(await Player.findByPk(me(req)), 'player', null);
  flash(req, 'success', 'Image du profil supprimée.');
  res.redirect(`${base(req)}/players/${me(req)}`);
}));

// Inviter des joueurs : lien d'inscription à partager.
router.get('/invite', (req, res) => {
  res.render('invite', { page: 'invite', registerUrl: `${req.protocol}://${req.get('host')}/register` });
});

// Favoris de la carte : ajout ou retrait d'un village.
router.post('/favorites/:villageId', ah(async (req, res) => {
  const on = await FavoriteService.toggle(me(req), req.ctx.village.worldId, req.params.villageId);
  flash(req, 'success', on ? 'Village ajouté aux favoris.' : 'Village retiré des favoris.');
  res.redirect(back(req, `${base(req)}/map`));
}));

// Informations sur un village (menu de la carte : « Voir le village »).
/**
 * Aperçu d'un village, comme sur GT : fiche et mini-carte, actions, carnet de notes, tes ordres en cours vers ce
 * village et tes rapports qui le concernent.
 */
// Village désigné par ses coordonnées (libellés « nom (x|y) » des anciens rapports, voir villageLabelLink).
router.get('/villages/at', ah(async (req, res) => {
  const target = await Village.findOne({ where: { worldId: req.ctx.village.worldId, x: Number(req.query.x) || 0, y: Number(req.query.y) || 0 }, attributes: ['id'] });
  if (!target) throw new GameError('Aucun village à ces coordonnées.', 404);
  res.redirect(`${base(req)}/villages/${target.id}`);
}));

router.get('/villages/:villageId', ah(async (req, res) => {
  const { Report, VillageNote, Command } = require('../../../models');
  const target = await Village.findOne({
    where: { id: Number(req.params.villageId), worldId: req.ctx.village.worldId },
    include: [{ model: Player, include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
  });
  if (!target) throw new GameError('Village introuvable.', 404);
  const playerId = req.ctx.village.playerId;
  const me = await Player.findByPk(playerId, { attributes: ['id', 'tribeId', 'points'] });
  const relations = await TribeService.relationsOf(me.tribeId);
  const tribeId = target.Player && target.Player.tribeId;
  const relation = !target.playerId ? 'barb' : target.playerId === playerId ? 'own' : (tribeId && relations.get(tribeId)) || 'other';
  // Durées de trajet de toutes les unités du monde depuis le village courant.
  const dist = Math.hypot(target.x - req.ctx.village.x, target.y - req.ctx.village.y);
  const travel = registry.unitsFor(req.ctx.cfg).map((u) => ({ id: u.id, seconds: Math.round(dist * u.minutesPerField(req.ctx.cfg) * 60) }));
  const favorite = (await FavoriteService.list(playerId)).some((f) => f.villageId === target.id);
  const morale = req.ctx.cfg.moral && target.Player && target.playerId !== playerId
    ? (require('../../../game/runes').moraleApplies(req.ctx.cfg, target) ? combat.morale(me.points, target.Player.points, true) : 1) : null;

  // Tes ordres vers ce village (attaques, soutiens) et les retours qui en reviennent, depuis n'importe lequel de tes villages.
  const myIds = res.locals.myVillages.map((v) => v.id);
  const commands = await Command.findAll({
    where: { targetVillageId: target.id, originVillageId: myIds },
    include: [{ association: 'origin', attributes: ['id', 'name', 'x', 'y'] }],
    order: [['arrivesAt', 'ASC']],
  });

  // Tes rapports sur ce village (combats, soutiens, commerce), les plus récents d'abord.
  const concerns = (d) => [d.defender && d.defender.villageId, d.attacker && d.attacker.villageId, d.seller && d.seller.villageId,
    d.buyer && d.buyer.villageId, d.sender && d.sender.villageId, d.recipient && d.recipient.villageId].includes(target.id);
  const recent = await Report.findAll({
    where: { playerId, type: ['attack', 'defense', 'support', 'trade'] }, order: [['happenedAt', 'DESC'], ['id', 'DESC']], limit: 500,
  });
  const reports = recent.filter((r) => concerns(r.data || {})).slice(0, 25);

  // Mini-carte de 61 × 61 cases centrée sur le village (même rendu que la carte), le village encadré.
  const vc = await mapView.viewContext(req.ctx.village, req.ctx.cfg);
  const half = 30;
  const mini = { x0: target.x - half, y0: target.y - half, width: 2 * half + 1, height: 2 * half + 1 };
  mini.villages = await mapView.mini(vc, mini.x0, mini.y0, mini.width);
  mini.frame = { x: target.x - 1, y: target.y - 1, size: 3 };

  const note = await VillageNote.findOne({ where: { playerId, villageId: target.id } });
  // Notes de la tribu sur ce village (si tu affiches les notes partagées par ta tribu).
  const viewer = await Player.findByPk(playerId, { attributes: ['id', 'tribeId', 'showTribeNotes'] });
  const tribeNotes = ((await require('../../../services/VillageNoteService').visible(viewer, [target.id])).get(target.id) || []).filter((n) => !n.mine);
  // Ordres entrants renommés ou annotés par un membre de la tribu sur son village (mêmes réglages que les notes).
  const sharedIncomings = await require('../../../services/IncomingService').sharedFor(viewer, target);
  res.render('village-info', {
    page: null, target, relation, dist, travel, favorite, morale, commands, reports, mini, sharedIncomings,
    note: note ? note.text : '', tribeNotes, showTribeNotes: viewer.showTribeNotes, templates: await ArmyTemplateService.list(playerId),
  });
}));

// Carnet de notes d'un village (aperçu du village) ; une note vide l'efface.
router.post('/villages/:villageId/note', ah(async (req, res) => {
  const { VillageNote } = require('../../../models');
  const target = await Village.findOne({ where: { id: Number(req.params.villageId), worldId: req.ctx.village.worldId }, attributes: ['id'] });
  if (!target) throw new GameError('Village introuvable.', 404);
  const text = String(req.body.text || '').replace(/\r\n/g, '\n').trim();
  if (text.length > 2000) throw new GameError('La note est limitée à 2 000 caractères.');
  const where = { playerId: me(req), villageId: target.id };
  if (!text) await VillageNote.destroy({ where });
  else {
    const [note, created] = await VillageNote.findOrCreate({ where, defaults: { text } });
    if (!created) await note.update({ text });
  }
  flash(req, 'success', text ? 'Note enregistrée.' : 'Note effacée.');
  res.redirect(`${base(req)}/villages/${target.id}`);
}));

// Messagerie, organisée comme sur GT : boîte de réception, courriers circulaires envoyés, écrire un message.
router.get('/messages', ah(async (req, res) => {
  const player = await Player.findByPk(me(req));
  const perPage = PaginationService.perPage(player, 'messages');
  const inbox = await MessageService.inbox(player.id, { page: req.query.page, perPage, search: req.query.q });
  res.render('messages', { page: 'messages', tab: 'inbox', inbox, perPage });
}));

router.get('/messages/circular', ah(async (req, res) => {
  res.render('messages', { page: 'messages', tab: 'circular', circulars: await MessageService.circulars(me(req)) });
}));

/** Formulaire d'écriture ; `form` garde la saisie quand l'envoi est refusé. */
async function renderNewMessage(req, res, form, status = 200) {
  const player = await Player.findByPk(me(req));
  res.status(status).render('message-new', {
    page: 'messages', tab: 'new', form, max: MessageService.MAX_RECIPIENTS, groups: MessageService.groupsFor(player),
  });
}

router.get('/messages/new', ah(async (req, res) => {
  await renderNewMessage(req, res, { to: String(req.query.to || ''), group: '', subject: '', body: '' });
}));

router.post('/messages', ah(async (req, res) => {
  const form = { to: String(req.body.to || ''), group: String(req.body.group || ''), subject: String(req.body.subject || ''), body: String(req.body.body || '') };
  try {
    const conv = await MessageService.start(me(req), form);
    res.redirect(`${base(req)}/messages/${conv.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status >= 500) throw err;
    res.locals.flash = { type: 'error', message: err.message };
    await renderNewMessage(req, res, form, 422);
  }
}));

router.post('/messages/delete', ah(async (req, res) => {
  const n = await MessageService.leaveMany(me(req), req.body.ids);
  flash(req, 'success', n > 1 ? `${n} conversations effacées.` : 'Conversation effacée.');
  res.redirect(back(req, `${base(req)}/messages`));
}));


router.get('/messages/:conversationId', ah(async (req, res) => {
  const conversation = await MessageService.read(me(req), req.params.conversationId);
  res.locals.unreadMessages = await MessageService.unreadCount(me(req));
  res.render('conversation', { page: 'messages', conversation, MessageGroups: MessageService.GROUPS });
}));

router.post('/messages/:conversationId/reply', ah(async (req, res) => {
  await MessageService.reply(me(req), req.params.conversationId, req.body.body);
  res.redirect(`${base(req)}/messages/${Number(req.params.conversationId)}#bas`);
}));

router.post('/messages/:conversationId/leave', ah(async (req, res) => {
  await MessageService.leave(me(req), req.params.conversationId);
  flash(req, 'success', 'Conversation supprimée de votre boîte.');
  res.redirect(`${base(req)}/messages`);
}));

module.exports = router;
