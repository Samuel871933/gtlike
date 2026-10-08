'use strict';

// Sceaux (module features.seals, les drapeaux de GT) : page en onglets comme sur Guerre Tribale (Aperçu, Échange,
// Historique, Mes villages, Aide) ; un clic sur un sceau le pose sur le village, la flèche rouge fusionne trois sceaux.
// Pages d'un village, montées par ./index.js. Le remplaçant voit la page mais ne peut rien changer.

const express = require('express');
const { sequelize, Player, Village } = require('../../../models');
const SealService = require('../../../services/SealService');
const GameError = require('../../../services/GameError');
const seals = require('../../../game/seals');
const { ah, flash, ownerOnly } = require('../../middleware');
const { base, me, currentPlayer } = require('./shared');

const router = express.Router({ mergeParams: true });
const TABS = ['overview', 'trade', 'history', 'villages', 'help'];

router.use('/seals', (req, res, next) => {
  if (!SealService.enabled(req.ctx.cfg)) return next(new GameError('Les sceaux ne sont pas actifs sur ce monde.', 404));
  return req.method === 'POST' ? ownerOnly(req, res, next) : next();
});

const sealOf = (type, level) => (seals.isType(type) && seals.isLevel(Number(level)) ? { type, level: Number(level) } : null);
const back = (req, tab) => `${base(req)}/seals${tab && tab !== 'overview' ? `?tab=${tab}` : ''}`;

router.get('/seals', ah(async (req, res) => {
  const { village, world, cfg } = req.ctx;
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'overview';
  let player = currentPlayer(res);
  const canEarn = SealService.canEarn(world);
  // Paliers d'unités vaincues déjà franchis (unités tuées avant les sceaux, ou depuis le dernier combat) : rattrapés ici.
  if (canEarn && !req.asSitter && (player.stats?.unitsKilled || 0) >= SealService.killsNeeded(player.stats?.sealKillSteps || 0)) {
    await sequelize.transaction((t) => SealService.onKills(player.id, { t }));
    player = await Player.findByPk(player.id);
  }
  const [inventory, villages, offers, history, progress] = await Promise.all([
    SealService.inventory(player.userId),
    tab === 'villages' ? Village.findAll({ where: { playerId: player.id }, attributes: ['id', 'name', 'x', 'y', 'sealType', 'sealLevel', 'sealAt'], order: [['name', 'ASC'], ['id', 'ASC']] }) : [],
    tab === 'trade' && canEarn ? SealService.offers(player) : [],
    tab === 'history' ? SealService.history(player.userId, { page: req.query.page }) : null,
    tab === 'overview' && canEarn ? SealService.progress(player) : null,
  ]);
  res.render('seals', {
    page: 'seals', tab, inventory, villages, offers, history, progress, canEarn, sealPlayer: player,
    // Sceau choisi dans la grille (?t=type&l=niveau) : aperçu et actions, rien ne se pose sans « Équiper ».
    selected: sealOf(req.query.t, req.query.l),
    current: seals.of(village, cfg), lockedUntil: SealService.lockedUntil(village, cfg), SOURCES: SealService.SOURCES,
  });
}));

router.post('/seals/assign', ah(async (req, res) => {
  const sel = sealOf(req.body.type, req.body.level);
  if (!sel) throw new GameError('Sceau inconnu.');
  await SealService.assign(me(req), req.ctx.village.id, sel);
  flash(req, 'success', `Sceau ${seals.label(sel).toLowerCase()} posé sur ${req.ctx.village.name}.`);
  res.redirect(back(req));
}));

router.post('/seals/remove', ah(async (req, res) => {
  await SealService.remove(me(req), req.ctx.village.id);
  flash(req, 'success', 'Sceau retiré : il redevient libre.');
  res.redirect(back(req));
}));

router.post('/seals/remove-all', ah(async (req, res) => {
  const { removed, kept } = await SealService.removeAll(me(req));
  const still = kept.length ? ` ${kept.length} sceau${kept.length > 1 ? 'x restent' : ' reste'} en place (posé${kept.length > 1 ? 's' : ''} depuis moins de ${req.ctx.cfg.seals.lockHours} h ou ferme pleine).` : '';
  flash(req, removed ? 'success' : 'error', `${removed} sceau${removed > 1 ? 'x retirés' : ' retiré'}.${still}`);
  res.redirect(back(req, 'villages'));
}));

router.post('/seals/merge', ah(async (req, res) => {
  const player = currentPlayer(res);
  const made = await SealService.merge(player.userId, { type: req.body.type, level: req.body.level });
  flash(req, 'success', `Fusion réussie : sceau ${seals.label(made).toLowerCase()} obtenu.`);
  res.redirect(back(req));
}));

router.post('/seals/offers', ah(async (req, res) => {
  const [giveType, level] = String(req.body.give || '').split(':');
  await SealService.propose(me(req), { giveType, wantType: req.body.want, level, count: req.body.count });
  flash(req, 'success', 'Offre d’échange publiée pour ta tribu.');
  res.redirect(back(req, 'trade'));
}));

router.post('/seals/offers/:id/accept', ah(async (req, res) => {
  await SealService.accept(me(req), req.params.id, req.body.count);
  flash(req, 'success', 'Échange conclu.');
  res.redirect(back(req, 'trade'));
}));

router.post('/seals/offers/:id/cancel', ah(async (req, res) => {
  await SealService.cancel(me(req), req.params.id);
  flash(req, 'success', 'Offre retirée.');
  res.redirect(back(req, 'trade'));
}));

module.exports = router;
