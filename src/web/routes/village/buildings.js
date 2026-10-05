'use strict';

// Bâtiments : quartier général, recrutement, forge, collecte (pages d'un village, montées par ./index.js).

const express = require('express');
const VillageService = require('../../../services/VillageService');
const CommandService = require('../../../services/CommandService');
const { sequelize, Player, Village } = require('../../../models');
const NobleService = require('../../../services/NobleService');
const KnightService = require('../../../services/KnightService');
const KnightSkillService = require('../../../services/KnightSkillService');
const ScavengeService = require('../../../services/ScavengeService');
const scavenging = require('../../../game/scavenging');
const knightSkills = require('../../../game/knightSkills');
const GameError = require('../../../services/GameError');
const registry = require('../../../game/registry');
const { favoriteBuildings, favKey, favoritePage } = require('../../helpers');
const { ah, back, flash } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Quartier général

router.get('/main', (req, res) => {
  const types = registry.buildingsFor(req.ctx.cfg);
  const options = types.map((type) => VillageService.buildOption(req.ctx, type));
  res.render('main', {
    page: 'main',
    tab: req.query.tab === 'demolition' ? 'demolition' : 'build',
    // Coût supplémentaire du prochain ordre de la file (premium, au-delà des emplacements au prix normal).
    queueSurcharge: VillageService.queueSurcharge(req.ctx),
    demolitions: types.map((type) => VillageService.demolishOption(req.ctx, type)).filter((o) => o.current > 0),
    available: options.filter((o) => !o.maxed && !(o.missing && o.missing.length)),
    maxed: options.filter((o) => o.maxed),
    locked: options.filter((o) => !o.maxed && o.missing && o.missing.length),
  });
});

/** Page d'information d'un bâtiment sans page dédiée (mines, ferme, entrepôt, cachette, muraille…). */
router.get('/building/:building', ah(async (req, res) => {
  const type = registry.BUILDINGS.get(req.params.building);
  if (!type || !type.isAvailableIn(req.ctx.cfg)) throw new GameError('Bâtiment introuvable.', 404);
  const MilitiaService = require('../../../services/MilitiaService');
  const farm = type.id === 'farm' ? farmPopulation(req.ctx) : null;
  // Milice (module du monde) : taille, réglages, stationnement en cours ou raison du refus.
  if (farm && MilitiaService.enabled(req.ctx.cfg)) {
    farm.militia = {
      cfg: req.ctx.cfg.militia,
      size: MilitiaService.size(req.ctx.cfg, req.ctx.state.level('farm')),
      active: req.ctx.state.militiaActive(req.ctx.now) ? { count: req.ctx.state.units.militia || 0, until: req.ctx.state.militiaUntil } : null,
      blocker: await MilitiaService.blocker(req.ctx),
    };
  }
  res.render('building', { page: type.id, buildingId: type.id, option: VillageService.buildOption(req.ctx, type), farm });
}));

router.post('/farm/militia', ah(async (req, res) => {
  const { size, until } = await require('../../../services/MilitiaService').call(req.ctx.village.id);
  flash(req, 'success', `${size} miliciens défendent le village jusqu'à ${res.locals.when(until)}.`);
  res.redirect(`${base(req)}/building/farm`);
}));

/**
 * Ferme, comme sur GT : population maximale (actuelle et au niveau suivant) et population occupée par les bâtiments
 * (constructions en attente incluses), les troupes (au village et dehors) et les troupes en cours de production.
 */
function farmPopulation(ctx) {
  const { state } = ctx;
  const planned = { ...state.buildings };
  for (const o of ctx.buildOrders) if (!o.demolish) planned[o.building] = Math.max(planned[o.building] || 0, o.level);
  const buildings = Object.entries(planned).reduce((n, [id, lvl]) => n + registry.building(id).popAt(lvl), 0);
  const unitsPop = (list) => Object.entries(list || {}).reduce((n, [id, c]) => n + registry.unit(id).pop * c, 0);
  const troops = unitsPop(state.units) + unitsPop(ctx.awayUnits);
  const recruiting = ctx.recruitOrders.reduce((n, o) => n + registry.unit(o.unit).pop * (o.count - o.done), 0);
  const level = state.level('farm');
  const farmType = registry.building('farm');
  return {
    max: state.farmCapacity(),
    next: level < farmType.maxLevel ? require('../../../game/formulas').farmCapacity(level + 1) : null,
    level, buildings, troops, recruiting, total: buildings + troops + recruiting,
  };
}

