'use strict';

// Gestionnaire de compte (premium) : aperçu, gestionnaire de villages (modèles de construction), de troupes, de
// marché (routes commerciales, réserve) et notifications d'attaque (pages d'un village, montées par ./index.js).

const express = require('express');
const { Player } = require('../../../models');
const AccountManagerService = require('../../../services/AccountManagerService');
const GameError = require('../../../services/GameError');
const registry = require('../../../game/registry');
const managerTemplates = require('../../../game/managerTemplates');
const { ah, back, flash, ownerOnly } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

const TABS = ['overview', 'buildings', 'templates', 'units', 'troops', 'market', 'notify'];
const url = (req, query = '') => `${base(req)}/manager${query ? `?${query}` : ''}`;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
// Villages du groupe actif (voir loadVillage), nul sans groupe.
const groupIds = (res) => (res.locals.activeGroup ? res.locals.navVillages.map((v) => v.id) : null);
/**
 * Villages visés par une action groupée : les cases cochées, ou (`scope`) tous les villages du groupe actif
 * (« group ») ou du compte (« all »), au-delà de la page affichée.
 */
function targetIds(req, res) {
  if (req.body.scope === 'all') return res.locals.myVillages.map((v) => v.id);
  if (req.body.scope === 'group') {
    const ids = groupIds(res);
    if (!ids) throw new GameError('Aucun groupe choisi.');
    if (!ids.length) throw new GameError('Ce groupe n’a aucun village.');
    return ids;
  }
  return req.body.ids;
}

router.get('/manager', ah(async (req, res) => {
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'overview';
  const playerId = me(req);
  const [player, list, templates] = await Promise.all([
    Player.findByPk(playerId),
    // Une page de villages (réglage « villages par page », comme l'aperçu Arrivant), et l'usage des modèles sur tous.
    // Groupe actif (menu des groupes) : ses villages seulement.
    AccountManagerService.villages(playerId, { cfg: req.ctx.cfg, page: req.query.page, only: groupIds(res) }),
    AccountManagerService.templates(playerId, req.ctx.cfg),
  ]);
  const { rows: villages, pagination, usage, managed } = list;
  const data = {};
  if (tab === 'overview') {
    data.warnings = await AccountManagerService.warnings(playerId, villages);
    data.marketReport = await AccountManagerService.marketReport(playerId);
  }
  if (tab === 'templates' && req.query.id) {
    data.edit = await AccountManagerService.buildTemplate(playerId, req.query.id);
    if (!data.edit) throw new GameError('Modèle introuvable.', 404);
  }
  if (tab === 'troops' && req.query.id) {
    data.editTroops = await AccountManagerService.troopTemplate(playerId, req.query.id, req.ctx.cfg);
    if (!data.editTroops) throw new GameError('Modèle introuvable.', 404);
  }
  if (tab === 'market') data.routes = await AccountManagerService.routes(playerId);
  res.render('manager', {
    page: 'manager', tab, premium: Boolean(req.ctx.premium), settings: AccountManagerService.settings(player), villages, templates,
    pagination, usage, managed, pageHref: (n) => url(req, `tab=${tab}&page=${n}`),
    managedUnits: AccountManagerService.managedUnits(req.ctx.cfg), buildings: registry.buildingsFor(req.ctx.cfg),
    withLevels: managerTemplates.withLevels, targetsOf: managerTemplates.targets, buildStats: managerTemplates.stats,
    batchPreview: (units, budget) => managerTemplates.batchPreview(units, budget, AccountManagerService.managedUnits(req.ctx.cfg)),
    BATCH_COST_MIN: managerTemplates.BATCH_COST_MIN, BATCH_COST_MAX: managerTemplates.BATCH_COST_MAX, troopStats: managerTemplates.troopStats,
    ...data,
  });
}));

// Toutes les actions du gestionnaire demandent le premium du propriétaire du village.
router.post('/manager/*', (req, res, next) => {
  if (!req.ctx.premium) return next(new GameError('Le gestionnaire de compte est réservé au premium.', 403));
  next();
});

// Onglet Villages (seul endroit où l'on assigne les modèles) : appliquer, retirer, mettre en pause ou relancer un modèle
// de construction (champs build…) ou de troupes (champs troop…) sur les villages cochés.
router.post('/manager/build', ah(async (req, res) => {
  const n = await AccountManagerService.applyBuild(me(req), req.body.ids, { action: req.body.buildAction || req.body.action, template: req.body.buildTemplate || req.body.template });
  flash(req, 'success', `${plural(n, 'village')} mis à jour.`);
  res.redirect(url(req, 'tab=buildings'));
}));

router.post('/manager/templates', ah(async (req, res) => {
  const tpl = await AccountManagerService.createBuildTemplate(me(req), { name: req.body.name, from: req.body.from || null });
  flash(req, 'success', `Modèle « ${tpl.name} » créé.`);
  res.redirect(url(req, `tab=templates&id=tpl:${tpl.id}`));
}));

router.post('/manager/templates/:id/rename', ah(async (req, res) => {
  const tpl = await AccountManagerService.renameTemplate(me(req), req.params.id, req.body.name);
  flash(req, 'success', `Modèle renommé en « ${tpl.name} ».`);
  res.redirect(back(req, url(req, 'tab=templates')));
}));

router.post('/manager/templates/:id/delete', ah(async (req, res) => {
  const tpl = await AccountManagerService.deleteTemplate(me(req), req.params.id);
  flash(req, 'success', `Modèle « ${tpl.name} » supprimé.`);
  res.redirect(url(req, tpl.kind === 'troops' ? 'tab=troops' : 'tab=templates'));
}));

