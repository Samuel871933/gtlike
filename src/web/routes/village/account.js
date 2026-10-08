'use strict';

// Compte (apparence, sommeil, remplaçant…) (pages d'un village, montées par ./index.js).

const express = require('express');
const { Player } = require('../../../models');
const AccountService = require('../../../services/AccountService');
const SitterService = require('../../../services/SitterService');
const GameError = require('../../../services/GameError');
const { ah, flash, ownerOnly } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

// Onglets du menu latéral de la page Compte (un panneau partials/account/<id> chacun) ; `owner` : réservé au titulaire.
const ACCOUNT_TABS = [
  { heading: 'Apparence' },
  { id: 'theme', label: 'Thème de jeu' },
  { id: 'design', label: 'Design des villages' },
  { id: 'layout', label: 'Style de jeu' },
  { id: 'quickbar', label: 'Barre des favoris' },
  { id: 'quests', label: 'Quêtes' },
  { heading: 'Jeu', owner: true },
  { id: 'sleep', label: 'Mode sommeil', owner: true },
  { id: 'sitter', label: 'Mode vacances', owner: true },
  { id: 'tribe-settings', label: 'Réglages tribu', owner: true },
  { heading: 'Monde', owner: true },
  { id: 'leave', label: 'Quitter ce monde', owner: true },
];
const tabUrl = (req, id) => `${base(req)}/account?tab=${id}`;

// ------------------------------------------------------------ Compte (sommeil, remplaçant)

// Réglages tribu : partage des notes de village.
router.post('/account/tribe-settings', ownerOnly, ah(async (req, res) => {
  const VillageNoteService = require('../../../services/VillageNoteService');
  const values = {};
  for (const item of VillageNoteService.TRIBE_SHARING) for (const col of [item.share, item.show]) values[col] = req.body[col] === '1';
  await VillageNoteService.setTribeSettings(me(req), values);
  flash(req, 'success', 'Réglages tribu enregistrés.');
  res.redirect(tabUrl(req, 'tribe-settings'));
}));

router.get('/account', ah(async (req, res) => {
  const player = res.locals.player;
  const [sitter, sitting] = await Promise.all([
    player.sitterId ? Player.findByPk(player.sitterId) : null,
    SitterService.sittingFor(player.id),
  ]);
  const accountTabs = ACCOUNT_TABS.filter((t) => !(req.asSitter && t.owner));
  const tab = accountTabs.some((t) => t.id && t.id === req.query.tab) ? req.query.tab : 'theme';
  // Filtre des thèmes et designs : tous, possédés ou à débloquer.
  const own = ['owned', 'locked'].includes(req.query.own) ? req.query.own : 'all';
  res.render('account', { page: 'account', tab, own, accountTabs, sitter, sitting, tribeSharing: require('../../../services/VillageNoteService').TRIBE_SHARING });
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
  res.redirect(tabUrl(req, 'theme'));
}));

// Style de jeu : densité de l'interface (normal ou minimaliste), indépendante du thème.
router.post('/account/game-layout', ah(async (req, res) => {
  const { isGameLayout, GAME_LAYOUTS } = require('../../gameLayouts');
  const id = String(req.body.layout || '');
  if (!isGameLayout(id)) throw new GameError('Style de jeu inconnu.');
  // Les ombres reviennent au choix par défaut du style (aucune en minimaliste) ; on peut les régler ensuite.
  await req.user.update({ gameLayout: id, gameShadows: null });
  flash(req, 'success', `Style de jeu ${GAME_LAYOUTS[id].name.toLowerCase()} appliqué.`);
  res.redirect(tabUrl(req, 'layout'));
}));

// Ombres portées : avec ou sans, quel que soit le style de jeu et le thème.
router.post('/account/game-shadows', ah(async (req, res) => {
  const on = req.body.shadows === 'on';
  if (!on && req.body.shadows !== 'off') throw new GameError('Réglage inconnu.');
  await req.user.update({ gameShadows: on });
  flash(req, 'success', on ? 'Ombres portées affichées.' : 'Ombres portées retirées.');
  res.redirect(tabUrl(req, 'layout'));
}));

