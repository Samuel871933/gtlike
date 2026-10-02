'use strict';

// Point de ralliement : ordres, simulateur, troupes (pages d'un village, montées par ./index.js).

const express = require('express');
const CommandService = require('../../../services/CommandService');
const { Knight, ScavengeRun } = require('../../../models');
const ArmyTemplateService = require('../../../services/ArmyTemplateService');
const GameError = require('../../../services/GameError');
const registry = require('../../../game/registry');
const combat = require('../../../game/combat');
const { ah, back, flash } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Point de ralliement

function readOrder(req) {
  return {
    x: Number.parseInt(req.body.x, 10),
    y: Number.parseInt(req.body.y, 10),
    type: req.body.type === 'support' ? 'support' : 'attack',
    units: CommandService.parseUnits(req.body, req.ctx.cfg),
    catapultTarget: req.body.catapultTarget || null,
  };
}

/**
 * Attaques supplémentaires de la confirmation (champs extra_<n>_<unité>), dans l'ordre des lignes, même cible et
 * même cible des catapultes que la première ; les lignes vides sont ignorées.
 */
function readExtraOrders(req, order) {
  if (order.type !== 'attack') return [];
  const rows = new Map();
  for (const [key, value] of Object.entries(req.body)) {
    const m = /^extra_(\d{1,3})_([a-z]+)$/.exec(key);
    if (!m) continue;
    if (!rows.has(+m[1])) rows.set(+m[1], {});
    rows.get(+m[1])[m[2]] = value;
  }
  return [...rows.keys()].sort((a, b) => a - b)
    .map((n) => CommandService.parseUnits(rows.get(n), req.ctx.cfg))
    .filter((units) => Object.keys(units).length)
    .map((units) => ({ ...order, units }));
}

/** Simulateur de combat : mêmes règles que les vrais combats (combat.resolve), sans rien envoyer. */
function simulate(query, cfg) {
  const read = (prefix) => {
    const units = {};
    for (const u of registry.unitsFor(cfg)) {
      const n = Math.floor(Number(query[`${prefix}_${u.id}`]));
      if (Number.isFinite(n) && n > 0) units[u.id] = n;
    }
    return units;
  };
  const clamp = (v, min, max, d) => (Number.isFinite(Number(v)) && v !== '' ? Math.min(max, Math.max(min, Number(v))) : d);
  const input = {
    attackers: read('att'),
    defenders: read('def'),
    wall: Math.round(clamp(query.wall, 0, 20, 0)),
    morale: clamp(query.morale, 30, 100, 100) / 100,
    luck: clamp(query.luck, -25, 25, 0) / 100,
    night: query.night === '1',
    // Mondes avec église : troupes sans foi (hors zone d'une église), cases cochées dans le simulateur.
    attFaithless: cfg.hasFeature('church') && query.attFaithless === '1',
    defFaithless: cfg.hasFeature('church') && query.defFaithless === '1',
  };
  if (!Object.keys(input.attackers).length) return { input, result: null };
  const result = combat.resolve({
    attackers: input.attackers, defenders: input.defenders, wall: input.wall, morale: input.morale, luck: input.luck,
    nightFactor: input.night ? cfg.night.defFactor : 1,
    attackerFaith: input.attFaithless ? cfg.church.faithless : 1,
    defenderFaith: input.defFaithless ? cfg.church.faithless : 1,
  });
  return { input, result };
}

router.get('/place', ah(async (req, res) => {
  const tab = ['commands', 'troops', 'sim'].includes(req.query.tab) ? req.query.tab : 'commands';
  const lists = await CommandService.overview(req.ctx.village.id);
  const [scavengeRuns, homeKnights] = tab === 'troops' ? await Promise.all([
    ScavengeRun.findAll({ where: { villageId: req.ctx.village.id }, order: [['endsAt', 'ASC']] }),
    Knight.findAll({ where: { homeVillageId: req.ctx.village.id }, attributes: ['trainingEndsAt'] }),
  ]) : [[], []];
  const templates = await ArmyTemplateService.list(me(req));
  // ?tpl= (aperçu d'un village : « Envoyer des troupes » avec un modèle) : unités du modèle, sauf si l'URL en donne.
  const tpl = req.query.tpl ? templates.find((x) => String(x.id) === String(req.query.tpl)) : null;
  if (tpl) for (const [id, n] of Object.entries(tpl.units)) if (req.query[id] == null) req.query[id] = String(n);
  res.render('place', {
    page: 'place',
    tab,
    ...lists,
    scavengeRuns,
    knightTraining: homeKnights.some((knight) => knight.trainingEndsAt),
    // Cible et unités pré-remplies depuis l'URL (carte : Espionner ; modèles d'armée) : ?x=…&y=…&spy=5
    form: {
      x: req.query.x || '', y: req.query.y || '',
      units: Object.fromEntries(registry.unitsFor(req.ctx.cfg).map((u) => [u.id, Math.min(req.ctx.state.units[u.id] || 0, Math.max(0, Math.floor(Number(req.query[u.id])) || 0))]).filter(([, n]) => n > 0)),
    },
    units: registry.unitsFor(req.ctx.cfg).filter((u) => (req.ctx.state.units[u.id] || 0) > 0),
    allUnits: registry.unitsFor(req.ctx.cfg),
    // Minutes par case de chaque unité : aperçu de la durée et de l'heure d'arrivée dans le formulaire.
    pace: Object.fromEntries(registry.unitsFor(req.ctx.cfg).map((u) => [u.id, u.minutesPerField(req.ctx.cfg)])),
    sim: tab === 'sim' ? simulate(req.query, req.ctx.cfg) : null,
    query: req.query,
    templates,
  });
}));