// Étoile « favori » d'un bâtiment : l'ajoute ou le retire de la barre d'accès rapide. Appel de game.js :
// réponse JSON avec la barre à jour ; sans JavaScript : retour à la page.
router.post('/buildings/:buildingId/favorite', ah(async (req, res) => {
  const id = req.params.buildingId;
  const type = registry.BUILDINGS.get(id);
  // Une page hors bâtiment (sceaux…) peut aussi être mise en favori.
  if ((!type || !type.isAvailableIn(req.ctx.cfg)) && !favoritePage(id, req.ctx.cfg)) throw new GameError('Bâtiment inconnu.', 404);
  // Favori d'un onglet (« Pillage » du point de ralliement…) : clé « bâtiment:onglet ».
  const key = favKey(id, req.body.tab, req.ctx.cfg);
  const player = await Player.findByPk(me(req));
  const current = favoriteBuildings(player, req.ctx);
  const on = !current.includes(key);
  await player.update({ favoriteBuildings: on ? [...current, key] : current.filter((b) => b !== key) });
  if (req.get('accept') !== 'application/json') return res.redirect(back(req, base(req)));
  res.locals.player = player;
  const html = await new Promise((resolve, reject) => {
    res.render('partials/quickbar', { page: String(req.body.page || ''), favTab: String(req.body.pageTab || '') }, (err, out) => (err ? reject(err) : resolve(out)));
  });
  res.json({ on, key, html });
}));

router.post('/build', ah(async (req, res) => {
  const order = await VillageService.build(req.ctx.village.id, String(req.body.building || ''));
  flash(req, 'success', `${registry.building(order.building).name} niveau ${order.level} ajouté à la file.`);
  res.redirect(back(req, `${base(req)}/main`));
}));

// Démolition d'un niveau (onglet Démolition du QG).
router.post('/demolish', ah(async (req, res) => {
  const order = await VillageService.demolish(req.ctx.village.id, String(req.body.building || ''));
  flash(req, 'success', `Démolition de ${registry.building(order.building).name} (niveau ${order.level + 1} → ${order.level}) ajoutée à la file.`);
  res.redirect(`${base(req)}/main?tab=demolition`);
}));

// Terminer gratuitement la construction en cours (au plus 3 minutes restantes).
router.post('/build/:orderId/finish', ah(async (req, res) => {
  const order = await VillageService.finishBuild(req.ctx.village.id, req.params.orderId);
  flash(req, 'success', `${registry.building(order.building).name} niveau ${order.level} terminé.`);
  res.redirect(back(req, `${base(req)}/main`));
}));

router.post('/build/:orderId/cancel', ah(async (req, res) => {
  await VillageService.cancelBuild(req.ctx.village.id, req.params.orderId);
  flash(req, 'success', 'Construction annulée.');
  res.redirect(back(req, `${base(req)}/main`));
}));

// ------------------------------------------------------------ Recrutement

function assertRecruitBuilding(id) {
  if (!registry.RECRUIT_BUILDINGS.includes(id)) throw new GameError('Page introuvable.', 404);
  return id;
}

