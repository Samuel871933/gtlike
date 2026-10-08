'use strict';

// Aperçu du village, aperçu de tous les villages, renommage (pages d'un village, montées par ./index.js).

const express = require('express');
const VillageService = require('../../../services/VillageService');
const CommandService = require('../../../services/CommandService');
const { Knight, ScavengeRun, Transport, Village, VillageGroupMember, MapMarker } = require('../../../models');
const PaginationService = require('../../../services/PaginationService');
const VillageGroupService = require('../../../services/VillageGroupService');
const villageActivities = require('../../villageActivities');
const registry = require('../../../game/registry');
const { ah, back, flash } = require('../../middleware');
const { base, me, currentPlayer } = require('./shared');

const router = express.Router({ mergeParams: true });

router.get('/', ah(async (req, res) => {
  const allMoves = req.query.tous === '1';
  const movements = allMoves ? await CommandService.overview(req.ctx.village.id) : await CommandService.overviewHead(req.ctx.village.id);
  const supportUnits = movements.stacksHere.reduce((acc, s) => CommandService.addUnits(acc, s.units), {});
  // Options de construction, pour l'encart du bâtiment sélectionné sur le plan.
  const buildOptions = Object.fromEntries(registry.buildingsFor(req.ctx.cfg).map((type) => [type.id, VillageService.buildOption(req.ctx, type)]));
  const villageId = req.ctx.village.id;
  const [knights, scavenges, transports, memberships] = await Promise.all([
    Knight.findAll({ where: { homeVillageId: villageId }, attributes: ['trainingEndsAt'], raw: true }),
    ScavengeRun.findAll({ where: { villageId }, attributes: ['endsAt'], raw: true }),
    Transport.findAll({ where: { originVillageId: villageId }, attributes: ['type', 'arrivesAt'], raw: true }),
    VillageGroupMember.findAll({ where: { villageId }, attributes: ['groupId'], raw: true }),
  ]);
  res.render('overview', {
    page: 'overview', supportUnits, movements, buildOptions,
    activities: villageActivities(req.ctx, { knights, scavenges, transports }),
    view: req.query.vue === 'liste' ? 'list' : 'city',
    moveTab: ['all', 'in', 'out'].includes(req.query.mv) ? req.query.mv : null,
    allMoves,
    villageGroupIds: memberships.map((m) => m.groupId),
  });
}));

// Aperçus des villages, comme sur GT (menu « Aperçu ») : tous les villages du joueur et leurs données, par onglet,
// filtrés par le groupe actif (?group= le change, voir loadVillage). Onglet Groupes : ranger ses villages.
const OVERVIEW_MODES = ['combined', 'prod', 'units', 'buildings', 'groups'];
router.get('/villages', ah(async (req, res) => {
  const mode = OVERVIEW_MODES.includes(req.query.mode) ? req.query.mode : 'combined';
  const { activeGroup, navVillages, myVillages } = res.locals;
  // Pages de villages (100 par défaut, réglable, comme l'aperçu Arrivant) : seuls ceux de la page sont calculés, puis
  // affichés au fil du défilement (lazyLists). Onglet Groupes : tous les villages, quel que soit le groupe actif.
  const list = mode === 'groups' || !activeGroup ? myVillages : navVillages;
  const player = currentPlayer(res);
  const { rows: shown, pagination } = PaginationService.slice(list, req.query.page, PaginationService.perPage(player, 'villages'));
  const ids = shown.map((v) => v.id);
  const pageHref = (n) => `${base(req)}/villages?mode=${mode}&page=${n}`;
  if (mode === 'groups') {
    const [villages, membership, marks] = await Promise.all([
      ids.length ? Village.findAll({ where: { id: ids, playerId: me(req) }, attributes: ['id', 'name', 'x', 'y', 'points'], order: [['name', 'ASC'], ['id', 'ASC']] }) : [],
      VillageGroupService.membership(me(req)),
      // Marquages de carte des groupes : aperçu dans l'encart « Mes groupes ».
      MapMarker.findAll({ where: { playerId: me(req), targetType: 'group' }, attributes: ['targetId', 'color', 'icon'], raw: true }),
    ]);
    return res.render('villages', {
      page: 'villages', mode, pagination, pageHref, rows: villages.map((village) => ({ village, groups: membership.get(village.id) || [] })),
      groupMarks: new Map(marks.map((m) => [m.targetId, m])), groupsMax: VillageGroupService.MAX_GROUPS,
    });
  }
  const rows = ids.length ? await require('../../../services/VillagesOverviewService').rows(me(req), new Date(), { ids }) : [];
  res.render('villages', { page: 'villages', mode, rows, pagination, pageHref });
}));

// Groupes de villages : création, renommage, suppression, grille des villages par groupe, groupes d'un village.
const groupsUrl = (req) => `${base(req)}/villages?mode=groups`;
router.post('/groups', ah(async (req, res) => {
  const group = await VillageGroupService.create(me(req), req.body.name);
  flash(req, 'success', `Groupe « ${group.name} » créé.`);
  res.redirect(back(req, groupsUrl(req)));
}));

// Grille de l'onglet Groupes : enregistrée par le bouton Appliquer.
router.post('/groups/matrix', ah(async (req, res) => {
  await VillageGroupService.setMatrix(me(req), req.body.shown, req.body.m);
  flash(req, 'success', 'Groupes des villages enregistrés.');
  res.redirect(groupsUrl(req));
}));

router.post('/groups/village', ah(async (req, res) => {
  await VillageGroupService.setForVillage(me(req), req.ctx.village.id, req.body.groups);
  flash(req, 'success', 'Groupes du village enregistrés.');
  res.redirect(back(req, base(req)));
}));

router.post('/groups/:groupId/rename', ah(async (req, res) => {
  const group = await VillageGroupService.rename(me(req), req.params.groupId, req.body.name);
  flash(req, 'success', `Groupe renommé en « ${group.name} ».`);
  res.redirect(back(req, groupsUrl(req)));
}));

router.post('/groups/:groupId/delete', ah(async (req, res) => {
  const group = await VillageGroupService.remove(me(req), req.params.groupId);
  flash(req, 'success', `Groupe « ${group.name} » supprimé.`);
  res.redirect(groupsUrl(req));
}));

router.post('/rename', ah(async (req, res) => {
  await VillageService.rename(req.ctx.village.id, req.body.name);
  flash(req, 'success', 'Village renommé.');
  res.redirect(base(req));
}));

module.exports = router;
