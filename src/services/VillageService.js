'use strict';

const { Op } = require('sequelize');
const {
  sequelize, World, Player, Village, BuildOrder, RecruitOrder, ResearchOrder, Command, SupportStack,
} = require('../models');
const VillageState = require('../game/VillageState');
const barbarian = require('../game/barbarian');
const KnightSkillService = require('./KnightSkillService');
const registry = require('../game/registry');
const GameError = require('./GameError');

/**
 * Contexte d'un village chargé et mis à jour à un instant donné.
 * `awayUnits` : troupes du village hors de chez elles (en mouvement ou en soutien).
 * @typedef {{ village, world, cfg, state, buildOrders: BuildOrder[], recruitOrders: RecruitOrder[],
 *   awayUnits: object, popUsed: () => number, now: Date }} VillageContext
 */

class VillageService {
  /** Charge un village dans une transaction, applique tout ce qui s'est terminé et sauvegarde. */
  static async withVillage(villageId, fn, { now = new Date() } = {}) {
    return sequelize.transaction(async (t) => {
      const ctx = await VillageService.refresh(villageId, t, now);
      return fn(ctx, t);
    });
  }

  /** @returns {Promise<VillageContext>} */
  static async refresh(villageId, t, now = new Date()) {
    const village = await Village.findByPk(villageId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!village) throw new GameError('Village introuvable.', 404);
    const world = await World.findByPk(village.worldId, { transaction: t });
    const cfg = world.getConfig();

    let buildOrders = await BuildOrder.findAll({ where: { villageId }, order: [['endsAt', 'ASC']], transaction: t });
    let recruitOrders = await RecruitOrder.findAll({ where: { villageId }, order: [['startsAt', 'ASC']], transaction: t });
    let researchOrders = await ResearchOrder.findAll({ where: { villageId }, order: [['endsAt', 'ASC']], transaction: t });

    const villageBonus = await KnightSkillService.villageBonuses(village, cfg, t);
    const state = new VillageState({ ...village.get({ plain: true }), villageBonus }, cfg);
    const finished = state.applyBuildOrders(buildOrders, now);
    // Milice arrivée à échéance (accrue la renvoie déjà quand l'échéance tombe dans l'intervalle).
    if (state.militiaUntil && now >= state.militiaUntil) state.dismissMilitia();
    const updates = state.applyRecruitOrders(recruitOrders, now);
    if (KnightSkillService.enabled(cfg)) await KnightSkillService.finishTraining(village, state, now, t);
    await require('./ScavengeService').applyFinished(village, state, cfg, now, t);
    const researched = state.applyResearchOrders(researchOrders, now);
    for (const o of researched) await o.destroy({ transaction: t });
    researchOrders = researchOrders.filter((o) => !researched.includes(o));
    if (!village.playerId) {
      const from = new Date(village.grownAt || village.createdAt);
      if (now > from) village.grownAt = barbarian.grow(state, from, now, cfg);
    }

    for (const o of finished) await o.destroy({ transaction: t });
    buildOrders = buildOrders.filter((o) => !finished.includes(o));
    const statue = finished.find((o) => o.building === 'statue');
    if (statue && village.playerId) await require('./KnightService').startClock(village.playerId, new Date(statue.endsAt), t);
    // Sceaux : un sceau de niveau 1 par noble formé (mondes officiels avec le module).
    const nobles = updates.filter((u) => u.order.unit === 'snob').reduce((n, u) => n + (u.done - u.order.done), 0);
    if (village.playerId && nobles > 0) await require('./SealService').onNobles(village.playerId, nobles, { t, now });
    if (village.playerId && updates.some((u) => u.order.unit === 'knight')) {
      if (KnightSkillService.enabled(cfg)) await KnightSkillService.onRecruited(village, t);
      else await Player.update({ knightRecruited: true }, { where: { id: village.playerId }, transaction: t });
    }
    // Le paladin présent pendant une construction gagne de l'expérience selon son coût.
    if (villageBonus && finished.length) {
      const cost = finished.reduce((n, o) => n + o.wood + o.stone + o.iron, 0);
      await KnightSkillService.addXp(village.id, cost / 10, t);
    }

    for (const { order, done } of updates) {
      if (done >= order.count) {
        await order.destroy({ transaction: t });
      } else {
        const nextAt = new Date(new Date(order.startsAt).getTime() + (done + 1) * order.unitDurationMs);
        await order.update({ done, nextAt }, { transaction: t });
      }
    }
    recruitOrders = recruitOrders.filter((o) => o.done < o.count && !updates.some((u) => u.order === o && u.done >= o.count));

    const oldPoints = village.points;
    village.set(state.toData());
    village.points = state.points();
    await village.save({ transaction: t });
    if (village.points !== oldPoints && village.playerId) {
      await VillageService.updatePlayerStats(village.playerId, t);
    }

    const awayUnits = await VillageService.awayUnits(villageId, t);
    return VillageService.complete({ village, world, cfg, state, buildOrders, recruitOrders, researchOrders, awayUnits, now }, t);
  }