// Liste de construction d'un modèle : ajout d'étapes, ordre, suppression, démolition (enregistré à chaque action).
router.post('/manager/templates/:id/steps', ah(async (req, res) => {
  await AccountManagerService.editBuildSteps(me(req), req.params.id, req.body, req.ctx.cfg);
  // Raccourcis du sommaire : retour au sommaire ; sinon à la liste.
  res.redirect(`${url(req, `tab=templates&id=tpl:${Number(req.params.id)}`)}#${req.body.anchor === 'sommaire' ? 'sommaire' : 'liste'}`);
}));

/**
 * Onglet Villages, un seul formulaire : `op` est le bouton pressé.
 *   'build:use' / 'troops:use' : appliquer le modèle choisi (buildTemplate, troopTemplate) aux villages cochés ;
 *   'bulk' : l'action de la liste « bulk » (build|troops|all : pause|resume|remove) sur les villages cochés ;
 *   'village:<id>:<build|troops>:<pause|resume|remove>' : bouton de la colonne Actions d'un village.
 */
const WHICH = ['build', 'troops', 'all'];
const ACTIONS = ['use', 'pause', 'resume', 'remove'];
router.post('/manager/apply', ah(async (req, res) => {
  const op = String(req.body.op || '');
  let ids = targetIds(req, res);
  let parts = (op === 'bulk' ? String(req.body.bulk || '') : op).split(':');
  if (parts[0] === 'village') {
    ids = [parts[1]];
    parts = parts.slice(2);
  }
  const [which, action] = parts;
  if (!WHICH.includes(which) || !ACTIONS.includes(action) || (which === 'all' && action === 'use')) throw new GameError('Action inconnue.');
  let n = 0;
  if (which !== 'troops') n = await AccountManagerService.applyBuild(me(req), ids, { action, template: req.body.buildTemplate });
  if (which !== 'build') n = await AccountManagerService.applyTroops(me(req), ids, { action, template: req.body.troopTemplate }, req.ctx.cfg);
  flash(req, 'success', `${plural(n, 'village')} mis à jour.`);
  // Retour à l'onglet du gestionnaire concerné.
  res.redirect(url(req, which === 'troops' ? 'tab=units' : 'tab=buildings'));
}));

router.post('/manager/troops', ah(async (req, res) => {
  const input = { ...req.body, action: req.body.troopAction || req.body.action, template: req.body.troopTemplate || req.body.template };
  const n = await AccountManagerService.applyTroops(me(req), req.body.ids, input, req.ctx.cfg);
  flash(req, 'success', `${plural(n, 'village')} mis à jour.`);
  res.redirect(url(req, 'tab=units'));
}));

// Modèles de troupes : création (vide ou copiée d'un modèle), puis enregistrement des troupes et tampons (`id`).
router.post('/manager/troop-templates', ah(async (req, res) => {
  const tpl = req.body.id
    ? await AccountManagerService.saveTroopTemplate(me(req), req.body, req.ctx.cfg)
    : await AccountManagerService.createTroopTemplate(me(req), { name: req.body.name, from: req.body.from || null }, req.ctx.cfg);
  flash(req, 'success', req.body.id ? `Modèle « ${tpl.name} » enregistré.` : `Modèle « ${tpl.name} » créé.`);
  res.redirect(url(req, `tab=troops&id=tpl:${tpl.id}`));
}));

// Gestionnaire de marché : routes commerciales (au départ du village courant) et réserve.
router.post('/manager/routes', ah(async (req, res) => {
  const route = await AccountManagerService.createRoute(me(req), req.ctx.village.id, req.body);
  flash(req, 'success', `Route créée : premier envoi ${res.locals.when(route.nextAt)}.`);
  res.redirect(url(req, 'tab=market#routes'));
}));

router.post('/manager/routes/delete', ah(async (req, res) => {
  const n = await AccountManagerService.deleteRoutes(me(req), req.body.ids);
  flash(req, 'success', `${plural(n, 'route')} supprimée${n > 1 ? 's' : ''}.`);
  res.redirect(url(req, 'tab=market#routes'));
}));

router.post('/manager/reserve', ah(async (req, res) => {
  const { reserve } = await AccountManagerService.saveReserve(me(req), req.body);
  flash(req, 'success', reserve.enabled ? 'Réserve activée.' : 'Réserve enregistrée (désactivée).');
  res.redirect(url(req, 'tab=market#reserve'));
}));

router.post('/manager/reserve-role', ah(async (req, res) => {
  const n = await AccountManagerService.applyReserveRole(me(req), targetIds(req, res), req.body.role);
  flash(req, 'success', `${plural(n, 'village')} mis à jour.`);
  res.redirect(url(req, 'tab=market#reserve'));
}));

// Notifications par e-mail : réglage du titulaire seulement (elles partent à son adresse).
router.post('/manager/notify', ownerOnly, ah(async (req, res) => {
  const { notify } = await AccountManagerService.saveNotify(me(req), req.body);
  flash(req, 'success', notify.enabled ? 'Notifications d’attaque activées.' : 'Notifications d’attaque désactivées.');
  res.redirect(url(req, 'tab=notify'));
}));

// Pastilles de l'aperçu : pause ou reprise d'un gestionnaire pour un village.
router.post('/manager/toggle', ah(async (req, res) => {
  await AccountManagerService.toggle(me(req), req.body.village, req.body.which);
  res.redirect(back(req, url(req)));
}));

module.exports = router;
