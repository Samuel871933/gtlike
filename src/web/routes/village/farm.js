'use strict';

// Assistant de pillage (premium) et envoi rapide d'un modèle favori (pages d'un village, montées par ./index.js).

const express = require('express');
const { Player } = require('../../../models');
const ArmyTemplateService = require('../../../services/ArmyTemplateService');
const FarmService = require('../../../services/FarmService');
const GameError = require('../../../services/GameError');
const registry = require('../../../game/registry');
const combat = require('../../../game/combat');
const { ah, back, flash } = require('../../middleware');
const { base, me } = require('./shared');
const { hit } = require('../../rateLimit');

const router = express.Router({ mergeParams: true });
const wantsJson = (req) => req.get('accept') === 'application/json';

router.get('/farm', ah(async (req, res) => {
  const { village, cfg } = req.ctx;
  const player = await Player.findByPk(me(req));
  const settings = FarmService.settings(player);
  const [templates, favorites] = await Promise.all([ArmyTemplateService.list(player.id), ArmyTemplateService.favorites(player.id)]);
  // Sans premium : la page présente l'assistant, sans la liste.
  const data = req.ctx.premium ? await FarmService.list(player, village, settings, { page: req.query.page }) : { rows: [], pagination: null };
  res.render('farm', {
    page: 'place', favTab: 'farm', settings, templates, favorites, ...data, premium: Boolean(req.ctx.premium),
    farmLetter: ArmyTemplateService.letter, carry: combat.carryCapacity,
    worldUnits: registry.unitsFor(cfg).filter((u) => !u.stationary),
  });
}));

router.post('/farm/settings', ah(async (req, res) => {
  const settings = await FarmService.saveSettings(me(req), req.body);
  if (wantsJson(req)) return res.json(settings);
  res.redirect(`${base(req)}/farm`);
}));

// Anti-script, comme sur Guerre Tribale : au plus 5 attaques par seconde et par joueur depuis l'assistant et la carte.
const FARM_RATE = { max: 5, windowMs: 1000 };

// Envoi d'un modèle d'armée sur un village : boutons de l'assistant et raccourcis de la carte (réponse JSON pour eux).
router.post('/farm/send', ah(async (req, res) => {
  if (!hit(`farm:${me(req)}`, FARM_RATE.max, FARM_RATE.windowMs)) {
    throw new GameError(`Trop rapide : ${FARM_RATE.max} attaques par seconde au plus. Patiente un instant.`, 429);
  }
  const { command, units, template, target } = await FarmService.send(req.ctx.village.id, me(req), req.body.template, req.body.target, req.ctx.cfg);
  if (wantsJson(req)) return res.json({ ok: true, units, target: { id: target.id, x: target.x, y: target.y }, arrivesAt: new Date(command.arrivesAt).getTime() });
  flash(req, 'success', `Attaque « ${template.name} » envoyée sur ${target.x}|${target.y}.`);
  res.redirect(back(req, `${base(req)}/farm`));
}));

router.post('/farm/:villageId/forget', ah(async (req, res) => {
  if (!req.ctx.premium) throw new GameError('L’assistant de pillage est réservé au premium.', 403);
  await FarmService.forget(me(req), req.params.villageId);
  if (wantsJson(req)) return res.json({ ok: true });
  res.redirect(back(req, `${base(req)}/farm`));
}));

// Modèles favoris (point de ralliement) : trois au plus.
router.post('/templates/:templateId/favorite', ah(async (req, res) => {
  const tpl = await ArmyTemplateService.toggleFavorite(me(req), req.params.templateId);
  flash(req, 'success', tpl.favorite ? `« ${tpl.name} » ajouté aux favoris.` : `« ${tpl.name} » retiré des favoris.`);
  res.redirect(back(req, `${base(req)}/place#modeles`));
}));

module.exports = router;