router.get('/recruit/:building', ah(async (req, res) => {
  const building = assertRecruitBuilding(req.params.building);
  const options = VillageService.recruitOptions(req.ctx, building);
  const locals = {
    page: building,
    tab: req.query.tab === 'dismiss' ? 'dismiss' : 'recruit',
    building,
    level: req.ctx.state.level(building),
    available: options.filter((o) => !o.locked),
    locked: options.filter((o) => o.locked),
    queue: req.ctx.recruitOrders.filter((o) => o.building === building),
  };
  if (building === 'statue' && KnightSkillService.enabled(req.ctx.cfg)) {
    // Paladins à compétences : un par village, plafond selon le nombre de villages.
    let blocker = null;
    try {
      await sequelize.transaction((t) => KnightSkillService.assertCanRecruit(req.ctx.village, t));
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      blocker = err.message;
    }
    for (const o of locals.available) o.max = blocker ? 0 : Math.min(o.max, 1);
    const knights = await KnightSkillService.ofPlayer(me(req));
    const villages = res.locals.myVillages.length;
    const withStatue = await Village.findAll({ where: { playerId: me(req) }, attributes: ['id', 'name', 'x', 'y', 'buildings'] });
    const homes = new Set(knights.map((k) => k.homeVillageId));
    locals.skilled = {
      knights, blocker, max: knightSkills.maxKnights(villages), skills: knightSkills, programs: req.ctx.cfg.knightTraining,
      destinations: withStatue.filter((v) => (v.buildings.statue || 0) > 0 && !homes.has(v.id)),
    };
    return res.render('recruit', locals);
  }
  if (building === 'statue') {
    // Un seul paladin par joueur.
    const { count } = await NobleService.playerUnitCount(me(req), 'knight');
    for (const o of locals.available) o.max = Math.min(o.max, Math.max(0, 1 - count));
    locals.knightCount = count;
    const player = await Player.findByPk(me(req));
    const found = await KnightService.sync(player);
    if (found.length) res.locals.flash = { type: 'success', message: `Votre paladin a trouvé : ${found.map((i) => i.name).join(', ')} !` };
    locals.knight = { player, items: registry.itemsFor(req.ctx.cfg), enabled: KnightService.enabled(req.ctx.cfg) };
  }
  if (building !== 'snob') return res.render('recruit', locals);

  // Académie : les nobles sont en plus limités par les pièces d'or.
  const slots = await NobleService.slots(req.ctx.village.playerId);
  for (const o of locals.available) o.max = Math.min(o.max, slots.free);
  const coin = NobleService.coinCost(req.ctx.cfg, req.ctx.state);
  const maxCoins = Math.min(...['wood', 'stone', 'iron'].map((r) => Math.floor(req.ctx.state.resources[r] / coin[r])));
  res.render('academy', { ...locals, slots, coin, maxCoins });
}));

router.post('/knights/:knightId/learn', ah(async (req, res) => {
  await KnightSkillService.learn(me(req), req.params.knightId, String(req.body.skill || ''));
  flash(req, 'success', 'Compétence apprise.');
  res.redirect(`${base(req)}/recruit/statue#paladin-${Number(req.params.knightId)}`);
}));

/** Les actions de formation et de déménagement se font depuis le village d'attache du paladin. */
async function knightHome(req) {
  const knight = await KnightSkillService.owned(me(req), req.params.knightId);
  return knight.homeVillageId;
}

router.post('/knights/:knightId/train', ah(async (req, res) => {
  await KnightSkillService.train(await knightHome(req), String(req.body.program || ''));
  flash(req, 'success', 'Formation lancée : le paladin quitte son village le temps de sa formation.');
  res.redirect(`${base(req)}/recruit/statue#paladin-${Number(req.params.knightId)}`);
}));

router.post('/knights/:knightId/relocate', ah(async (req, res) => {
  const cmd = await CommandService.relocateKnight(await knightHome(req), req.body.villageId);
  flash(req, 'success', `Le paladin est en route, arrivée ${res.locals.when(cmd.arrivesAt)}.`);
  res.redirect(`${base(req)}/recruit/statue#paladin-${Number(req.params.knightId)}`);
}));

router.post('/knights/:knightId/respec', ah(async (req, res) => {
  await KnightSkillService.respec(me(req), req.params.knightId);
  flash(req, 'success', 'Compétences réinitialisées : les livres sont rendus.');
  res.redirect(`${base(req)}/recruit/statue#paladin-${Number(req.params.knightId)}`);
}));

