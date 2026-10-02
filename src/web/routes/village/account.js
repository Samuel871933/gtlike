'use strict';

// Compte (sommeil, remplaçant) (pages d'un village, montées par ./index.js).

const express = require('express');
const { Player } = require('../../../models');
const AccountService = require('../../../services/AccountService');
const SitterService = require('../../../services/SitterService');
const GameError = require('../../../services/GameError');
const { ah, flash, ownerOnly } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Compte (sommeil, remplaçant)

// Réglages tribu : partage des notes de village.
router.post('/account/tribe-settings', ownerOnly, ah(async (req, res) => {
  const VillageNoteService = require('../../../services/VillageNoteService');
  const values = {};
  for (const item of VillageNoteService.TRIBE_SHARING) for (const col of [item.share, item.show]) values[col] = req.body[col] === '1';
  await VillageNoteService.setTribeSettings(me(req), values);
  flash(req, 'success', 'Réglages tribu enregistrés.');
  res.redirect(`${base(req)}/account#reglages-tribu`);
}));

router.get('/account', ah(async (req, res) => {
  const player = res.locals.player;
  const [sitter, sitting] = await Promise.all([
    player.sitterId ? Player.findByPk(player.sitterId) : null,
    SitterService.sittingFor(player.id),
  ]);
  res.render('account', { page: 'account', sitter, sitting, tribeSharing: require('../../../services/VillageNoteService').TRIBE_SHARING });
}));

router.use('/account', (req, res, next) => (req.method === 'POST' ? ownerOnly(req, res, next) : next()));

// Popup de l'happy hour vue : plus affichée pour ce créneau (une fois par compte).
router.post('/happy-hour/seen', ah(async (req, res) => {
  const happy = require('../../../game/shopCatalog').happyHour(new Date());
  if (happy.active) await req.user.update({ happyHourSeen: happy.endsAt.toISOString() });
  res.status(204).end();
}));

router.post('/account/game-style', ah(async (req, res) => {
  const { isGameStyle, GAME_STYLES } = require('../../gameStyles');
  const id = String(req.body.style || '');
  if (!isGameStyle(id)) throw new GameError('Thème inconnu.');
  if (!res.locals.shopRights.has(`theme:${id}`)) throw new GameError(`Le thème ${GAME_STYLES[id].name} se débloque à la boutique.`);
  await req.user.update({ gameStyle: id });
  flash(req, 'success', `Thème ${GAME_STYLES[id].name} appliqué.`);
  res.redirect(`${base(req)}/account`);
}));

// Style de jeu : densité de l'interface (normal ou minimaliste), indépendante du thème.
router.post('/account/game-layout', ah(async (req, res) => {
  const { isGameLayout, GAME_LAYOUTS } = require('../../gameLayouts');
  const id = String(req.body.layout || '');
  if (!isGameLayout(id)) throw new GameError('Style de jeu inconnu.');
  await req.user.update({ gameLayout: id });
  flash(req, 'success', `Style de jeu ${GAME_LAYOUTS[id].name.toLowerCase()} appliqué.`);
  res.redirect(`${base(req)}/account#style-de-jeu`);
}));

// Design des villages : skin de ses villages sur la carte, vu par tous (réglage du compte, comme le style de jeu).
router.post('/account/village-design', ah(async (req, res) => {
  const { isVillageDesign, VILLAGE_DESIGNS } = require('../../villageDesigns');
  const id = String(req.body.design || '');
  if (!isVillageDesign(id)) throw new GameError('Design de village inconnu.');
  if (!res.locals.shopRights.has(`design:${id}`)) throw new GameError(`Le design ${VILLAGE_DESIGNS[id].name.toLowerCase()} se débloque à la boutique.`);
  await req.user.update({ villageDesign: id });
  flash(req, 'success', `Design ${VILLAGE_DESIGNS[id].name.toLowerCase()} appliqué à tes villages : tous les joueurs les voient ainsi.`);
  res.redirect(`${base(req)}/account#design-villages`);
}));

router.post('/account/sitter', ah(async (req, res) => {
  const sitter = await SitterService.invite(me(req), req.body.name);
  flash(req, 'success', `Demande envoyée à ${sitter.name}.`);
  res.redirect(`${base(req)}/account`);
}));

router.post('/account/sitter/revoke', ah(async (req, res) => {
  await SitterService.revoke(me(req));
  flash(req, 'success', 'Remplaçant retiré.');
  res.redirect(`${base(req)}/account`);
}));

router.post('/account/sitting/:ownerId/accept', ah(async (req, res) => {
  await SitterService.accept(me(req), req.params.ownerId);
  flash(req, 'success', 'Vous êtes maintenant remplaçant de ce joueur.');
  res.redirect(`${base(req)}/account`);
}));

router.post('/account/sitting/:ownerId/resign', ah(async (req, res) => {
  await SitterService.resign(me(req), req.params.ownerId);
  flash(req, 'success', 'Remplacement terminé.');
  res.redirect(`${base(req)}/account`);
}));

router.post('/account/leave-world', ah(async (req, res) => {
  await AccountService.leaveWorld(req.user.id, me(req), req.body.password);
  flash(req, 'success', 'Vous avez quitté ce monde. Vos villages sont devenus barbares.');
  res.redirect('/worlds');
}));

router.post('/account/sleep', ah(async (req, res) => {
  const player = await AccountService.startSleep(me(req), req.body.hours);
  flash(req, 'success', `Sommeil programmé ${res.locals.when(player.sleepStartsAt)}.`);
  res.redirect(`${base(req)}/account`);
}));

router.post('/account/sleep/stop', ah(async (req, res) => {
  await AccountService.stopSleep(me(req));
  flash(req, 'success', 'Mode sommeil arrêté.');
  res.redirect(`${base(req)}/account`);
}));

module.exports = router;