  /**
   * Fin commune du contexte d'un village : file de construction (premium), droits de boutique du propriétaire,
   * première église, ferme. `ownerUserId` : compte du propriétaire s'il est déjà connu.
   * @returns {Promise<VillageContext>}
   */
  static async complete(ctx, t, { ownerUserId } = {}) {
    const { village, cfg, state, now } = ctx;
    // Premium du propriétaire (boutique) : file de construction plus longue.
    ctx.buildQueueSlots = cfg.buildQueueSlots;
    if (village.playerId) {
      const userId = ownerUserId !== undefined
        ? ownerUserId
        : (await Player.findByPk(village.playerId, { attributes: ['userId'], transaction: t }))?.userId;
      // Droits de boutique du propriétaire, gardés pour l'en-tête des pages (thème, design).
      ctx.ownerRights = userId ? await require('./ShopService').rightsFor(userId, village.worldId, { now, t }) : null;
      if (ctx.ownerRights && ctx.ownerRights.premium) ctx.buildQueueSlots += cfg.premium.buildQueueBonus;
      ctx.premium = Boolean(ctx.ownerRights && ctx.ownerRights.premium);
    }
    // File maximale : les emplacements au prix normal, et avec le premium, des ordres en plus de plus en plus chers
    // (voir queueSurcharge), jusqu'à premium.maxQueue.
    ctx.buildQueueMax = ctx.premium ? Math.max(ctx.buildQueueSlots, cfg.premium.maxQueue) : ctx.buildQueueSlots;
    // Mondes avec église : une seule première église par joueur (construite ou en chantier dans un autre village).
    if (cfg.hasFeature('church') && village.playerId) ctx.firstChurchElsewhere = await VillageService.hasFirstChurchElsewhere(village, t);
    ctx.popUsed = () => state.popUsed(ctx.buildOrders, ctx.recruitOrders, ctx.awayUnits);
    return ctx;
  }

  /**
   * Contexte d'un village pour un simple affichage, sans transaction ni écriture, quand rien n'y arrive à échéance
   * (construction, recrue, recherche, collecte, déblocage, formation du paladin, fin de milice) : le
   * rafraîchissement n'aurait alors rien d'autre à enregistrer que la production, qui se recalcule à l'identique
   * à la lecture suivante. Renvoie `null` dès qu'une échéance est passée : il faut le rafraîchissement complet.
   * `village` : la ligne du village déjà lue (avec son propriétaire `Player` si elle l'inclut).
   * @returns {Promise<VillageContext|null>}
   */
  static async peek(village, now = new Date()) {
    if (!village.playerId) return null; // croissance des barbares : rafraîchissement complet
    const { ScavengeRun, Knight } = require('../models');
    const villageId = village.id;
    const [world, buildOrders, recruitOrders, researchOrders, runs, training] = await Promise.all([
      World.findByPk(village.worldId),
      BuildOrder.findAll({ where: { villageId }, order: [['endsAt', 'ASC']] }),
      RecruitOrder.findAll({ where: { villageId }, order: [['startsAt', 'ASC']] }),
      ResearchOrder.findAll({ where: { villageId }, order: [['endsAt', 'ASC']] }),
      ScavengeRun.findAll({ where: { villageId }, attributes: ['units', 'endsAt'] }),
      Knight.findAll({ where: { homeVillageId: villageId, trainingEndsAt: { [Op.ne]: null } }, attributes: ['trainingEndsAt'] }),
    ]);
    const cfg = world.getConfig();
    const passed = (at) => at && new Date(at) <= now;
    const unlocking = village.scavenging?.unlocking;
    if (village.militiaUntil && passed(village.militiaUntil)) return null;
    if (unlocking && passed(unlocking.endsAt)) return null;
    if (runs.some((r) => passed(r.endsAt))) return null;
    if (KnightSkillService.enabled(cfg) && training.some((k) => passed(k.trainingEndsAt))) return null;

    const villageBonus = await KnightSkillService.villageBonuses(village, cfg);
    const state = new VillageState({ ...village.get({ plain: true }), villageBonus }, cfg);
    if (state.applyBuildOrders(buildOrders, now).length) return null;
    if (state.applyRecruitOrders(recruitOrders, now).length) return null;
    if (state.applyResearchOrders(researchOrders, now).length) return null;

    const awayUnits = await VillageService.awayUnits(villageId, undefined, { runs, training: training.length });
    return VillageService.complete({ village, world, cfg, state, buildOrders, recruitOrders, researchOrders, awayUnits, now }, undefined, {
      ownerUserId: village.Player ? village.Player.userId : undefined,
    });
  }

