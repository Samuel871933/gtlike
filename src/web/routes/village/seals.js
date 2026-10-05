'use strict';

// Sceaux (module features.seals, les drapeaux de GT) : inventaire du compte, pose sur le village, fusion, échanges en
// tribu (pages d'un village, montées par ./index.js). Le remplaçant voit la page mais ne peut rien changer.

const express = require('express');
const { Player, Village } = require('../../../models');
const SealService = require('../../../services/SealService');
const GameError = require('../../../services/GameError');
const seals = require('../../../game/seals');
const { ah, flash, ownerOnly } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

router.use('/seals', (req, res, next) => {
  if (!SealService.enabled(req.ctx.cfg)) return next(new GameError('Les sceaux ne sont pas actifs sur ce monde.', 404));
  return req.method === 'POST' ? ownerOnly(req, res, next) : next();
});

const pick = (q) => (seals.isType(q.t) && seals.isLevel(Number(q.l)) ? { type: q.t, level: Number(q.l) } : null);
const back = (req, sel) => `${base(req)}/seals${sel ? `?t=${sel.type}&l=${sel.level}` : ''}`;

router.get('/seals', ah(async (req, res) => {
  const { village, world, cfg } = req.ctx;
  const player = await Player.findByPk(me(req));
  const canEarn = SealService.canEarn(world);
  const [inventory, villages, trades, members, history, progress] = await Promise.all([
    SealService.inventory(player.userId),
    Village.findAll({ where: { playerId: player.id }, attributes: ['id', 'name', 'x', 'y', 'sealType', 'sealLevel', 'sealAt'], order: [['name', 'ASC'], ['id', 'ASC']] }),
    canEarn ? SealService.trades(player.userId, world.id) : [],
    canEarn && player.tribeId ? Player.findAll({ where: { tribeId: player.tribeId, isBot: false }, attributes: ['id', 'name'], order: [['name', 'ASC']] }) : [],
    SealService.history(player.userId),
    canEarn ? SealService.progress(player) : null,
  ]);
  const current = seals.of(village, cfg);
  const selected = pick(req.query) || current || null;
  res.render('seals', {
    page: null, inventory, villages, trades, members: members.filter((m) => m.id !== player.id), history, progress, canEarn,
    current, selected, lockedUntil: SealService.lockedUntil(village, cfg), killsNeeded: SealService.killsNeeded, SOURCES: SealService.SOURCES,
  });
}));

router.post('/seals/assign', ah(async (req, res) => {
  const sel = pick({ t: req.body.type, l: req.body.level });
  if (!sel) throw new GameError('Sceau inconnu.');
  await SealService.assign(me(req), req.ctx.village.id, sel);
  flash(req, 'success', `Sceau ${seals.label(sel).toLowerCase()} posé sur ${req.ctx.village.name}.`);
  res.redirect(back(req, sel));
}));

router.post('/seals/remove', ah(async (req, res) => {
  await SealService.remove(me(req), req.ctx.village.id);
  flash(req, 'success', 'Sceau retiré : il redevient libre.');
  res.redirect(back(req));
}));

router.post('/seals/merge', ah(async (req, res) => {
  const player = await Player.findByPk(me(req), { attributes: ['userId'] });
  const made = await SealService.merge(player.userId, { type: req.body.type, level: req.body.level });
  flash(req, 'success', `Fusion réussie : sceau ${seals.label(made).toLowerCase()} obtenu.`);
  res.redirect(back(req, made));
}));

router.post('/seals/trades', ah(async (req, res) => {
  const [giveType, level] = String(req.body.give || '').split(':');
  await SealService.propose(me(req), { to: req.body.to, giveType, wantType: req.body.wantType, level });
  flash(req, 'success', 'Proposition d’échange envoyée.');
  res.redirect(`${back(req)}#echanges`);
}));

router.post('/seals/trades/:id/accept', ah(async (req, res) => {
  await SealService.accept(me(req), req.params.id);
  flash(req, 'success', 'Échange conclu.');
  res.redirect(`${back(req)}#echanges`);
}));

router.post('/seals/trades/:id/cancel', ah(async (req, res) => {
  await SealService.cancel(me(req), req.params.id);
  flash(req, 'success', 'Proposition retirée.');
  res.redirect(`${back(req)}#echanges`);
}));

module.exports = router;
