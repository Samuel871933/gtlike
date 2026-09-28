'use strict';

const express = require('express');
const VillageService = require('../../services/VillageService');
const CommandService = require('../../services/CommandService');
const { sequelize, Player, Village, Tribe } = require('../../models');
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
const TribeForumService = require('../../services/TribeForumService');
const scavenging = require('../../game/scavenging');
const knightSkills = require('../../game/knightSkills');
const GameError = require('../../services/GameError');
const registry = require('../../game/registry');
const combat = require('../../game/combat');
const { ah, back, flash, requireAuth, loadVillage, ownerOnly } = require('../middleware');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, loadVillage);

const base = (req) => `/village/${req.ctx.village.id}`;
const me = (req) => req.ctx.village.playerId;

router.get('/', ah(async (req, res) => {
  const movements = await CommandService.overview(req.ctx.village.id);
  const supportUnits = movements.stacksHere.reduce((acc, s) => CommandService.addUnits(acc, s.units), {});
  // Options de construction, pour l'encart du bâtiment sélectionné sur le plan.
  const buildOptions = Object.fromEntries(registry.buildingsFor(req.ctx.cfg).map((type) => [type.id, VillageService.buildOption(req.ctx, type)]));
  res.render('overview', {
    page: 'overview', supportUnits, movements, buildOptions,
    view: req.query.vue === 'liste' ? 'list' : 'city',
    moveTab: ['all', 'in', 'out'].includes(req.query.mv) ? req.query.mv : null,
    allMoves: req.query.tous === '1',
  });
}));

router.post('/rename', ah(async (req, res) => {
  await VillageService.rename(req.ctx.village.id, req.body.name);
  flash(req, 'success', 'Village renommé.');
  res.redirect(base(req));
}));

// ------------------------------------------------------------ Quartier général

router.get('/main', (req, res) => {
  const options = registry.buildingsFor(req.ctx.cfg).map((type) => VillageService.buildOption(req.ctx, type));
  res.render('main', {
    page: 'main',
    available: options.filter((o) => !o.maxed && !(o.missing && o.missing.length)),
    maxed: options.filter((o) => o.maxed),
    locked: options.filter((o) => !o.maxed && o.missing && o.missing.length),
  });
});

/** Page d'information d'un bâtiment sans page dédiée (mines, ferme, entrepôt, cachette, muraille…). */
router.get('/building/:building', (req, res) => {
  const type = registry.BUILDINGS.get(req.params.building);
  if (!type || !type.isAvailableIn(req.ctx.cfg)) throw new GameError('Bâtiment introuvable.', 404);
  res.render('building', { page: type.id, buildingId: type.id, option: VillageService.buildOption(req.ctx, type) });
});

