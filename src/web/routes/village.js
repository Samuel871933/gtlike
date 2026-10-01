'use strict';

const express = require('express');
const VillageService = require('../../services/VillageService');
const CommandService = require('../../services/CommandService');
const { sequelize, Player, Village, Tribe, Knight, ScavengeRun, Transport } = require('../../models');
const villageActivities = require('../villageActivities');
const MapService = require('../../services/MapService');
const NobleService = require('../../services/NobleService');
const TradeService = require('../../services/TradeService');
const TribeService = require('../../services/TribeService');
const MessageService = require('../../services/MessageService');
const ReportService = require('../../services/ReportService');
const AccountService = require('../../services/AccountService');
const SitterService = require('../../services/SitterService');
const KnightService = require('../../services/KnightService');
const AchievementService = require('../../services/AchievementService');
const DailyService = require('../../services/DailyService');
const KnightSkillService = require('../../services/KnightSkillService');
const ScavengeService = require('../../services/ScavengeService');
const ArmyTemplateService = require('../../services/ArmyTemplateService');
const FavoriteService = require('../../services/FavoriteService');
const MarkerService = require('../../services/MarkerService');
const mapView = require('../mapView');
const TribeForumService = require('../../services/TribeForumService');
const ImageService = require('../../services/ImageService');
const PaginationService = require('../../services/PaginationService');
const scavenging = require('../../game/scavenging');
const knightSkills = require('../../game/knightSkills');
const GameError = require('../../services/GameError');
const registry = require('../../game/registry');
const combat = require('../../game/combat');
const { favoriteBuildings } = require('../helpers');
const { ah, back, flash, requireAuth, loadVillage, ownerOnly } = require('../middleware');

const router = express.Router({ mergeParams: true });
const RESOURCE_IDS = ['wood', 'stone', 'iron'];

router.use(requireAuth, loadVillage);

const base = (req) => `/village/${req.ctx.village.id}`;
const me = (req) => req.ctx.village.playerId;

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
  const rows = await require('../../services/VillagesOverviewService').rows(me(req));
  res.render('villages', { page: 'villages', mode, rows });
}));

router.post('/rename', ah(async (req, res) => {
  await VillageService.rename(req.ctx.village.id, req.body.name);
  flash(req, 'success', 'Village renommé.');
  res.redirect(base(req));
}));

// ------------------------------------------------------------ Quartier général