  /** Somme des troupes appartenant au village mais hors du village. */
  static async awayUnits(villageId, t, { runs = null, training = null } = {}) {
    // `runs` (collectes du village) et `training` (paladins en formation) : déjà lus par l'appelant.
    const { ScavengeRun, Knight } = require('../models');
    const [commands, stacks, scavenges, trainingCount] = await Promise.all([
      Command.findAll({ where: { originVillageId: villageId }, attributes: ['units'], transaction: t }),
      SupportStack.findAll({ where: { originVillageId: villageId }, attributes: ['units'], transaction: t }),
      runs || ScavengeRun.findAll({ where: { villageId }, attributes: ['units'], transaction: t }),
      training ?? Knight.count({ where: { homeVillageId: villageId, trainingEndsAt: { [Op.ne]: null } }, transaction: t }),
    ]);
    const total = {};
    for (const { units } of [...commands, ...stacks, ...scavenges]) {
      for (const [id, n] of Object.entries(units)) total[id] = (total[id] || 0) + n;
    }
    // Un paladin en formation reste à la charge de la ferme de son village.
    if (trainingCount) {
      total.knight = (total.knight || 0) + 1;
    }
    return total;
  }

  static async updatePlayerStats(playerId, t) {
    const points = (await Village.sum('points', { where: { playerId }, transaction: t })) || 0;
    const villageCount = await Village.count({ where: { playerId }, transaction: t });
    await Player.update({ points, villageCount }, { where: { id: playerId }, transaction: t });
  }

  static async rename(villageId, name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (clean.length < 1 || clean.length > 32) throw new GameError('Le nom doit faire 1 à 32 caractères.');
    await Village.update({ name: clean }, { where: { id: villageId } });
    return clean;
  }

  /**
   * Vérifie que le compte peut jouer ce village : il en est propriétaire, ou il est
   * le remplaçant accepté du propriétaire (mode vacances).
   * @returns {{ village, asSitter: boolean }}
   */
  static async assertAccess(villageId, userId) {
    const village = await Village.findByPk(villageId, {
      include: [{ model: Player, attributes: ['id', 'userId', 'sitterId', 'sitterAcceptedAt'], include: [{ association: 'sitter', attributes: ['userId'] }] }],
    });
    const owner = village?.Player;
    if (owner && owner.userId === userId) return { village, asSitter: false };
    if (owner && owner.sitterAcceptedAt && owner.sitter?.userId === userId) return { village, asSitter: true };
    throw new GameError('Village introuvable.', 404);
  }

  // ---------------------------------------------------------------- Construction

  /** Prochain niveau d'un bâtiment en tenant compte de la file. */
  static nextLevel(ctx, buildingId) {
    const queued = ctx.buildOrders.filter((o) => o.building === buildingId && !o.demolish).map((o) => o.level);
    return Math.max(ctx.state.level(buildingId), ...queued) + 1;
  }

