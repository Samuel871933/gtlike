'use strict';

// Aperçu du village, aperçu de tous les villages, renommage (pages d'un village, montées par ./index.js).

const express = require('express');
const VillageService = require('../../../services/VillageService');
const CommandService = require('../../../services/CommandService');
const { Knight, ScavengeRun, Transport } = require('../../../models');
const villageActivities = require('../../villageActivities');
const registry = require('../../../game/registry');
const { ah, flash } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

router.get('/', ah(async (req, res) => {
  const movements = await CommandService.overview(req.ctx.village.id);
  const supportUnits = movements.stacksHere.reduce((acc, s) => CommandService.addUnits(acc, s.units), {});
  // Options de construction, pour l'encart du bâtiment sélectionné sur le plan.
  const buildOptions = Object.fromEntries(registry.buildingsFor(req.ctx.cfg).map((type) => [type.id, VillageService.buildOption(req.ctx, type)]));
  const villageId = req.ctx.village.id;
  const [knights, scavenges, transports] = await Promise.all([
    Knight.findAll({ where: { homeVillageId: villageId }, attributes: ['trainingEndsAt'], raw: true }),
    ScavengeRun.findAll({ where: { villageId }, attributes: ['endsAt'], raw: true }),
    Transport.findAll({ where: { originVillageId: villageId }, attributes: ['type', 'arrivesAt'], raw: true }),
  ]);
  res.render('overview', {
    page: 'overview', supportUnits, movements, buildOptions,
    activities: villageActivities(req.ctx, { knights, scavenges, transports }),
    view: req.query.vue === 'liste' ? 'list' : 'city',
    moveTab: ['all', 'in', 'out'].includes(req.query.mv) ? req.query.mv : null,
    allMoves: req.query.tous === '1',
  });
}));

// Aperçus des villages, comme sur GT (menu « Aperçu ») : tous les villages du joueur et leurs données, par onglet.
const OVERVIEW_MODES = ['combined', 'prod', 'units', 'buildings'];
router.get('/villages', ah(async (req, res) => {
  const mode = OVERVIEW_MODES.includes(req.query.mode) ? req.query.mode : 'combined';
  const rows = await require('../../../services/VillagesOverviewService').rows(me(req));
  res.render('villages', { page: 'villages', mode, rows });
}));

router.post('/rename', ah(async (req, res) => {
  await VillageService.rename(req.ctx.village.id, req.body.name);
  flash(req, 'success', 'Village renommé.');
  res.redirect(base(req));
}));

module.exports = router;