router.post('/knights/:knightId/rename', ah(async (req, res) => {
  await KnightSkillService.rename(me(req), req.params.knightId, req.body.name);
  flash(req, 'success', 'Paladin renommé.');
  res.redirect(`${base(req)}/recruit/statue#paladin-${Number(req.params.knightId)}`);
}));

router.post('/recruit/:building/dismiss', ah(async (req, res) => {
  const building = assertRecruitBuilding(req.params.building);
  const n = await VillageService.dismiss(req.ctx.village.id, req.body);
  flash(req, 'success', `${n} unité${n > 1 ? 's' : ''} renvoyée${n > 1 ? 's' : ''}.`);
  res.redirect(`${base(req)}/recruit/${building}?tab=dismiss`);
}));

router.post('/statue/equip', ah(async (req, res) => {
  const item = await KnightService.equip(me(req), String(req.body.item || ''));
  flash(req, 'success', `Paladin équipé : ${item.name}.`);
  res.redirect(`${base(req)}/recruit/statue`);
}));

router.post('/academy/mint', ah(async (req, res) => {
  await NobleService.mint(req.ctx.village.id, req.body.count);
  flash(req, 'success', "Pièces d'or frappées.");
  res.redirect(`${base(req)}/recruit/snob`);
}));

router.post('/recruit/:building', ah(async (req, res) => {
  const building = assertRecruitBuilding(req.params.building);
  const counts = {};
  for (const u of registry.unitsFor(req.ctx.cfg, building)) counts[u.id] = req.body[u.id];
  await VillageService.recruit(req.ctx.village.id, building, counts);
  flash(req, 'success', 'Recrutement lancé.');
  res.redirect(`${base(req)}/recruit/${building}`);
}));

router.post('/recruit-order/:orderId/cancel', ah(async (req, res) => {
  await VillageService.cancelRecruit(req.ctx.village.id, req.params.orderId);
  flash(req, 'success', 'Recrutement annulé.');
  res.redirect(back(req, base(req)));
}));

// ------------------------------------------------------------ Forge

router.get('/smith', (req, res) => {
  res.render('smith', { page: 'smith', options: VillageService.researchOptions(req.ctx) });
});

router.post('/research', ah(async (req, res) => {
  const order = await VillageService.research(req.ctx.village.id, String(req.body.unit || ''));
  flash(req, 'success', `Recherche lancée : ${registry.unit(order.unit).name}.`);
  res.redirect(`${base(req)}/smith`);
}));

router.post('/research/:orderId/cancel', ah(async (req, res) => {
  await VillageService.cancelResearch(req.ctx.village.id, req.params.orderId);
  flash(req, 'success', 'Recherche annulée.');
  res.redirect(`${base(req)}/smith`);
}));

// ------------------------------------------------------------ Collecte

router.get('/scavenge', ah(async (req, res) => {
  if (!ScavengeService.enabled(req.ctx.cfg)) throw new GameError("La collecte n'existe pas sur ce monde.", 404);
  // Modèles d'armée du joueur (point de ralliement) : choisir un modèle remplit la sélection de troupes.
  const templates = await require('../../../services/ArmyTemplateService').list(me(req));
  res.render('scavenge', {
    page: 'place', favTab: 'scavenge', options: await ScavengeService.overview(req.ctx), units: scavenging.unitsFor(req.ctx.cfg), templates,
  });
}));

router.post('/scavenge/:option/unlock', ah(async (req, res) => {
  await ScavengeService.unlock(req.ctx.village.id, req.params.option);
  flash(req, 'success', 'Déblocage lancé.');
  res.redirect(`${base(req)}/scavenge`);
}));

router.post('/scavenge/:option/send', ah(async (req, res) => {
  const run = await ScavengeService.send(req.ctx.village.id, req.params.option, req.body);
  flash(req, 'success', `Collecteurs partis, retour ${res.locals.when(run.endsAt)}.`);
  res.redirect(`${base(req)}/scavenge`);
}));

module.exports = router;