// Modèles d'armée (« Ordres rapides ») : création et suppression depuis le point de ralliement.
router.post('/templates', ah(async (req, res) => {
  const tpl = await ArmyTemplateService.create(me(req), req.body, req.ctx.cfg);
  flash(req, 'success', `Modèle « ${tpl.name} » enregistré.`);
  res.redirect(`${base(req)}/place#modeles`);
}));

router.post('/templates/:templateId/delete', ah(async (req, res) => {
  await ArmyTemplateService.remove(me(req), req.params.templateId);
  flash(req, 'success', 'Modèle supprimé.');
  res.redirect(`${base(req)}/place#modeles`);
}));

/** Point de ralliement pré-rempli avec la cible et les troupes d'un ordre (retour après un refus). */
const placeWith = (req, order) => `${base(req)}/place?${new URLSearchParams({ x: req.body.x || '', y: req.body.y || '', ...order.units })}`;

/** Erreur métier sur un ordre : message et retour au formulaire pré-rempli (les autres erreurs remontent). */
async function orUnwind(req, res, order, run) {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof GameError) || err.status >= 500 || err.status === 404) throw err;
    flash(req, 'error', err.message);
    res.redirect(placeWith(req, order));
    return null;
  }
}

router.post('/place/confirm', ah(async (req, res) => {
  const order = readOrder(req);
  const plan = await orUnwind(req, res, order, () => CommandService.preview(req.ctx.village.id, order));
  if (!plan) return;
  const catapultTargets = registry.buildingsFor(req.ctx.cfg).filter((b) => !combat.UNDESTROYABLE.has(b.id));
  // Troupes en tableau, comme sur Guerre Tribale : toutes les unités du monde, même à 0 ; butin possible (attaque).
  res.render('place-confirm', {
    page: 'place', plan, catapultTargets, worldUnits: registry.unitsFor(req.ctx.cfg), carry: combat.carryCapacity(plan.units),
    // Attaques supplémentaires : troupes du village et écart entre deux arrivées.
    available: req.ctx.state.units, chainGapMs: CommandService.chainGapMs(req.ctx.world), maxChained: CommandService.MAX_CHAINED,
  });
}));

router.post('/place/send', ah(async (req, res) => {
  const order = readOrder(req);
  const orders = [order, ...readExtraOrders(req, order)];
  const cmds = await orUnwind(req, res, order, () => CommandService.sendMany(req.ctx.village.id, orders));
  if (!cmds) return;
  flash(req, 'success', cmds.length > 1 ? `${cmds.length} attaques envoyées à la suite.` : order.type === 'attack' ? 'Attaque envoyée.' : 'Soutien envoyé.');
  res.redirect(`${base(req)}/place`);
}));

router.post('/command/:commandId/cancel', ah(async (req, res) => {
  await CommandService.cancel(req.ctx.village.id, req.params.commandId);
  flash(req, 'success', 'Ordre annulé : les troupes font demi-tour.');
  res.redirect(back(req, `${base(req)}/place`));
}));

router.post('/support/:stackId/withdraw', ah(async (req, res) => {
  await CommandService.withdrawSupport(req.params.stackId, req.user.id);
  flash(req, 'success', 'Les troupes rentrent chez elles.');
  res.redirect(back(req, `${base(req)}/place`));
}));

router.post('/support/bulk-withdraw', ah(async (req, res) => {
  const count = await CommandService.withdrawSupports(req.body.ids, req.user.id, req.ctx.village.id, req.body.direction);
  flash(req, 'success', `${count} soutien${count > 1 ? 's' : ''} ${req.body.direction === 'here' ? 'renvoyé' : 'rappelé'}${count > 1 ? 's' : ''}.`);
  res.redirect(back(req, `${base(req)}/place?tab=troops`));
}));

module.exports = router;