router.get('/main', (req, res) => {
  const types = registry.buildingsFor(req.ctx.cfg);
  const options = types.map((type) => VillageService.buildOption(req.ctx, type));
  res.render('main', {
    page: 'main',
    tab: req.query.tab === 'demolition' ? 'demolition' : 'build',
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
  const MilitiaService = require('../../services/MilitiaService');
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
  const { size, until } = await require('../../services/MilitiaService').call(req.ctx.village.id);
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
    next: level < farmType.maxLevel ? require('../../game/formulas').farmCapacity(level + 1) : null,
    level, buildings, troops, recruiting, total: buildings + troops + recruiting,
  };
}

// Étoile « favori » d'un bâtiment : l'ajoute ou le retire de la barre d'accès rapide. Appel de game.js :
// réponse JSON avec la barre à jour ; sans JavaScript : retour à la page.
router.post('/buildings/:buildingId/favorite', ah(async (req, res) => {
  const id = req.params.buildingId;
  const type = registry.BUILDINGS.get(id);
  if (!type || !type.isAvailableIn(req.ctx.cfg)) throw new GameError('Bâtiment inconnu.', 404);
  const player = await Player.findByPk(me(req));
  const current = favoriteBuildings(player, req.ctx);
  const on = !current.includes(id);
  await player.update({ favoriteBuildings: on ? [...current, id] : current.filter((b) => b !== id) });
  if (req.get('accept') !== 'application/json') return res.redirect(back(req, base(req)));
  res.locals.player = player;
  const html = await new Promise((resolve, reject) => {
    res.render('partials/quickbar', { page: String(req.body.page || '') }, (err, out) => (err ? reject(err) : resolve(out)));
  });
  res.json({ on, html });
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
  const coin = req.ctx.cfg.snob.coin;
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
  res.render('scavenge', {
    page: 'place', options: await ScavengeService.overview(req.ctx), units: scavenging.unitsFor(req.ctx.cfg),
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

// ------------------------------------------------------------ Marché

// Marché, agencé comme sur GT (sans le centre d'échange premium) : menu à gauche, en-tête marchands / transport /
// ressources arrivantes et sortantes. « mine » : ancienne adresse de la création d'offres (liens des rapports).
const MARKET_TABS = ['offers', 'create', 'mass', 'send', 'transports', 'merchants', 'own', 'request'];

router.get('/market', ah(async (req, res) => {
  const asked = req.query.tab === 'mine' ? 'create' : req.query.tab;
  const tab = MARKET_TABS.includes(asked) ? asked : 'offers';
  const cap = req.ctx.cfg.market.merchantCapacity;
  const [merchants, lists, flows] = await Promise.all([
    VillageService.withVillage(req.ctx.village.id, (ctx, t) => TradeService.merchants(ctx, t)),
    TradeService.overview(req.ctx.village.id),
    TradeService.flows(req.ctx.village.id),
  ]);
  const locals = {
    page: 'market', tab, merchants, flows, cap,
    outgoing: lists.outgoing, incoming: lists.incoming, ownOffers: lists.offers,
    form: { x: req.query.x || '', y: req.query.y || '' },
  };

  if (tab === 'offers') {
    // Je veux (ressource que donne l'offre) / J'offre (ressource qu'elle demande), durée maximale, filtre, pagination.
    const filters = {
      sell: RESOURCE_IDS.includes(req.query.sell) ? req.query.sell : '',
      buy: RESOURCE_IDS.includes(req.query.buy) ? req.query.buy : '',
      maxHours: Math.max(0, Math.floor(Number(req.query.hours)) || 0),
      filter: ['all', 'possible', 'tribe'].includes(req.query.filter) ? req.query.filter : 'all',
    };
    const all = await TradeService.listOffers(req.ctx, filters);
    const pg = PaginationService.paginate(all.length, req.query.page, PaginationService.perPage(res.locals.player, 'market'));
    Object.assign(locals, { filters, offers: all.slice(pg.offset, pg.offset + pg.perPage), total: all.length, pagination: pg });
  }
  if (tab === 'create') {
    // Préremplissage : la ressource qu'on a le plus contre celle qu'on a le moins (ou l'offre d'un rapport à recréer).
    const byAmount = [...RESOURCE_IDS].sort((x, y) => req.ctx.state.resources[y] - req.ctx.state.resources[x]);
    const most = byAmount[0];
    const least = byAmount[byAmount.length - 1] === most ? byAmount[1] : byAmount[byAmount.length - 1];
    const pick = (v, fallback) => (RESOURCE_IDS.includes(v) ? v : fallback);
    locals.offerForm = {
      sellResource: pick(req.query.sellResource, most), sellAmount: req.query.sellAmount || cap,
      buyResource: pick(req.query.buyResource, least), buyAmount: req.query.buyAmount || cap,
      count: req.query.count || 1, maxHours: req.query.maxHours || '', tribeOnly: req.query.tribeOnly === '1',
    };
  }
  if (['mass', 'merchants', 'request', 'own'].includes(tab)) {
    const ids = res.locals.myVillages.map((v) => v.id);
    if (tab === 'own') locals.playerOffers = await TradeService.playerOffers(ids);
    else {
      locals.villages = await TradeService.villagesSummary(ids);
      locals.moving = await TradeService.movingByVillage(ids);
      locals.travelTo = (v) => TradeService.travelSeconds(v, req.ctx.village, req.ctx.cfg);
    }
  }
  res.render('market', locals);
}));

// Nombre de lignes par page d'une liste (rapports, messages, offres du marché) : formulaire commun
// (partials/pagination), retour sur la liste, à la première page.
router.post('/per-page', ah(async (req, res) => {
  await PaginationService.setPerPage(me(req), req.body.list, req.body.perPage);
  flash(req, 'success', 'Réglage enregistré.');
  const url = new URL(back(req, base(req)), 'http://local');
  url.searchParams.delete('page');
  res.redirect(url.pathname + url.search);
}));

// Offres en masse : la même offre depuis plusieurs de tes villages (champ count_<id> par village).
router.post('/market/mass', ah(async (req, res) => {
  const mine = new Set(res.locals.myVillages.map((v) => v.id));
  const spec = { sellResource: req.body.sellResource, sellAmount: req.body.sellAmount, buyResource: req.body.buyResource, buyAmount: req.body.buyAmount, maxHours: req.body.maxHours, tribeOnly: req.body.tribeOnly };
  const done = [];
  const errors = [];
  for (const [key, value] of Object.entries(req.body)) {
    const id = Number(key.startsWith('count_') ? key.slice(6) : NaN);
    const count = Math.floor(Number(value));
    if (!mine.has(id) || !(count > 0)) continue;
    const name = res.locals.myVillages.find((v) => v.id === id).name;
    try {
      await TradeService.createOffer(id, { ...spec, count });
      done.push(`${name} (${count})`);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      errors.push(`${name} : ${err.message}`);
    }
  }
  if (!done.length && !errors.length) throw new GameError('Indiquez un nombre d’offres pour au moins un village.');
  flash(req, errors.length ? 'error' : 'success', [done.length ? `Offres publiées : ${done.join(', ')}.` : '', ...errors].filter(Boolean).join(' '));
  res.redirect(`${base(req)}/market?tab=${done.length ? 'own' : 'mass'}`);
}));

// Demande : tes autres villages envoient des ressources au village courant (champs <ressource>_<id>).
router.post('/market/request', ah(async (req, res) => {
  const target = req.ctx.village;
  const done = [];
  const errors = [];
  for (const v of res.locals.myVillages) {
    if (v.id === target.id) continue;
    const resources = Object.fromEntries(RESOURCE_IDS.map((r) => [r, Math.max(0, Math.floor(Number(req.body[`${r}_${v.id}`])) || 0)]));
    if (!RESOURCE_IDS.some((r) => resources[r] > 0)) continue;
    try {
      await TradeService.send(v.id, { x: target.x, y: target.y, resources });
      done.push(v.name);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      errors.push(`${v.name} : ${err.message}`);
    }
  }
  if (!done.length && !errors.length) throw new GameError('Indiquez des ressources à faire venir.');
  flash(req, errors.length ? 'error' : 'success', [done.length ? `Marchands en route depuis : ${done.join(', ')}.` : '', ...errors].filter(Boolean).join(' '));
  res.redirect(`${base(req)}/market?tab=${done.length ? 'transports' : 'request'}`);
}));

router.post('/market/send', ah(async (req, res) => {
  const tr = await TradeService.send(req.ctx.village.id, {
    x: Number.parseInt(req.body.x, 10),
    y: Number.parseInt(req.body.y, 10),
    resources: TradeService.parseResources(req.body),
  });
  flash(req, 'success', `Marchands en route, arrivée ${res.locals.when(tr.arrivesAt)}.`);
  res.redirect(`${base(req)}/market?tab=transports`);
}));

router.post('/market/offers', ah(async (req, res) => {
  await TradeService.createOffer(req.ctx.village.id, req.body);
  flash(req, 'success', 'Offre publiée.');
  res.redirect(`${base(req)}/market?tab=create`);
}));

router.post('/market/offers/:offerId/cancel', ah(async (req, res) => {
  await TradeService.cancelOffer(req.ctx.village.id, req.params.offerId);
  flash(req, 'success', 'Offre retirée, ressources rendues.');
  res.redirect(back(req, `${base(req)}/market?tab=create`));
}));

router.post('/market/offers/:offerId/accept', ah(async (req, res) => {
  await TradeService.acceptOffer(req.ctx.village.id, req.params.offerId, req.body.count);
  flash(req, 'success', 'Échange accepté : les marchands sont en route.');
  res.redirect(`${base(req)}/market?tab=transports`);
}));

// ------------------------------------------------------------ Tribu

router.get('/tribe', ah(async (req, res) => {
  const player = await Player.findByPk(me(req));
  if (!player.tribeId) {
    const invites = await TribeService.invitesFor(player.id);
    return res.render('tribe-none', { page: 'tribe', player, invites });
  }
  // Onglet Forum : ouvre directement le premier sous-forum, comme sur Guerre Tribale.
  if (req.query.tab === 'forum') return res.redirect(`${base(req)}/tribe/forum/${(await TribeForumService.firstSection(player.id)).id}`);
  // Droits et Invitations : réservés aux barons / à ceux qui peuvent inviter (sinon l'aperçu).
  const allowed = { rights: 'baron', invites: 'invite' };
  const asked = ['overview', 'properties', 'members', 'rights', 'invites', 'diplomacy'].includes(req.query.tab) ? req.query.tab : 'overview';
  const tab = allowed[asked] && !TribeService.can(player, allowed[asked]) ? 'overview' : asked;
  // Aperçu : fil des événements de la tribu, filtré (?cat=) et paginé (?page=), comme sur GT.
  const feed = tab === 'overview' ? await require('../../services/TribeEventService').list(player.tribeId, { category: req.query.cat, page: req.query.page }) : null;
  await renderTribe(res, player, tab, null, 200, { feed });
}));

/** Page de la tribu (en-tête et onglets), avec au besoin une vue du forum de tribu. */
async function renderTribe(res, player, tab, forum, status = 200, extra = {}) {
  const data = await TribeService.dashboard(player);
  const forumUnread = await TribeForumService.unreadCount(player.id);
  const can = (right) => TribeService.can(player, right);
  res.status(status).render('tribe', { page: 'tribe', tab, player, can, canEdit: (m) => TribeService.canEdit(player, m), forum, forumUnread, feed: null, TribeCategories: require('../../services/TribeEventService').CATEGORIES, ...data, ...extra });
}

// ------------------------------------------------------------ Forum de la tribu

const tribeForumBase = (req) => `${base(req)}/tribe/forum`;

router.get('/tribe/forum/t/:threadId', ah(async (req, res) => {
  const data = await TribeForumService.thread(me(req), req.params.threadId, req.query.page === 'last' ? 'last' : req.query.page);
  await renderTribe(res, data.player, 'forum', { view: 'thread', ...data, form: {}, error: null });
}));

/** Vue d'un sous-forum : encadré des nouveaux messages, sujets (ou recherche, ou formulaire de nouveau sujet). */
async function sectionView(req, extra = {}) {
  const data = await TribeForumService.section(me(req), req.params.sectionId, req.query.page);
  const recent = await TribeForumService.recent(me(req), { excludeMuted: req.query.sourdine !== '0', page: req.query.np });
  const q = String(req.query.q || '').trim();
  const results = q ? await TribeForumService.search(me(req), q) : null;
  const compose = ['sujet', 'sondage'].includes(req.query.nouveau) ? req.query.nouveau : null;
  return { view: 'section', ...data, recent, q, results, compose, query: req.query, form: {}, error: null, ...extra };
}

router.get('/tribe/forum/settings', ah(async (req, res) => {
  const data = await TribeForumService.overview(me(req));
  if (!data.manager) throw new GameError('Réservé aux chefs de la tribu.', 403);
  await renderTribe(res, await Player.findByPk(me(req)), 'forum', { view: 'settings', ...data });
}));

router.get('/tribe/forum/:sectionId', ah(async (req, res) => {
  const forum = await sectionView(req);
  await renderTribe(res, forum.player, 'forum', forum);
}));

router.post('/tribe/forum/read-all', ah(async (req, res) => {
  await TribeForumService.markRead(me(req), null);
  flash(req, 'success', 'Tous les forums sont marqués comme lus.');
  res.redirect(back(req, `${base(req)}/tribe?tab=forum`));
}));
router.post('/tribe/forum/:sectionId/read', ah(async (req, res) => {
  await TribeForumService.markRead(me(req), req.params.sectionId);
  flash(req, 'success', 'Forum marqué comme lu.');
  res.redirect(back(req, `${tribeForumBase(req)}/${Number(req.params.sectionId)}`));
}));
router.post('/tribe/forum/:sectionId/mute', ah(async (req, res) => {
  const muted = await TribeForumService.toggleMute(me(req), req.params.sectionId);
  flash(req, 'success', muted ? 'Forum ignoré : il est mis en sourdine.' : 'Tu suis de nouveau ce forum.');
  res.redirect(back(req, `${tribeForumBase(req)}/${Number(req.params.sectionId)}`));
}));
router.post('/tribe/forum/t/:threadId/vote', ah(async (req, res) => {
  const thread = await TribeForumService.vote(me(req), req.params.threadId, req.body.option);
  flash(req, 'success', 'Vote enregistré.');
  res.redirect(`${tribeForumBase(req)}/t/${thread.id}`);
}));

router.post('/tribe/forum/sections', ah(async (req, res) => {
  await TribeForumService.createSection(me(req), req.body.name);
  flash(req, 'success', 'Sous-forum créé.');
  res.redirect(`${tribeForumBase(req)}/settings`);
}));
router.post('/tribe/forum/sections/:sectionId/rename', ah(async (req, res) => {
  await TribeForumService.renameSection(me(req), req.params.sectionId, req.body.name);
  flash(req, 'success', 'Sous-forum renommé.');
  res.redirect(`${tribeForumBase(req)}/settings`);
}));
router.post('/tribe/forum/sections/:sectionId/move', ah(async (req, res) => {
  await TribeForumService.moveSection(me(req), req.params.sectionId, req.body.dir);
  res.redirect(`${tribeForumBase(req)}/settings`);
}));
router.post('/tribe/forum/sections/:sectionId/delete', ah(async (req, res) => {
  await TribeForumService.deleteSection(me(req), req.params.sectionId);
  flash(req, 'success', 'Sous-forum supprimé.');
  res.redirect(`${tribeForumBase(req)}/settings`);
}));

router.post('/tribe/forum/t/:threadId', ah(async (req, res) => {
  try {
    const post = await TribeForumService.reply(me(req), req.params.threadId, req.body);
    res.redirect(`${tribeForumBase(req)}/t/${post.threadId}?page=last#p${post.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status >= 403) throw err;
    const data = await TribeForumService.thread(me(req), req.params.threadId, 'last');
    await renderTribe(res, data.player, 'forum', { view: 'thread', ...data, form: req.body, error: err.message }, 400);
  }
}));
router.post('/tribe/forum/t/:threadId/flag', ah(async (req, res) => {
  const flag = req.body.flag === 'locked' ? 'locked' : 'pinned';
  await TribeForumService.setFlag(me(req), req.params.threadId, flag, req.body.on === '1');
  res.redirect(back(req, tribeForumBase(req)));
}));
router.post('/tribe/forum/p/:postId/edit', ah(async (req, res) => {
  const post = await TribeForumService.edit(me(req), req.params.postId, req.body);
  flash(req, 'success', 'Message modifié.');
  res.redirect(`${tribeForumBase(req)}/t/${post.threadId}?page=${Number(req.body.page) || 1}#p${post.id}`);
}));
router.post('/tribe/forum/p/:postId/delete', ah(async (req, res) => {
  const { threadDeleted, thread } = await TribeForumService.remove(me(req), req.params.postId);
  flash(req, 'success', threadDeleted ? 'Sujet supprimé.' : 'Message supprimé.');
  res.redirect(threadDeleted ? `${tribeForumBase(req)}/${thread.sectionId}` : `${tribeForumBase(req)}/t/${thread.id}?page=last`);
}));
router.post('/tribe/forum/:sectionId', ah(async (req, res) => {
  try {
    const thread = await TribeForumService.createThread(me(req), req.params.sectionId, req.body);
    res.redirect(`${tribeForumBase(req)}/t/${thread.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status >= 403) throw err;
    req.query.nouveau = req.body.options !== undefined ? 'sondage' : 'sujet';
    const forum = await sectionView(req, { form: req.body, error: err.message });
    await renderTribe(res, forum.player, 'forum', forum, 400);
  }
}));

router.get('/tribes/:tribeId', ah(async (req, res) => {
  const data = await TribeService.profile(req.params.tribeId);
  if (data.tribe.worldId !== req.ctx.village.worldId) throw new GameError('Tribu introuvable.', 404);
  res.render('tribe-profile', { page: 'tribe', ...data });
}));

// Toutes les actions de tribu redirigent vers la page de la tribu (onglet d'origine conservé).
const tribeAction = (fn, message) => ah(async (req, res) => {
  await fn(req);
  if (message) flash(req, 'success', message);
  res.redirect(back(req, `${base(req)}/tribe`));
});

router.post('/tribe/create', ah(async (req, res) => {
  await TribeService.create(me(req), req.body);
  flash(req, 'success', 'Tribu fondée.');
  res.redirect(`${base(req)}/tribe`);
}));
router.post('/tribe/invites/:inviteId/accept', ah(async (req, res) => {
  await TribeService.acceptInvite(me(req), req.params.inviteId);
  flash(req, 'success', 'Bienvenue dans la tribu !');
  res.redirect(`${base(req)}/tribe`);
}));
router.post('/tribe/invites/:inviteId/decline', tribeAction((req) => TribeService.declineInvite(me(req), req.params.inviteId), 'Invitation refusée.'));
router.post('/tribe/invite', tribeAction((req) => TribeService.invite(me(req), req.body.name), 'Invitation envoyée.'));
router.post('/tribe/invites/:inviteId/cancel', tribeAction((req) => TribeService.cancelInvite(me(req), req.params.inviteId), 'Invitation retirée.'));
router.post('/tribe/members/:playerId/kick', tribeAction((req) => TribeService.kick(me(req), req.params.playerId), 'Membre exclu.'));
router.post('/tribe/members/:playerId/rights', tribeAction((req) => TribeService.setRights(me(req), req.params.playerId, req.body), 'Droits modifiés.'));
router.post('/tribe/description', tribeAction((req) => TribeService.updateDescription(me(req), req.body.description), 'Description enregistrée.'));
router.post('/tribe/avatar', tribeAction((req) => {
  if (!req.file) throw new GameError('Choisissez une image.');
  return TribeService.updateAvatar(me(req), req.file.buffer);
}, 'Image de la tribu enregistrée.'));
router.post('/tribe/avatar/delete', tribeAction((req) => TribeService.updateAvatar(me(req), null), 'Image de la tribu supprimée.'));
router.post('/tribe/announcement', tribeAction((req) => TribeService.updateAnnouncement(me(req), req.body.announcement), 'Annonces internes enregistrées.'));
router.post('/tribe/relations', tribeAction((req) => TribeService.setRelation(me(req), req.body.tag, req.body.type), 'Diplomatie mise à jour.'));
router.post('/tribe/relations/:relationId/delete', tribeAction((req) => TribeService.removeRelation(me(req), req.params.relationId), 'Relation supprimée.'));
router.post('/tribe/leave', ownerOnly, ah(async (req, res) => {
  await TribeService.leave(me(req));
  flash(req, 'success', 'Vous avez quitté la tribu.');
  res.redirect(`${base(req)}/tribe`);
}));

// ------------------------------------------------------------ Joueurs et messagerie

router.get('/players/:playerId', ah(async (req, res) => {
  const profile = await MapService.playerProfile(req.ctx.village.worldId, req.params.playerId);
  if (!profile) throw new GameError('Joueur introuvable.', 404);
  const achievements = await AchievementService.overview(profile.player.id);
  const daily = await DailyService.countsFor(profile.player.id);
  const isMe = profile.player.id === me(req);
  // Invitation possible depuis le profil : on dirige une tribu et le joueur n'en fait pas partie.
  const viewer = await Player.findByPk(me(req), { attributes: ['id', 'tribeId', 'tribeRole', 'tribeRights'] });
  const canInvite = !isMe && TribeService.can(viewer, 'invite') && profile.player.tribeId !== viewer.tribeId;
  // `subject` et non `player` : `player` est le joueur connecté, utilisé par l'en-tête.
  const { player: subject, ...rest } = profile;
  // Le contenu du profil s'affiche dans le thème de jeu de son propriétaire (les bots, sans compte, ont le thème par
  // défaut) ; l'en-tête et le pied de page gardent celui du visiteur.
  const owner = subject.userId ? await require('../../models').User.findByPk(subject.userId, { attributes: ['gameStyle'] }) : null;
  const ownerRights = await require('../../services/ShopService').rightsFor(subject.userId, subject.worldId);
  const ownerStyle = require('../gameStyles').gameStyleFor(owner, ownerRights);
  const profileStyle = ownerStyle.id === res.locals.gameStyle?.id ? null : ownerStyle;
  res.render('player', { ...rest, subject, profileStyle, page: isMe ? 'profile' : null, achievements, daily, TIER_NAMES: AchievementService.TIER_NAMES, isMe, canInvite });
}));

// Texte personnel du profil (réservé au titulaire du compte, pas au remplaçant).
router.post('/profile/text', ownerOnly, ah(async (req, res) => {
  const text = String(req.body.profileText || '').replace(/\r\n/g, '\n').trim();
  if (text.length > 2000) throw new GameError('Le texte personnel est limité à 2 000 caractères.');
  await Player.update({ profileText: text || null }, { where: { id: me(req) } });
  flash(req, 'success', 'Profil mis à jour.');
  res.redirect(`${base(req)}/players/${me(req)}`);
}));

// Image du profil (titulaire du compte seulement) : réduite et convertie en WebP, l'original n'est pas gardé.
router.post('/profile/avatar', ownerOnly, ah(async (req, res) => {
  if (!req.file) throw new GameError('Choisissez une image.');
  await ImageService.replaceAvatar(await Player.findByPk(me(req)), 'player', req.file.buffer);
  flash(req, 'success', 'Image du profil enregistrée.');
  res.redirect(`${base(req)}/players/${me(req)}`);
}));
router.post('/profile/avatar/delete', ownerOnly, ah(async (req, res) => {
  await ImageService.replaceAvatar(await Player.findByPk(me(req)), 'player', null);
  flash(req, 'success', 'Image du profil supprimée.');
  res.redirect(`${base(req)}/players/${me(req)}`);
}));

// Inviter des joueurs : lien d'inscription à partager.
router.get('/invite', (req, res) => {
  res.render('invite', { page: 'invite', registerUrl: `${req.protocol}://${req.get('host')}/register` });
});

// Favoris de la carte : ajout ou retrait d'un village.
router.post('/favorites/:villageId', ah(async (req, res) => {
  const on = await FavoriteService.toggle(me(req), req.ctx.village.worldId, req.params.villageId);
  flash(req, 'success', on ? 'Village ajouté aux favoris.' : 'Village retiré des favoris.');
  res.redirect(back(req, `${base(req)}/map`));
}));

// Informations sur un village (menu de la carte : « Voir le village »).
/**
 * Aperçu d'un village, comme sur GT : fiche et mini-carte, actions, carnet de notes, tes ordres en cours vers ce
 * village et tes rapports qui le concernent.
 */
router.get('/villages/:villageId', ah(async (req, res) => {
  const { Report, VillageNote, Command } = require('../../models');
  const target = await Village.findOne({
    where: { id: Number(req.params.villageId), worldId: req.ctx.village.worldId },
    include: [{ model: Player, include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
  });
  if (!target) throw new GameError('Village introuvable.', 404);
  const playerId = req.ctx.village.playerId;
  const me = await Player.findByPk(playerId, { attributes: ['id', 'tribeId', 'points'] });
  const relations = await TribeService.relationsOf(me.tribeId);
  const tribeId = target.Player && target.Player.tribeId;
  const relation = !target.playerId ? 'barb' : target.playerId === playerId ? 'own' : (tribeId && relations.get(tribeId)) || 'other';
  // Durées de trajet de toutes les unités du monde depuis le village courant.
  const dist = Math.hypot(target.x - req.ctx.village.x, target.y - req.ctx.village.y);
  const travel = registry.unitsFor(req.ctx.cfg).map((u) => ({ id: u.id, seconds: Math.round(dist * u.minutesPerField(req.ctx.cfg) * 60) }));
  const favorite = (await FavoriteService.list(playerId)).some((f) => f.villageId === target.id);
  const morale = req.ctx.cfg.moral && target.Player && target.playerId !== playerId ? combat.morale(me.points, target.Player.points, true) : null;

  // Tes ordres vers ce village (attaques, soutiens) et les retours qui en reviennent, depuis n'importe lequel de tes villages.
  const myIds = res.locals.myVillages.map((v) => v.id);
  const commands = await Command.findAll({
    where: { targetVillageId: target.id, originVillageId: myIds },
    include: [{ association: 'origin', attributes: ['id', 'name', 'x', 'y'] }],
    order: [['arrivesAt', 'ASC']],
  });

  // Tes rapports sur ce village (combats, soutiens, commerce), les plus récents d'abord.
  const concerns = (d) => [d.defender && d.defender.villageId, d.attacker && d.attacker.villageId, d.seller && d.seller.villageId,
    d.buyer && d.buyer.villageId, d.sender && d.sender.villageId, d.recipient && d.recipient.villageId].includes(target.id);
  const recent = await Report.findAll({
    where: { playerId, type: ['attack', 'defense', 'support', 'trade'] }, order: [['happenedAt', 'DESC'], ['id', 'DESC']], limit: 500,
  });
  const reports = recent.filter((r) => concerns(r.data || {})).slice(0, 25);

  // Mini-carte de 61 × 61 cases centrée sur le village (même rendu que la carte), le village encadré.
  const vc = await mapView.viewContext(req.ctx.village, req.ctx.cfg);
  const half = 30;
  const mini = { x0: target.x - half, y0: target.y - half, width: 2 * half + 1, height: 2 * half + 1 };
  mini.villages = await mapView.mini(vc, mini.x0, mini.y0, mini.width);
  mini.frame = { x: target.x - 1, y: target.y - 1, size: 3 };

  const note = await VillageNote.findOne({ where: { playerId, villageId: target.id } });
  // Notes de la tribu sur ce village (si tu affiches les notes partagées par ta tribu).
  const viewer = await Player.findByPk(playerId, { attributes: ['id', 'tribeId', 'showTribeNotes'] });
  const tribeNotes = ((await require('../../services/VillageNoteService').visible(viewer, [target.id])).get(target.id) || []).filter((n) => !n.mine);
  res.render('village-info', {
    page: null, target, relation, dist, travel, favorite, morale, commands, reports, mini,
    note: note ? note.text : '', tribeNotes, showTribeNotes: viewer.showTribeNotes, templates: await ArmyTemplateService.list(playerId),
    outcomeOf: require('../../game/lastAttack').outcome,
  });
}));

// Carnet de notes d'un village (aperçu du village) ; une note vide l'efface.
router.post('/villages/:villageId/note', ah(async (req, res) => {
  const { VillageNote } = require('../../models');
  const target = await Village.findOne({ where: { id: Number(req.params.villageId), worldId: req.ctx.village.worldId }, attributes: ['id'] });
  if (!target) throw new GameError('Village introuvable.', 404);
  const text = String(req.body.text || '').replace(/\r\n/g, '\n').trim();
  if (text.length > 2000) throw new GameError('La note est limitée à 2 000 caractères.');
  const where = { playerId: me(req), villageId: target.id };
  if (!text) await VillageNote.destroy({ where });
  else {
    const [note, created] = await VillageNote.findOrCreate({ where, defaults: { text } });
    if (!created) await note.update({ text });
  }
  flash(req, 'success', text ? 'Note enregistrée.' : 'Note effacée.');
  res.redirect(`${base(req)}/villages/${target.id}`);
}));

// Messagerie, organisée comme sur GT : boîte de réception, courriers circulaires envoyés, écrire un message.
router.get('/messages', ah(async (req, res) => {
  const player = await Player.findByPk(me(req));
  const perPage = PaginationService.perPage(player, 'messages');
  const inbox = await MessageService.inbox(player.id, { page: req.query.page, perPage, search: req.query.q });
  res.render('messages', { page: 'messages', tab: 'inbox', inbox, perPage });
}));

router.get('/messages/circular', ah(async (req, res) => {
  res.render('messages', { page: 'messages', tab: 'circular', circulars: await MessageService.circulars(me(req)) });
}));

/** Formulaire d'écriture ; `form` garde la saisie quand l'envoi est refusé. */
async function renderNewMessage(req, res, form, status = 200) {
  const player = await Player.findByPk(me(req));
  res.status(status).render('message-new', {
    page: 'messages', tab: 'new', form, max: MessageService.MAX_RECIPIENTS, groups: MessageService.groupsFor(player),
  });
}

router.get('/messages/new', ah(async (req, res) => {
  await renderNewMessage(req, res, { to: String(req.query.to || ''), group: '', subject: '', body: '' });
}));

router.post('/messages', ah(async (req, res) => {
  const form = { to: String(req.body.to || ''), group: String(req.body.group || ''), subject: String(req.body.subject || ''), body: String(req.body.body || '') };
  try {
    const conv = await MessageService.start(me(req), form);
    res.redirect(`${base(req)}/messages/${conv.id}`);
  } catch (err) {
    if (!(err instanceof GameError) || err.status >= 500) throw err;
    res.locals.flash = { type: 'error', message: err.message };
    await renderNewMessage(req, res, form, 422);
  }
}));

router.post('/messages/delete', ah(async (req, res) => {
  const n = await MessageService.leaveMany(me(req), req.body.ids);
  flash(req, 'success', n > 1 ? `${n} conversations effacées.` : 'Conversation effacée.');
  res.redirect(back(req, `${base(req)}/messages`));
}));


router.get('/messages/:conversationId', ah(async (req, res) => {
  const conversation = await MessageService.read(me(req), req.params.conversationId);
  res.locals.unreadMessages = await MessageService.unreadCount(me(req));
  res.render('conversation', { page: 'messages', conversation, MessageGroups: MessageService.GROUPS });
}));

router.post('/messages/:conversationId/reply', ah(async (req, res) => {
  await MessageService.reply(me(req), req.params.conversationId, req.body.body);
  res.redirect(`${base(req)}/messages/${Number(req.params.conversationId)}#bas`);
}));

router.post('/messages/:conversationId/leave', ah(async (req, res) => {
  await MessageService.leave(me(req), req.params.conversationId);
  flash(req, 'success', 'Conversation supprimée de votre boîte.');
  res.redirect(`${base(req)}/messages`);
}));

// ------------------------------------------------------------ Compte (sommeil, remplaçant)

// Réglages tribu : partage des notes de village.
router.post('/account/tribe-settings', ownerOnly, ah(async (req, res) => {
  const VillageNoteService = require('../../services/VillageNoteService');
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
  res.render('account', { page: 'account', sitter, sitting, tribeSharing: require('../../services/VillageNoteService').TRIBE_SHARING });
}));

router.use('/account', (req, res, next) => (req.method === 'POST' ? ownerOnly(req, res, next) : next()));

router.post('/account/game-style', ah(async (req, res) => {
  const { isGameStyle, GAME_STYLES } = require('../gameStyles');
  const id = String(req.body.style || '');
  if (!isGameStyle(id)) throw new GameError('Thème inconnu.');
  if (!res.locals.shopRights.has(`theme:${id}`)) throw new GameError(`Le thème ${GAME_STYLES[id].name} se débloque à la boutique.`);
  await req.user.update({ gameStyle: id });
  flash(req, 'success', `Thème ${GAME_STYLES[id].name} appliqué.`);
  res.redirect(`${base(req)}/account`);
}));

// Style de jeu : densité de l'interface (normal ou minimaliste), indépendante du thème.
router.post('/account/game-layout', ah(async (req, res) => {
  const { isGameLayout, GAME_LAYOUTS } = require('../gameLayouts');
  const id = String(req.body.layout || '');
  if (!isGameLayout(id)) throw new GameError('Style de jeu inconnu.');
  await req.user.update({ gameLayout: id });
  flash(req, 'success', `Style de jeu ${GAME_LAYOUTS[id].name.toLowerCase()} appliqué.`);
  res.redirect(`${base(req)}/account#style-de-jeu`);
}));

// Design des villages : skin de ses villages sur la carte, vu par tous (réglage du compte, comme le style de jeu).
router.post('/account/village-design', ah(async (req, res) => {
  const { isVillageDesign, VILLAGE_DESIGNS } = require('../villageDesigns');
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

// ------------------------------------------------------------ Rapports

router.get('/reports', ah(async (req, res) => {
  const filter = ReportService.FILTERS.includes(req.query.filter) ? req.query.filter : 'all';
  const data = await ReportService.list(me(req), { filter, page: req.query.page, perPage: PaginationService.perPage(res.locals.player, 'reports') });
  const { reports, ...pagination } = data;
  res.render('reports', { reports, total: data.total, pagination, page: 'reports', filter });
}));

router.post('/reports/bulk', ah(async (req, res) => {
  const n = req.body.action === 'read-all'
    ? await ReportService.markAllRead(me(req))
    : await ReportService.bulk(me(req), req.body.action, req.body.ids);
  const [one, many] = {
    delete: ['supprimé', 'supprimés'],
    read: ['marqué comme lu', 'marqués comme lus'],
    unread: ['marqué comme non lu', 'marqués comme non lus'],
    'read-all': ['marqué comme lu', 'marqués comme lus'],
  }[req.body.action];
  flash(req, 'success', n > 1 ? `${n} rapports ${many}.` : `${n} rapport ${one}.`);
  res.redirect(back(req, `${base(req)}/reports`));
}));

router.get('/reports/:reportId', ah(async (req, res) => {
  const report = await ReportService.get(me(req), req.params.reportId);
  if (!report.isRead) {
    await report.update({ isRead: true });
    res.locals.unreadReports = Math.max(0, res.locals.unreadReports - 1);
  }
  res.render('report', { page: 'reports', report, neighbours: await ReportService.neighbours(me(req), report) });
}));

router.post('/reports/:reportId/delete', ah(async (req, res) => {
  await ReportService.bulk(me(req), 'delete', [req.params.reportId]);
  flash(req, 'success', 'Rapport supprimé.');
  res.redirect(`${base(req)}/reports`);
}));

// ------------------------------------------------------------ Classements et fin du monde (dans l'interface du jeu)

router.get('/ranking', ah(async (req, res) => {
  const { rankingLocals } = require('./worlds');
  const viewer = await Player.findByPk(me(req), { attributes: ['id', 'tribeId'] });
  res.render('ranking', { page: 'ranking', ...(await rankingLocals(req.ctx.world, req.query, { playerId: viewer.id, tribeId: viewer.tribeId })) });
}));

// Ancienne adresse de la fin du monde : elle est maintenant dans les classements.
router.get('/victory', (req, res) => res.redirect(`${base(req)}/ranking?type=victory`));

// ------------------------------------------------------------ Carte

// Tailles proposées (comme sur Guerre Tribale) et calques de la carte, mémorisés sur le joueur (mapSettings).
const MAP_SIZES = [4, 5, 7, 9, 11, 13, 15, 20, 30];
const MINI_SIZES = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
const MAP_LAYERS = { influence: true, enemy: true, nobarb: false, grid: false, borders: true, markers: true, moves: true, church: true };

router.get('/map', ah(async (req, res) => {
  const { village, cfg } = req.ctx;
  const vc = await mapView.viewContext(village, cfg);
  const { player } = vc;
  const saved = player.mapSettings || {};
  // Taille choisie dans « Taille de la carte » : appliquée puis mémorisée ; sinon celle mémorisée.
  const pick = (value, list, fallback) => (list.includes(Number(value)) ? Number(value) : fallback);
  // Les anciennes grandes tailles enregistrées donnaient une vue initiale trop éloignée. On les ramène
  // une fois à 15 × 15 ; l'utilisateur peut toujours sélectionner explicitement 20 ou 30 ensuite.
  const savedSize = pick(saved.size, MAP_SIZES, 13);
  const normalizedSavedSize = saved.mapZoomV2 ? savedSize : Math.min(savedSize, 15);
  const displaySize = pick(req.query.size, MAP_SIZES, normalizedSavedSize);
  const savedMiniSize = pick(saved.mini, MINI_SIZES, 50);
  const normalizedMiniSize = saved.mapMiniZoomV2 ? savedMiniSize : Math.min(savedMiniSize, 50);
  const miniSize = pick(req.query.mini, MINI_SIZES, normalizedMiniSize);
  if (displaySize !== saved.size || miniSize !== saved.mini || !saved.mapZoomV2 || !saved.mapMiniZoomV2) {
    await player.update({ mapSettings: { ...saved, size: displaySize, mini: miniSize, mapZoomV2: true, mapMiniZoomV2: true } });
  }
  const layers = { ...MAP_LAYERS, ...(saved.layers || {}) };
  const clamp = (v, d) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(cfg.mapSize - 1, Math.max(0, n)) : d;
  };
  const cx = clamp(req.query.x, village.x);
  const cy = clamp(req.query.y, village.y);
  // Case mise en évidence (résultat de recherche, lien vers des coordonnées).
  const sel = req.query.sx != null ? { x: clamp(req.query.sx, cx), y: clamp(req.query.sy, cy) } : null;
  // Recherche (panneau de la carte) : joueur, village, tribu ; des coordonnées recentrent directement la carte.
  const find = ['player', 'village', 'tribe', 'coords'].includes(req.query.find) ? req.query.find : 'player';
  const q = String(req.query.q || '').trim();
  if (find === 'coords' && q) {
    const m = /^\s*(\d+)\D+(\d+)\s*$/.exec(q);
    if (m) return res.redirect(`/village/${village.id}/map?x=${clamp(m[1], cx)}&y=${clamp(m[2], cy)}&sx=${clamp(m[1], cx)}&sy=${clamp(m[2], cy)}`);
  }
  const search = { find, q, results: q && find !== 'coords' ? await MapService.search(village.worldId, find, q) : null };
  // Premiers secteurs (zone affichée et ses abords) et mini-carte, intégrés à la page : pas d'attente au premier affichage.
  const half = Math.floor(displaySize / 2);
  const around = mapView.sectorsCovering(cx - half - 10, cy - half - 10, cx + half + 10, cy + half + 10);
  const miniHalf = Math.floor(miniSize / 2);
  const [templates, sectors, miniVillages, movements] = await Promise.all([
    ArmyTemplateService.list(village.playerId),
    Promise.all(around.map(([sx, sy]) => mapView.sector(vc, sx, sy))),
    mapView.mini(vc, cx - miniHalf, cy - miniHalf, miniSize),
    CommandService.overview(village.id),
  ]);
  const attacks = movements.outgoing.filter((c) => c.type === 'attack').map((c) => [c.target.x, c.target.y]);
  // Mondes avec église : zones d'influence de ses églises (calque « Zones de foi ») : [x, y, rayon].
  const churches = (await require('../../services/FaithService').churches(village.playerId, cfg)).map((c) => [c.x, c.y, c.radius]);
  // Infobulle : durée du trajet de chaque unité (minutes par case) ; menu : éclaireurs proposés pour « Espionner ».
  const paces = registry.unitsFor(cfg).map((u) => ({ id: u.id, name: u.name, minutes: u.minutesPerField(cfg) }));
  const spyCount = Math.min(req.ctx.state.units.spy || 0, 5);
  // Marquage à créer depuis le menu d'un village (?mark=player:12) : formulaire pré-rempli.
  const markMatch = /^(player|tribe|village):(\d+)$/.exec(String(req.query.mark || ''));
  const markForm = markMatch ? { type: markMatch[1], targetId: Number(markMatch[2]), label: String(req.query.label || '') } : null;
  res.render('map', {
    page: 'map', cx, cy, sel, displaySize, miniSize, mapSizes: MAP_SIZES, miniSizes: MINI_SIZES, layers,
    paces, spyCount, search, templates, favorites: vc.favorites, markers: vc.markers, markerColor: MarkerService.DEFAULT_COLOR, markForm,
    mapBoot: { sector: mapView.SECTOR, sectors, mini: miniVillages, attacks, churches, worldSize: cfg.mapSize, attackDots: res.locals.attackDots() },
  });
}));

// Carte : villages d'un secteur de 20 × 20 cases, chargé par le navigateur pendant les déplacements.
router.get('/map/sector', ah(async (req, res) => {
  const sx = Number.parseInt(req.query.sx, 10);
  const sy = Number.parseInt(req.query.sy, 10);
  const max = Math.ceil(req.ctx.cfg.mapSize / mapView.SECTOR);
  if (!(sx >= 0 && sy >= 0 && sx < max && sy < max)) throw new GameError('Secteur hors de la carte.', 404);
  res.json(await mapView.sector(await mapView.viewContext(req.ctx.village, req.ctx.cfg), sx, sy));
}));

// Mini-carte recentrée : points colorés des villages du carré.
router.get('/map/mini', ah(async (req, res) => {
  const size = MINI_SIZES.includes(Number(req.query.size)) ? Number(req.query.size) : 50;
  const x0 = Number.parseInt(req.query.x0, 10) || 0;
  const y0 = Number.parseInt(req.query.y0, 10) || 0;
  res.json(await mapView.mini(await mapView.viewContext(req.ctx.village, req.ctx.cfg), x0, y0, size));
}));

// Tailles de la carte et de la mini-carte : appliquées en direct par map.js, puis mémorisées ici.
router.post('/map/settings', ah(async (req, res) => {
  const player = await Player.findByPk(me(req));
  const saved = player.mapSettings || {};
  const size = MAP_SIZES.includes(Number(req.body.size)) ? Number(req.body.size) : saved.size;
  const mini = MINI_SIZES.includes(Number(req.body.mini)) ? Number(req.body.mini) : saved.mini;
  await player.update({ mapSettings: { ...saved, size, mini } });
  if (req.get('accept') === 'application/json') return res.json({ size, mini });
  res.redirect(`${base(req)}/map`);
}));

// Carte du monde (fenêtre ouverte par map.js) : un point par village (relation, marquage), comme la mini-carte.
router.get('/map/world', ah(async (req, res) => {
  const vc = await mapView.viewContext(req.ctx.village, req.ctx.cfg);
  const villages = await MapService.worldMap(req.ctx.village.worldId);
  res.json({ size: req.ctx.cfg.mapSize, villages: villages.map((v) => mapView.point(vc, v)) });
}));

// Calques de la carte : interrupteur mémorisé sur le joueur (appel de game.js).
router.post('/map/layers', ah(async (req, res) => {
  const layer = String(req.body.layer || '');
  if (!Object.prototype.hasOwnProperty.call(MAP_LAYERS, layer)) throw new GameError('Calque inconnu.', 404);
  const player = await Player.findByPk(me(req));
  const saved = player.mapSettings || {};
  await player.update({ mapSettings: { ...saved, layers: { ...(saved.layers || {}), [layer]: req.body.on === '1' } } });
  res.json({ ok: true });
}));

// Marquages de la carte : ajout (ou changement de couleur) et suppression.
router.post('/map/markers', ah(async (req, res) => {
  await MarkerService.set(me(req), req.ctx.village.worldId, {
    type: req.body.type, targetId: req.body.targetId, target: req.body.target, color: req.body.color,
  });
  // Le nouveau marquage doit se voir : le calque Marquages est réactivé s'il était masqué.
  const player = await Player.findByPk(me(req));
  const saved = player.mapSettings || {};
  if (saved.layers && saved.layers.markers === false) {
    await player.update({ mapSettings: { ...saved, layers: { ...saved.layers, markers: true } } });
  }
  flash(req, 'success', 'Marquage enregistré.');
  res.redirect(`${base(req)}/map#marquages`);
}));

router.post('/map/markers/:markerId/delete', ah(async (req, res) => {
  await MarkerService.remove(me(req), req.params.markerId);
  flash(req, 'success', 'Marquage supprimé.');
  res.redirect(`${base(req)}/map#marquages`);
}));

module.exports = router;