// Encarts de rappel de la quête en cours (réglage du compte) : avec ou sans.
router.post('/account/quest-reminders', ah(async (req, res) => {
  const on = req.body.reminders === 'on';
  if (!on && req.body.reminders !== 'off') throw new GameError('Réglage inconnu.');
  await req.user.update({ questReminders: on });
  flash(req, 'success', on ? 'Rappels des quêtes affichés.' : 'Rappels des quêtes masqués.');
  res.redirect(tabUrl(req, 'quests'));
}));

// Barre des favoris : en-tête, bas de l'écran, colonne à gauche ou à droite (réglage du compte).
router.post('/account/quickbar-position', ah(async (req, res) => {
  const { isQuickbarPosition, QUICKBAR_POSITIONS } = require('../../quickbarPositions');
  const id = String(req.body.position || '');
  if (!isQuickbarPosition(id)) throw new GameError('Emplacement inconnu.');
  await req.user.update({ quickbarPosition: id });
  flash(req, 'success', `Barre des favoris : ${QUICKBAR_POSITIONS[id].name.toLowerCase()}.`);
  res.redirect(tabUrl(req, 'quickbar'));
}));

// Design des villages : skin de ses villages sur la carte, vu par tous (réglage du compte, comme le style de jeu).
router.post('/account/village-design', ah(async (req, res) => {
  const { isVillageDesign, VILLAGE_DESIGNS } = require('../../villageDesigns');
  const id = String(req.body.design || '');
  if (!isVillageDesign(id)) throw new GameError('Design de village inconnu.');
  if (!res.locals.shopRights.has(`design:${id}`)) throw new GameError(`Le design ${VILLAGE_DESIGNS[id].name.toLowerCase()} se débloque à la boutique.`);
  await req.user.update({ villageDesign: id });
  flash(req, 'success', `Design ${VILLAGE_DESIGNS[id].name.toLowerCase()} appliqué à tes villages : tous les joueurs les voient ainsi.`);
  res.redirect(tabUrl(req, 'design'));
}));

router.post('/account/sitter', ah(async (req, res) => {
  const sitter = await SitterService.invite(me(req), req.body.name);
  flash(req, 'success', `Demande envoyée à ${sitter.name}.`);
  res.redirect(tabUrl(req, 'sitter'));
}));

router.post('/account/sitter/revoke', ah(async (req, res) => {
  await SitterService.revoke(me(req));
  flash(req, 'success', 'Remplaçant retiré.');
  res.redirect(tabUrl(req, 'sitter'));
}));

router.post('/account/sitting/:ownerId/accept', ah(async (req, res) => {
  await SitterService.accept(me(req), req.params.ownerId);
  flash(req, 'success', 'Vous êtes maintenant remplaçant de ce joueur.');
  res.redirect(tabUrl(req, 'sitter'));
}));

router.post('/account/sitting/:ownerId/resign', ah(async (req, res) => {
  await SitterService.resign(me(req), req.params.ownerId);
  flash(req, 'success', 'Remplacement terminé.');
  res.redirect(tabUrl(req, 'sitter'));
}));

router.post('/account/leave-world', ah(async (req, res) => {
  await AccountService.leaveWorld(req.user.id, me(req), req.body.password);
  flash(req, 'success', 'Vous avez quitté ce monde. Vos villages sont devenus barbares.');
  res.redirect('/worlds');
}));

router.post('/account/sleep', ah(async (req, res) => {
  const player = await AccountService.startSleep(me(req), req.body.hours);
  flash(req, 'success', `Sommeil programmé ${res.locals.when(player.sleepStartsAt)}.`);
  res.redirect(tabUrl(req, 'sleep'));
}));

router.post('/account/sleep/stop', ah(async (req, res) => {
  await AccountService.stopSleep(me(req));
  flash(req, 'success', 'Mode sommeil arrêté.');
  res.redirect(tabUrl(req, 'sleep'));
}));

module.exports = router;