  /**
   * Ce qu'il faut pour monter un bâtiment d'un niveau, et ce qui bloque.
   * Utilisé par la vue du QG et par `build` pour que l'affichage et la règle soient identiques.
   */
  static buildOption(ctx, type) {
    const { state, cfg, village } = ctx;
    const level = VillageService.nextLevel(ctx, type.id);
    const option = { type, current: state.level(type.id), level, blockers: [] };

    if (level > type.maxLevel) {
      option.maxed = true;
      option.blockers.push('Niveau maximum atteint');
      return option;
    }
    option.missing = type.missingRequirements(state.buildings);
    for (const m of option.missing) option.blockers.push(`${registry.building(m.building).name} niveau ${m.level}`);
    // Église : une seule par village (l'église ou la première église), une seule première église par joueur.
    const queued = (id) => state.level(id) > 0 || ctx.buildOrders.some((o) => o.building === id && !o.demolish);
    if (type.id === 'church' && queued('church_f')) option.blockers.push('Ce village a déjà une première église');
    if (type.id === 'church_f' && queued('church')) option.blockers.push('Ce village a déjà une église');
    if (type.id === 'church_f' && ctx.firstChurchElsewhere) option.blockers.push('Vous avez déjà une première église');
    if (ctx.buildOrders.some((o) => o.building === type.id && o.demolish)) option.blockers.push('Démolition en cours');

    // Au-delà des emplacements au prix normal (premium) : surcoût du prochain ordre, appliqué au coût payé.
    option.surcharge = VillageService.queueSurcharge(ctx);
    option.baseCost = type.costFor(level);
    option.cost = VillageService.withSurcharge(option.baseCost, option.surcharge);
    option.pop = type.popFor(level);
    option.duration = Math.round(type.buildTimeFor(level, state.level('main'), cfg) * (1 - (state.villageBonus?.buildSpeed || 0)));

    const cap = state.storageCapacity();
    if (Object.values(option.cost).some((c) => c > cap)) option.blockers.push("L'entrepôt est trop petit");
    if (ctx.popUsed() + option.pop > state.farmCapacity()) {
      option.blockers.push('La ferme est trop petite');
    }
    if (ctx.buildOrders.length >= (ctx.buildQueueMax ?? ctx.buildQueueSlots ?? cfg.buildQueueSlots)) option.blockers.push('La file de construction est pleine');
    if (!state.canAfford(option.cost)) {
      option.lacksResources = true;
      option.availableAt = state.affordableAt(option.cost, ctx.now);
    }
    return option;
  }

  /**
   * Multiplicateur du coût du prochain ordre de la file, comme sur GT : 1 tant qu'il reste un emplacement au prix
   * normal, puis premium.extraOrderFactor par ordre en plus (×1,25 le 6ᵉ, ×1,25² le 7ᵉ… avec 5 emplacements).
   * Les démolitions (gratuites) occupent une place mais ne paient rien.
   */
  static queueSurcharge(ctx) {
    const slots = ctx.buildQueueSlots ?? ctx.cfg.buildQueueSlots;
    const extra = ctx.buildOrders.length - slots + 1;
    return extra > 0 ? ctx.cfg.premium.extraOrderFactor ** extra : 1;
  }

  /** Coût multiplié par le surcoût de la file (arrondi à l'unité supérieure). */
  static withSurcharge(cost, factor) {
    if (factor === 1) return cost;
    return Object.fromEntries(Object.entries(cost).map(([r, n]) => [r, Math.ceil(n * factor)]));
  }

  /** Le joueur a-t-il une première église (construite ou en chantier) dans un autre de ses villages ? */
  static async hasFirstChurchElsewhere(village, t) {
    const others = await Village.findAll({ where: { playerId: village.playerId, id: { [Op.ne]: village.id } }, attributes: ['id', 'buildings'], transaction: t });
    if (others.some((v) => (v.buildings || {}).church_f > 0)) return true;
    if (!others.length) return false;
    return (await BuildOrder.count({ where: { building: 'church_f', demolish: false, villageId: { [Op.in]: others.map((v) => v.id) } }, transaction: t })) > 0;
  }

  /**
   * Démolition d'un niveau (onglet Démolition du QG, comme sur GT) : gratuite, sans remboursement, dans la file
   * de construction ; durée de construction du niveau actuel. QG niveau `demolishMainLevel` et loyauté à 100 %.
   */
  static demolishOption(ctx, type) {
    const { state, cfg, village } = ctx;
    const current = state.level(type.id);
    const option = { type, current, level: current - 1, blockers: [] };
    option.duration = current > 0 ? Math.round(type.buildTimeFor(current, state.level('main'), cfg)) : 0;
    if (current <= type.minLevel) option.blockers.push(current > 0 ? 'Niveau minimal' : 'Non construit');
    if (state.level('main') < cfg.demolishMainLevel) option.blockers.push(`Quartier général niveau ${cfg.demolishMainLevel}`);
    if ((village.loyalty ?? 100) < 100) option.blockers.push('Loyauté à 100 % requise');
    if (ctx.buildOrders.some((o) => o.building === type.id)) option.blockers.push('Chantier en cours sur ce bâtiment');
    if (ctx.buildOrders.length >= (ctx.buildQueueMax ?? ctx.buildQueueSlots ?? cfg.buildQueueSlots)) option.blockers.push('La file de construction est pleine');
    return option;
  }