router.post('/build', ah(async (req, res) => {
  const order = await VillageService.build(req.ctx.village.id, String(req.body.building || ''));
  flash(req, 'success', `${registry.building(order.building).name} niveau ${order.level} ajouté à la file.`);
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
  };
  if (!Object.keys(input.attackers).length) return { input, result: null };
  const result = combat.resolve({
    attackers: input.attackers, defenders: input.defenders, wall: input.wall, morale: input.morale, luck: input.luck,
    nightFactor: input.night ? cfg.night.defFactor : 1,
  });
  return { input, result };
}

router.get('/place', ah(async (req, res) => {
  const tab = ['commands', 'troops', 'sim'].includes(req.query.tab) ? req.query.tab : 'commands';
  const lists = await CommandService.overview(req.ctx.village.id);
  res.render('place', {
    page: 'place',
    tab,
    ...lists,
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
    templates: await ArmyTemplateService.list(me(req)),
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
  res.render('place-confirm', { page: 'place', plan, catapultTargets });
}));

router.post('/place/send', ah(async (req, res) => {
  const order = readOrder(req);
  const cmd = await orUnwind(req, res, order, () => CommandService.send(req.ctx.village.id, order));
  if (!cmd) return;
  flash(req, 'success', cmd.type === 'attack' ? 'Attaque envoyée.' : 'Soutien envoyé.');
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

// ------------------------------------------------------------ Marché

const MARKET_TABS = ['send', 'offers', 'mine', 'transports'];

router.get('/market', ah(async (req, res) => {
  const tab = MARKET_TABS.includes(req.query.tab) ? req.query.tab : 'send';
  const [merchants, lists] = await Promise.all([
    VillageService.withVillage(req.ctx.village.id, (ctx, t) => TradeService.merchants(ctx, t)),
    TradeService.overview(req.ctx.village.id),
  ]);
  const filters = { sell: req.query.sell || '', buy: req.query.buy || '' };
  const offers = tab === 'offers' ? await TradeService.listOffers(req.ctx, filters) : [];
  res.render('market', {
    page: 'market', tab, merchants, filters,
    outgoing: lists.outgoing, incoming: lists.incoming, ownOffers: lists.offers, offers,
    form: { x: req.query.x || '', y: req.query.y || '' },
  });
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
  res.redirect(`${base(req)}/market?tab=mine`);
}));

router.post('/market/offers/:offerId/cancel', ah(async (req, res) => {
  await TradeService.cancelOffer(req.ctx.village.id, req.params.offerId);
  flash(req, 'success', 'Offre retirée, ressources rendues.');
  res.redirect(`${base(req)}/market?tab=mine`);
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
  const tab = ['overview', 'members', 'diplomacy', 'wall'].includes(req.query.tab) ? req.query.tab : 'overview';
  await renderTribe(res, player, tab, null);
}));

/** Page de la tribu (en-tête et onglets), avec au besoin une vue du forum de tribu. */
async function renderTribe(res, player, tab, forum, status = 200) {
  const data = await TribeService.dashboard(player);
  const forumUnread = await TribeForumService.unreadCount(player.id);
  res.status(status).render('tribe', { page: 'tribe', tab, player, canManage: TribeService.canManage(player), TribeRoles: TribeService.ROLES, forum, forumUnread, ...data });
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
router.post('/tribe/members/:playerId/role', tribeAction((req) => TribeService.setRole(me(req), req.params.playerId, req.body.role), 'Rôle modifié.'));
router.post('/tribe/description', tribeAction((req) => TribeService.updateDescription(me(req), req.body.description), 'Description enregistrée.'));
router.post('/tribe/relations', tribeAction((req) => TribeService.setRelation(me(req), req.body.tag, req.body.type), 'Diplomatie mise à jour.'));
router.post('/tribe/relations/:relationId/delete', tribeAction((req) => TribeService.removeRelation(me(req), req.params.relationId), 'Relation supprimée.'));
router.post('/tribe/messages', tribeAction((req) => TribeService.post(me(req), req.body.body)));
router.post('/tribe/messages/:messageId/delete', tribeAction((req) => TribeService.deleteMessage(me(req), req.params.messageId), 'Message supprimé.'));
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
  const viewer = await Player.findByPk(me(req), { attributes: ['id', 'tribeId', 'tribeRole'] });
  const canInvite = !isMe && Boolean(viewer.tribeId) && ['founder', 'leader'].includes(viewer.tribeRole) && profile.player.tribeId !== viewer.tribeId;
  // `subject` et non `player` : `player` est le joueur connecté, utilisé par l'en-tête.
  const { player: subject, ...rest } = profile;
  res.render('player', { ...rest, subject, page: isMe ? 'profile' : null, achievements, daily, TIER_NAMES: AchievementService.TIER_NAMES, isMe, canInvite });
}));

// Texte personnel du profil (réservé au titulaire du compte, pas au remplaçant).
router.post('/profile/text', ownerOnly, ah(async (req, res) => {
  const text = String(req.body.profileText || '').replace(/\r\n/g, '\n').trim();
  if (text.length > 2000) throw new GameError('Le texte personnel est limité à 2 000 caractères.');
  await Player.update({ profileText: text || null }, { where: { id: me(req) } });
  flash(req, 'success', 'Profil mis à jour.');
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
router.get('/villages/:villageId', ah(async (req, res) => {
  const target = await Village.findOne({
    where: { id: Number(req.params.villageId), worldId: req.ctx.village.worldId },
    include: [{ model: Player, include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
  });
  if (!target) throw new GameError('Village introuvable.', 404);
  const me = await Player.findByPk(req.ctx.village.playerId, { attributes: ['tribeId'] });
  const relations = await TribeService.relationsOf(me.tribeId);
  const tribeId = target.Player && target.Player.tribeId;
  const relation = !target.playerId ? 'barb' : target.playerId === req.ctx.village.playerId ? 'own' : (tribeId && relations.get(tribeId)) || 'other';
  const units = ['spear', 'axe', 'light', 'ram', 'snob'].filter((id) => registry.unitsFor(req.ctx.cfg).some((u) => u.id === id));
  const dist = Math.hypot(target.x - req.ctx.village.x, target.y - req.ctx.village.y);
  const travel = units.map((id) => ({ id, seconds: Math.round(dist * registry.unit(id).minutesPerField(req.ctx.cfg) * 60) }));
  const favorite = (await FavoriteService.list(req.ctx.village.playerId)).some((f) => f.villageId === target.id);
  const attacker = await Player.findByPk(req.ctx.village.playerId, { attributes: ['points'] });
  const morale = req.ctx.cfg.moral && target.Player && target.playerId !== req.ctx.village.playerId ? combat.morale(attacker.points, target.Player.points, true) : null;
  res.render('village-info', { page: null, target, relation, dist, travel, favorite, morale });
}));

router.get('/messages', ah(async (req, res) => {
  res.render('messages', { page: 'messages', inbox: await MessageService.inbox(me(req)) });
}));

router.get('/messages/new', (req, res) => {
  res.render('message-new', { page: 'messages', form: { to: req.query.to || '', subject: '', body: '' }, max: MessageService.MAX_RECIPIENTS });
});

router.post('/messages', ah(async (req, res) => {
  const conv = await MessageService.start(me(req), req.body);
  res.redirect(`${base(req)}/messages/${conv.id}`);
}));

router.get('/messages/:conversationId', ah(async (req, res) => {
  const conversation = await MessageService.read(me(req), req.params.conversationId);
  res.locals.unreadMessages = await MessageService.unreadCount(me(req));
  res.render('conversation', { page: 'messages', conversation });
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

router.get('/account', ah(async (req, res) => {
  const player = res.locals.player;
  const [sitter, sitting] = await Promise.all([
    player.sitterId ? Player.findByPk(player.sitterId) : null,
    SitterService.sittingFor(player.id),
  ]);
  res.render('account', { page: 'account', sitter, sitting });
}));

router.use('/account', (req, res, next) => (req.method === 'POST' ? ownerOnly(req, res, next) : next()));

router.post('/account/game-style', ah(async (req, res) => {
  const { isGameStyle, GAME_STYLES } = require('../gameStyles');
  const id = String(req.body.style || '');
  if (!isGameStyle(id)) throw new GameError('Style inconnu.');
  await req.user.update({ gameStyle: id });
  flash(req, 'success', `Style ${GAME_STYLES[id].name} appliqué.`);
  res.redirect(`${base(req)}/account`);
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
  const data = await ReportService.list(me(req), { filter, page: req.query.page });
  res.render('reports', { ...data, page: 'reports', pageNumber: data.page, filter });
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
  res.render('report', { page: 'reports', report });
}));

router.post('/reports/:reportId/delete', ah(async (req, res) => {
  await ReportService.bulk(me(req), 'delete', [req.params.reportId]);
  flash(req, 'success', 'Rapport supprimé.');
  res.redirect(`${base(req)}/reports`);
}));

// ------------------------------------------------------------ Classements et fin du monde (dans l'interface du jeu)

router.get('/ranking', ah(async (req, res) => {
  const { rankingLocals } = require('./worlds');
  res.render('ranking', { page: 'ranking', ...(await rankingLocals(req.ctx.world, req.query)) });
}));

router.get('/victory', ah(async (req, res) => {
  const { victoryLocals } = require('./worlds');
  res.render('victory', { page: 'victory', ...(await victoryLocals(req.ctx.world)) });
}));

// ------------------------------------------------------------ Carte

router.get('/map', ah(async (req, res) => {
  const { village, cfg } = req.ctx;
  const mapSizes = [7, 9, 11, 13, 15];
  const miniSizes = [25, 35, 50, 70];
  const displaySize = mapSizes.includes(Number(req.query.size)) ? Number(req.query.size) : 13;
  const miniSize = miniSizes.includes(Number(req.query.mini)) ? Number(req.query.mini) : 35;
  const showWorldMap = req.query.world === '1';
  const clamp = (v, d) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(cfg.mapSize - 1, Math.max(0, n)) : d;
  };
  // « Aller à » : une seule case de saisie « 529|546 » (ou x et y séparés).
  const typed = /^\s*(\d+)\D+(\d+)\s*$/.exec(String(req.query.c || ''));
  const cx = clamp(typed ? typed[1] : req.query.x, village.x);
  const cy = clamp(typed ? typed[2] : req.query.y, village.y);
  // Case sélectionnée (panneau « Cible ») : celle visée, sinon le village courant.
  const sx = clamp(req.query.sx, typed || req.query.x ? cx : village.x);
  const sy = clamp(req.query.sy, typed || req.query.y ? cy : village.y);
  // Recherche (panneau de la carte) : joueur, village, tribu ; des coordonnées recentrent directement la carte.
  const find = ['player', 'village', 'tribe', 'coords'].includes(req.query.find) ? req.query.find : 'player';
  const q = String(req.query.q || '').trim();
  if (find === 'coords' && q) {
    const m = /^\s*(\d+)\D+(\d+)\s*$/.exec(q);
    if (m) return res.redirect(`/village/${village.id}/map?x=${clamp(m[1], cx)}&y=${clamp(m[2], cy)}&sx=${clamp(m[1], cx)}&sy=${clamp(m[2], cy)}&size=${displaySize}&mini=${miniSize}`);
  }
  const search = { find, q, results: q && find !== 'coords' ? await MapService.search(village.worldId, find, q) : null };
  const templates = await ArmyTemplateService.list(village.playerId);
  const favorites = await FavoriteService.list(village.playerId);
  const [area, overviewArea, player, movements, worldVillages] = await Promise.all([
    MapService.area(village.worldId, cx, cy, displaySize),
    MapService.area(village.worldId, cx, cy, miniSize),
    Player.findByPk(village.playerId),
    CommandService.overview(village.id),
    showWorldMap ? MapService.worldMap(village.worldId) : Promise.resolve([]),
  ]);
  const relations = await TribeService.relationsOf(player.tribeId);
  const attacks = movements.outgoing.filter((c) => c.type === 'attack').map((c) => ({ x: c.target.x, y: c.target.y }));
  // Infobulle : durée du trajet de chaque unité (minutes par case) ; menu : éclaireurs proposés pour « Espionner ».
  const paces = registry.unitsFor(cfg).map((u) => ({ id: u.id, name: u.name, minutes: u.minutesPerField(cfg) }));
  // Morale de tes attaques selon les points du joueur visé (null si le monde n'a pas de morale).
  const moraleOf = cfg.moral ? (points) => combat.morale(player.points, points, true) : null;
  const spyCount = Math.min(req.ctx.state.units.spy || 0, 5);
  res.render('map', { page: 'map', area, overviewArea, cx, cy, sx, sy, relations, attacks, displaySize, miniSize, mapSizes, miniSizes, showWorldMap, worldVillages, paces, spyCount, search, templates, favorites, moraleOf });
}));

module.exports = router;