  static async demolish(villageId, buildingId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const type = registry.BUILDINGS.get(buildingId);
      if (!type || !type.isAvailableIn(ctx.cfg)) throw new GameError('Bâtiment inconnu.');
      const option = VillageService.demolishOption(ctx, type);
      if (option.blockers.length) throw new GameError(option.blockers[0]);
      const last = ctx.buildOrders[ctx.buildOrders.length - 1];
      const startsAt = last ? new Date(last.endsAt) : ctx.now;
      return BuildOrder.create({
        villageId: ctx.village.id, building: type.id, level: option.level, demolish: true,
        startsAt, endsAt: new Date(startsAt.getTime() + option.duration * 1000), wood: 0, stone: 0, iron: 0,
      }, { transaction: t });
    }, { now });
  }

  static async build(villageId, buildingId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const type = registry.BUILDINGS.get(buildingId);
      if (!type || !type.isAvailableIn(ctx.cfg)) throw new GameError('Bâtiment inconnu.');

      // Reconstruction de la première église (une par joueur) : verrou sur le joueur, puis nouvelle vérification, pour que
      // deux villages ne la lancent pas en même temps.
      if (type.id === 'church_f' && ctx.village.playerId) {
        await Player.findByPk(ctx.village.playerId, { attributes: ['id'], transaction: t, lock: t.LOCK.UPDATE });
        ctx.firstChurchElsewhere = await VillageService.hasFirstChurchElsewhere(ctx.village, t);
      }
      const option = VillageService.buildOption(ctx, type);
      if (option.blockers.length) throw new GameError(option.blockers[0]);
      if (option.lacksResources) throw new GameError('Ressources insuffisantes.');

      const last = ctx.buildOrders[ctx.buildOrders.length - 1];
      const startsAt = last ? new Date(last.endsAt) : ctx.now;
      const endsAt = new Date(startsAt.getTime() + option.duration * 1000);

      ctx.state.pay(option.cost);
      await ctx.village.update(ctx.state.resources, { transaction: t });
      return BuildOrder.create({
        villageId: ctx.village.id, building: type.id, level: option.level, startsAt, endsAt, ...option.cost,
      }, { transaction: t });
    }, { now });
  }

  /**
   * Annule un niveau en file (et les niveaux supérieurs du même bâtiment qui en dépendent),
   * rembourse une partie du coût et avance les constructions suivantes.
   */
  static async cancelBuild(villageId, orderId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const order = ctx.buildOrders.find((o) => o.id === Number(orderId));
      if (!order) throw new GameError('Construction introuvable.', 404);

      // Une démolition s'annule seule ; un niveau entraîne les niveaux supérieurs du même bâtiment.
      const cancelled = order.demolish ? [order] : ctx.buildOrders.filter((o) => o.building === order.building && !o.demolish && o.level >= order.level);
      for (const o of cancelled) {
        ctx.state.refund(o, ctx.cfg.cancelRefund);
        await o.destroy({ transaction: t });
      }
      const remaining = ctx.buildOrders.filter((o) => !cancelled.includes(o));
      await VillageService.reschedule(remaining, ctx.now, t);
      await ctx.village.update(ctx.state.resources, { transaction: t });
    }, { now });
  }

  /**
   * Termine tout de suite la construction en cours quand il lui reste au plus `freeFinishSeconds` (3 minutes),
   * comme sur Guerre Tribale : gratuit, bâtiments seulement. Les constructions suivantes avancent d'autant ;
   * le niveau est appliqué au prochain rafraîchissement du village (à cet instant).
   */
  static async finishBuild(villageId, orderId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const order = ctx.buildOrders.find((o) => o.id === Number(orderId));
      if (!order) throw new GameError('Construction introuvable.', 404);
      if (order.demolish) throw new GameError('Une démolition ne peut pas être terminée plus tôt.');
      if (new Date(order.startsAt) > ctx.now) throw new GameError('Seule la construction en cours peut être terminée.');
      const left = new Date(order.endsAt) - ctx.now;
      if (left > ctx.cfg.freeFinishSeconds * 1000) {
        throw new GameError(`Il reste plus de ${Math.round(ctx.cfg.freeFinishSeconds / 60)} minutes : la construction ne peut pas encore être terminée.`);
      }
      await order.update({ endsAt: ctx.now }, { transaction: t });
      await VillageService.reschedule(ctx.buildOrders.filter((o) => o !== order), ctx.now, t);
      return order;
    }, { now });
  }

  /** La construction en cours peut-elle être terminée gratuitement (au plus `freeFinishSeconds` restantes) ? */
  static canFinishFree(order, cfg, now) {
    return !order.demolish && new Date(order.startsAt) <= now && new Date(order.endsAt) - now <= cfg.freeFinishSeconds * 1000;
  }

  /**
   * Recalcule les dates d'une file après une annulation : l'ordre en cours garde sa date,
   * chaque ordre suivant démarre à la fin du précédent en gardant sa durée.
   */
  static async reschedule(orders, now, t, onShift) {
    let prevEnd = now;
    for (const o of orders) {
      const startsAt = new Date(o.startsAt);
      const endsAt = new Date(o.endsAt);
      if (startsAt <= now) {
        prevEnd = endsAt;
        continue;
      }
      const duration = endsAt - startsAt;
      const newStart = new Date(Math.max(prevEnd, now));
      const patch = { startsAt: newStart, endsAt: new Date(newStart.getTime() + duration) };
      if (onShift) Object.assign(patch, onShift(o, newStart));
      await o.update(patch, { transaction: t });
      prevEnd = patch.endsAt;
    }
  }

  // ---------------------------------------------------------------- Recrutement

  static recruitOptions(ctx, buildingId) {
    const { state, cfg } = ctx;
    const buildingLevel = state.level(buildingId);
    const freePop = state.farmCapacity() - ctx.popUsed();
    return registry.unitsFor(cfg, buildingId).map((type) => {
      const missing = type.missingRequirements(state.buildings, cfg);
      const reasons = missing.map((m) => `${registry.building(m.building).name} niveau ${m.level}`);
      if (!state.hasResearched(type)) reasons.push('Recherche à la forge');
      const locked = reasons.length > 0;
      const duration = type.recruitTimeFor(buildingLevel, cfg) * state.recruitFactor();
      const max = locked ? 0 : Math.max(0, Math.min(
        ...['wood', 'stone', 'iron'].map((r) => Math.floor(state.resources[r] / type.cost[r])),
        Math.floor(freePop / type.pop),
      ));
      return { type, missing, reasons, locked, duration, max, count: state.units[type.id] || 0 };
    });
  }

  /** Lance le recrutement de plusieurs types d'unités d'un même bâtiment (tout ou rien). */
  static async recruit(villageId, buildingId, counts, { now } = {}) {
    if (!registry.RECRUIT_BUILDINGS.includes(buildingId)) throw new GameError('Bâtiment de recrutement inconnu.');
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const { state, cfg } = ctx;
      const buildingLevel = state.level(buildingId);
      if (buildingLevel < 1) throw new GameError(`${registry.building(buildingId).name} non construit(e).`);

      const wanted = Object.entries(counts || {})
        .map(([id, n]) => [id, Math.floor(Number(n))])
        .filter(([, n]) => Number.isFinite(n) && n > 0);
      if (!wanted.length) throw new GameError('Aucune unité demandée.');

      const total = { wood: 0, stone: 0, iron: 0 };
      let pop = 0;
      const lines = [];
      for (const [id, n] of wanted) {
        const type = registry.UNITS.get(id);
        if (!type || type.building !== buildingId || !type.isAvailableIn(cfg)) throw new GameError('Unité inconnue.');
        const missing = type.missingRequirements(state.buildings, cfg);
        if (missing.length) {
          throw new GameError(`${type.name} : nécessite ${registry.building(missing[0].building).name} niveau ${missing[0].level}.`);
        }
        if (!state.hasResearched(type)) throw new GameError(`${type.name} : à rechercher d'abord à la forge.`);
        const cost = type.costFor(n);
        for (const r of ['wood', 'stone', 'iron']) total[r] += cost[r];
        pop += type.pop * n;
        lines.push({ type, n });
      }
      if (!state.canAfford(total)) throw new GameError('Ressources insuffisantes.');
      if (ctx.popUsed() + pop > state.farmCapacity()) {
        throw new GameError('La ferme est trop petite.');
      }
      const knight = lines.find((l) => l.type.id === 'knight');
      if (knight && KnightSkillService.enabled(cfg)) {
        if (knight.n > 1) throw new GameError('Un seul paladin par village.');
        await KnightSkillService.assertCanRecruit(ctx.village, t);
      } else if (knight) {
        const { count } = await require('./NobleService').playerUnitCount(ctx.village.playerId, 'knight', t);
        if (count + knight.n > 1) throw new GameError('Vous ne pouvez avoir qu’un seul paladin.');
      }
      const nobles = lines.find((l) => l.type.id === 'snob');
      if (nobles) {
        const slots = await require('./NobleService').slots(ctx.village.playerId, t);
        if (nobles.n > slots.free) throw new GameError("Pas assez de pièces d'or pour un noble de plus.");
      }

      const queue = ctx.recruitOrders.filter((o) => o.building === buildingId);
      let startsAt = queue.length ? new Date(queue[queue.length - 1].endsAt) : ctx.now;
      if (startsAt < ctx.now) startsAt = ctx.now;
      const created = [];
      for (const { type, n } of lines) {
        const unitDurationMs = Math.round(type.recruitTimeFor(buildingLevel, cfg) * state.recruitFactor() * 1000);
        const endsAt = new Date(startsAt.getTime() + unitDurationMs * n);
        created.push(await RecruitOrder.create({
          villageId: ctx.village.id, building: buildingId, unit: type.id, count: n, done: 0,
          unitDurationMs, startsAt, endsAt, nextAt: new Date(startsAt.getTime() + unitDurationMs),
        }, { transaction: t }));
        startsAt = endsAt;
      }

      state.pay(total);
      await ctx.village.update(state.resources, { transaction: t });
      return created;
    }, { now });
  }

  /** Annule un lot : les unités restantes sont remboursées (l'unité en cours est perdue). */
  static async cancelRecruit(villageId, orderId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const order = ctx.recruitOrders.find((o) => o.id === Number(orderId));
      if (!order) throw new GameError('Recrutement introuvable.', 404);

      const type = registry.unit(order.unit);
      ctx.state.refund(type.costFor(order.count - order.done), ctx.cfg.cancelRefund);
      await order.destroy({ transaction: t });

      const remaining = ctx.recruitOrders.filter((o) => o !== order && o.building === order.building);
      await VillageService.reschedule(remaining, ctx.now, t, (o, newStart) => ({
        nextAt: new Date(newStart.getTime() + o.unitDurationMs),
      }));
      await ctx.village.update(ctx.state.resources, { transaction: t });
    }, { now });
  }

  /**
   * Désaffectation : renvoie définitivement des unités présentes au village (sans remboursement).
   * Les paladins et les nobles ne peuvent pas être renvoyés.
   */
  static async dismiss(villageId, counts, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      let total = 0;
      const units = { ...ctx.state.units };
      for (const [id, raw] of Object.entries(counts || {})) {
        if (!registry.UNITS.has(id) || id === 'knight' || id === 'snob' || id === 'militia') continue;
        const n = Math.floor(Number(raw));
        if (!Number.isFinite(n) || n <= 0) continue;
        if ((units[id] || 0) < n) throw new GameError(`Pas assez de ${registry.unit(id).name} dans le village.`);
        units[id] -= n;
        if (!units[id]) delete units[id];
        total += n;
      }
      if (!total) throw new GameError('Aucune unité à renvoyer.');
      await ctx.village.update({ units }, { transaction: t });
      return total;
    }, { now });
  }

  // ---------------------------------------------------------------- Recherche à la forge

  /** État de recherche de chaque unité du monde qui en demande une. */
  static researchOptions(ctx) {
    const { state, cfg } = ctx;
    const inProgress = ctx.researchOrders[0] || null;
    return registry.unitsFor(cfg).filter((u) => u.needsResearch(cfg)).map((type) => {
      const missing = type.missingRequirements(state.buildings, cfg);
      const option = {
        type,
        missing,
        cost: type.research,
        duration: type.researchTimeFor(state.level('smith'), cfg),
        done: Boolean(state.research[type.id]),
        running: inProgress && inProgress.unit === type.id ? inProgress : null,
      };
      option.blocker = option.done || option.running ? null
        : state.level('smith') < 1 ? 'Il faut une forge'
          : missing.length ? missing.map((m) => `${registry.building(m.building).name} niveau ${m.level}`).join(' · ')
            : inProgress ? 'Une recherche est déjà en cours'
              : !state.canAfford(type.research) ? 'Ressources insuffisantes' : null;
      option.lacksResources = option.blocker === 'Ressources insuffisantes';
      return option;
    });
  }

  static async research(villageId, unitId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const type = registry.UNITS.get(unitId);
      if (!type || !type.isAvailableIn(ctx.cfg) || !type.needsResearch(ctx.cfg)) throw new GameError('Recherche inconnue.');
      const option = VillageService.researchOptions(ctx).find((o) => o.type.id === type.id);
      if (option.done) throw new GameError('Déjà recherché.');
      if (option.blocker) throw new GameError(option.blocker);
      ctx.state.pay(type.research);
      await ctx.village.update(ctx.state.resources, { transaction: t });
      return ResearchOrder.create({
        villageId: ctx.village.id, unit: type.id, startsAt: ctx.now, endsAt: new Date(ctx.now.getTime() + option.duration * 1000),
      }, { transaction: t });
    }, { now });
  }

  static async cancelResearch(villageId, orderId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const order = ctx.researchOrders.find((o) => o.id === Number(orderId));
      if (!order) throw new GameError('Recherche introuvable.', 404);
      ctx.state.refund(registry.unit(order.unit).research, ctx.cfg.cancelRefund);
      await order.destroy({ transaction: t });
      await ctx.village.update(ctx.state.resources, { transaction: t });
    }, { now });
  }

  // ---------------------------------------------------------------- Boucle de jeu

  /**
   * Croissance des villages barbares d'un monde (boucle de jeu). Un barbare n'a ni file ni troupes en route : le
   * rafraîchissement complet se réduit à la production et aux bâtiments montés. On lit tous les barbares d'un coup et
   * seuls ceux qui montent un bâtiment sont relus sous verrou, par lots, et réécrits (les autres gardent leur réserve de
   * croissance, comme le ferait un rafraîchissement).
   * @returns {Promise<number>} villages réécrits
   */
  static async growBarbarians(world, now = new Date()) {
    const cfg = world.getConfig();
    const grows = (village) => {
      const from = new Date(village.grownAt || village.createdAt);
      if (!(now > from)) return null;
      const state = new VillageState(village.get({ plain: true }), cfg);
      state.accrue(now);
      const before = state.points();
      const grownAt = barbarian.grow(state, from, now, cfg);
      return state.points() > before ? { state, grownAt } : null;
    };
    const candidates = await Village.findAll({
      where: { worldId: world.id, playerId: null, points: { [Op.lt]: cfg.barbarian.maxPoints } },
    });
    const ids = candidates.filter(grows).map((v) => v.id);
    let written = 0;
    // Par lots verrouillés dans l'ordre des id : une attaque en cours sur un barbare attend la fin de son lot.
    for (let i = 0; i < ids.length; i += 100) {
      written += await sequelize.transaction(async (t) => {
        const villages = await Village.findAll({
          where: { id: ids.slice(i, i + 100), playerId: null }, order: [['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE,
        });
        let n = 0;
        for (const village of villages) {
          const grown = grows(village);
          if (!grown) continue;
          village.set(grown.state.toData());
          village.points = grown.state.points();
          village.grownAt = grown.grownAt;
          await village.save({ transaction: t });
          n += 1;
        }
        return n;
      });
    }
    return written;
  }

  /** Villages ayant une construction, une unité ou une recherche terminée : à traiter par la boucle de jeu. */
  static async dueVillageIds(now = new Date(), villageIds = null) {
    const { Knight, ScavengeRun } = require('../models');
    // `villageIds` : limite la recherche à ces villages (aperçu des villages d'un joueur).
    const only = (column) => (villageIds ? { [column]: { [Op.in]: villageIds } } : {});
    const [builds, recruits, research, training, scavenges] = await Promise.all([
      BuildOrder.findAll({ where: { endsAt: { [Op.lte]: now }, ...only('villageId') }, attributes: ['villageId'], raw: true }),
      RecruitOrder.findAll({ where: { nextAt: { [Op.lte]: now }, ...only('villageId') }, attributes: ['villageId'], raw: true }),
      ResearchOrder.findAll({ where: { endsAt: { [Op.lte]: now }, ...only('villageId') }, attributes: ['villageId'], raw: true }),
      Knight.findAll({ where: { trainingEndsAt: { [Op.lte]: now }, ...only('homeVillageId') }, attributes: [['homeVillageId', 'villageId']], raw: true }),
      ScavengeRun.findAll({ where: { endsAt: { [Op.lte]: now }, ...only('villageId') }, attributes: ['villageId'], raw: true }),
    ]);
    return [...new Set([...builds, ...recruits, ...research, ...training, ...scavenges].map((o) => o.villageId))];
  }
}

module.exports = VillageService;
