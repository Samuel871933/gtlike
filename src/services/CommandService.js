'use strict';

const { Op } = require('sequelize');
const {
  sequelize, World, Player, Village, Command, SupportStack, Report, LastAttack, BuildOrder, RecruitOrder, ResearchOrder, Transport, MarketOffer, TribeRelation,
  Knight, ScavengeRun,
} = require('../models');
const registry = require('../game/registry');
const combat = require('../game/combat');
const { travelSeconds, distance, arrivalAt } = require('../game/movement');
const VillageService = require('./VillageService');
const KnightService = require('./KnightService');
const KnightSkillService = require('./KnightSkillService');
const knightSkills = require('../game/knightSkills');
const AchievementService = require('./AchievementService');
const DailyService = require('./DailyService');
const GameError = require('./GameError');
const FaithService = require('./FaithService');

const RESOURCES = ['wood', 'stone', 'iron'];

function addUnits(a, b, sign = 1) {
  const out = { ...a };
  for (const [id, n] of Object.entries(b)) {
    out[id] = (out[id] || 0) + sign * n;
    if (out[id] <= 0) delete out[id];
  }
  return out;
}

function hasUnits(units) {
  return Object.values(units).some((n) => n > 0);
}

function villageLabel(v) {
  return `${v.name} (${v.x}|${v.y})`;
}

// Écart minimal entre deux arrivées d'un même village sur une même cible (attaques à la suite, ou envoyées l'une après
// l'autre) : la précision des arrivées quand le serveur la fixe, sinon 100 ms ; jamais moins de 10 ms, pour que deux
// ordres d'un village n'arrivent pas à la même milliseconde.
const MAX_CHAINED = 50;
const DEFAULT_CHAIN_GAP_MS = 100;
const MIN_CHAIN_GAP_MS = 10;
function chainGapMs(world) {
  const step = Number(world?.config?.arrivalStepMs);
  return Math.max(MIN_CHAIN_GAP_MS, Number.isFinite(step) && step >= 1 ? step : DEFAULT_CHAIN_GAP_MS);
}

/**
 * Première arrivée possible à partir de `ms` qui reste à `gap` au moins de chaque arrivée de `taken` (triées), à la
 * précision du monde : un ordre trop proche d'un autre est repoussé juste après lui.
 */
function freeArrival(ms, taken, gap, cfg) {
  let at = arrivalAt(ms, cfg).getTime();
  for (const other of taken) {
    if (Math.abs(at - other) < gap) at = arrivalAt(other + gap, cfg).getTime();
  }
  return new Date(at);
}

class CommandService {
  /** Nettoie un formulaire { spear: "12", axe: "" } en { spear: 12 }. */
  static parseUnits(input, world) {
    const units = {};
    for (const u of registry.UNITS.values()) {
      // La milice ne quitte jamais son village.
      if (!u.isAvailableIn(world) || u.stationary) continue;
      const n = Math.floor(Number(input?.[u.id]));
      if (Number.isFinite(n) && n > 0) units[u.id] = n;
    }
    return units;
  }

  /**
   * Vérifie un ordre et calcule trajet, arrivée et morale, sans rien modifier.
   * Sert à la page de confirmation et à l'envoi, pour que les règles soient identiques.
   */
  static async plan(ctx, { x, y, units, type, catapultTarget }, t) {
    const { village, state, cfg, now } = ctx;
    if (!['attack', 'support'].includes(type)) throw new GameError('Type d’ordre inconnu.');
    if (state.level('place') < 1) throw new GameError('Il faut un point de ralliement.');
    if (!hasUnits(units)) throw new GameError('Aucune unité sélectionnée.');
    for (const [id, n] of Object.entries(units)) {
      if ((state.units[id] || 0) < n) throw new GameError(`Pas assez de ${registry.unit(id).name} dans le village.`);
    }

    const target = await Village.findOne({
      where: { worldId: village.worldId, x: Number(x), y: Number(y) },
      include: [{ model: Player }],
      transaction: t,
    });
    if (!target) throw new GameError(`Aucun village en ${x}|${y}.`);
    if (target.id === village.id) throw new GameError('Impossible de cibler son propre village.');

    const attackerPlayer = await Player.findByPk(village.playerId, { transaction: t });
    if (type === 'attack' && attackerPlayer.isAsleep(now)) throw new GameError('Vous ne pouvez pas attaquer en mode sommeil.');
    if (type === 'attack' && ctx.world.endedAt) throw new GameError('Le monde est terminé : il est en paix, plus aucune attaque possible.');
    let moraleValue = 1;
    if (type === 'attack') {
      if (target.Player && target.playerId !== village.playerId && cfg.newbieDays > 0) {
        const protectedUntil = new Date(new Date(target.Player.createdAt).getTime() + cfg.newbieDays * 86400000);
        if (protectedUntil > now) {
          throw new GameError(`Ce joueur est sous protection débutant jusqu'au ${protectedUntil.toLocaleString('fr-FR')}.`);
        }
      }
      if (target.Player) moraleValue = combat.morale(attackerPlayer.points, target.Player.points, cfg.moral);
    }

    // Règles de tribu du monde.
    const sameTribe = target.playerId !== village.playerId && attackerPlayer.tribeId && target.Player && target.Player.tribeId === attackerPlayer.tribeId;
    if (type === 'attack' && sameTribe && cfg.tribe.noHarm) {
      throw new GameError("Vous ne pouvez pas attaquer un membre de votre tribu.");
    }
    if (type === 'support' && cfg.tribe.supportOnlyTribe && target.playerId !== village.playerId && !sameTribe) {
      const rel = target.Player?.tribeId && attackerPlayer.tribeId
        ? await TribeRelation.findOne({ where: { tribeId: attackerPlayer.tribeId, otherTribeId: target.Player.tribeId, type: 'ally' }, transaction: t })
        : null;
      if (!rel) throw new GameError('Sur ce monde, le soutien est réservé à votre tribu et à ses alliés.');
    }

    let catapult = null;
    if (type === 'attack' && units.catapult) {
      const id = catapultTarget || 'main';
      const b = registry.BUILDINGS.get(id);
      if (!b || !b.isAvailableIn(cfg) || combat.UNDESTROYABLE.has(id)) throw new GameError('Cible des catapultes invalide.');
      catapult = id;
    }

    if (units.snob && distance(village, target) > cfg.snob.maxDistance) {
      throw new GameError(`Les nobles ne peuvent pas aller à plus de ${cfg.snob.maxDistance} cases.`);
    }

    const seconds = travelSeconds(units, village, target, cfg, { withKnightSpeed: type === 'support' });
    // Foi du village d'origine (mondes avec église) : force de l'attaque, quelle que soit la cible.
    const faithValue = type === 'attack' ? await FaithService.factor(village, cfg, { t, buildings: state.buildings }) : 1;
    return {
      type, units, target, catapultTarget: catapult, morale: moraleValue, faith: faithValue,
      distance: distance(village, target), seconds,
      arrivesAt: arrivalAt(now.getTime() + seconds * 1000, cfg),
    };
  }

  static async preview(villageId, order, { now } = {}) {
    return VillageService.withVillage(villageId, (ctx, t) => CommandService.plan(ctx, order, t), { now });
  }

  static async send(villageId, order, { now } = {}) {
    return (await CommandService.sendMany(villageId, [order], { now }))[0];
  }

  /**
   * Plusieurs attaques à la suite depuis un village (« Ajouter une attaque supplémentaire » de GT), dans une seule
   * transaction : chaque ordre arrive après le précédent, au moins `chainGapMs` plus tard (un ordre plus rapide part
   * donc d'autant plus tard). Chaque arrivée reste aussi à `chainGapMs` des ordres déjà en route du même village vers
   * la même cible. Tout est refusé si l'un des ordres est invalide.
   */
  static async sendMany(villageId, orders, { now } = {}) {
    if (!orders.length) throw new GameError('Aucune unité sélectionnée.');
    if (orders.length > MAX_CHAINED) throw new GameError(`Au plus ${MAX_CHAINED} attaques à la fois.`);
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const gap = chainGapMs(ctx.world);
      const created = [];
      let previous = null;
      // Arrivées déjà prises par ce village, par cible (ordres en route, puis ceux de cet envoi).
      const taken = new Map();
      for (const order of orders) {
        const plan = await CommandService.plan(ctx, order, t);
        ctx.state.units = addUnits(ctx.state.units, plan.units, -1);
        if (!taken.has(plan.target.id)) {
          const going = await Command.findAll({
            where: { originVillageId: ctx.village.id, targetVillageId: plan.target.id, type: { [Op.in]: ['attack', 'support'] } },
            attributes: ['arrivesAt'], raw: true, transaction: t,
          });
          taken.set(plan.target.id, going.map((c) => new Date(c.arrivesAt).getTime()));
        }
        const slots = taken.get(plan.target.id);
        let ms = plan.arrivesAt.getTime();
        if (previous && ms < previous + gap) ms = previous + gap;
        const arrivesAt = freeArrival(ms, slots.sort((a, b) => a - b), gap, ctx.cfg);
        slots.push(arrivesAt.getTime());
        previous = arrivesAt.getTime();
        created.push(await Command.create({
          worldId: ctx.village.worldId,
          type: plan.type,
          originVillageId: ctx.village.id,
          targetVillageId: plan.target.id,
          units: plan.units,
          catapultTarget: plan.catapultTarget,
          // Départ décalé d'autant que l'arrivée : le retour garde la durée du trajet.
          startsAt: new Date(Math.max(ctx.now.getTime(), arrivesAt.getTime() - plan.seconds * 1000)),
          arrivesAt,
        }, { transaction: t }));
      }
      await ctx.village.update({ units: { ...ctx.state.units } }, { transaction: t });
      return created;
    }, { now });
  }

  /**
   * Déménagement d'un paladin à compétences vers un autre village du joueur (avec statue, sans
   * paladin, avec 10 places libres à la ferme). Il voyage à sa vitesse ; à l'arrivée, son village
   * d'attache change.
   */
  static async relocateKnight(villageId, targetVillageId, { now } = {}) {
    return VillageService.withVillage(villageId, async (ctx, t) => {
      if (!KnightSkillService.enabled(ctx.cfg)) throw new GameError('Pas de paladin à compétences sur ce monde.');
      const knight = await KnightSkillService.ofVillage(ctx.village.id, t);
      if (!knight || !knight.alive || knight.trainingEndsAt) throw new GameError('Le paladin de ce village n’est pas disponible.');
      if (!(ctx.state.units.knight > 0)) throw new GameError('Le paladin doit être dans son village.');

      const target = await VillageService.refresh(Number(targetVillageId), t, ctx.now);
      if (target.village.playerId !== ctx.village.playerId || target.village.id === ctx.village.id) {
        throw new GameError('Choisissez un autre de vos villages.');
      }
      if (target.state.level('statue') < 1) throw new GameError('Le village de destination doit avoir une statue.');
      if (await KnightSkillService.ofVillage(target.village.id, t)) throw new GameError('Ce village a déjà son paladin.');
      if (await RecruitOrder.count({ where: { villageId: target.village.id, unit: 'knight' }, transaction: t })) {
        throw new GameError('Un paladin est en formation dans ce village.');
      }
      if (target.state.farmCapacity() - target.popUsed() < registry.unit('knight').pop) {
        throw new GameError('La ferme du village de destination est pleine.');
      }

      ctx.state.units = addUnits(ctx.state.units, { knight: 1 }, -1);
      await ctx.village.update({ units: { ...ctx.state.units } }, { transaction: t });
      const seconds = travelSeconds({ knight: 1 }, ctx.village, target.village, ctx.cfg);
      return Command.create({
        worldId: ctx.village.worldId, type: 'relocate', originVillageId: ctx.village.id, targetVillageId: target.village.id,
        units: { knight: 1 }, startsAt: ctx.now, arrivesAt: arrivalAt(ctx.now.getTime() + seconds * 1000, ctx.cfg),
      }, { transaction: t });
    }, { now });
  }

  static async resolveRelocate(cmd, t) {
    const at = new Date(cmd.arrivesAt);
    const [origin, target] = await Promise.all([
      Village.findByPk(cmd.originVillageId, { attributes: ['id', 'playerId'], transaction: t }),
      Village.findByPk(cmd.targetVillageId, { attributes: ['id', 'playerId'], transaction: t }),
    ]);
    const knight = await KnightSkillService.ofVillage(origin.id, t);
    if (!knight || target.playerId !== knight.playerId || (await KnightSkillService.ofVillage(target.id, t))) {
      // Destination perdue ou déjà occupée entre-temps : le paladin rentre chez lui.
      return Command.create({
        worldId: cmd.worldId, type: 'return', originVillageId: origin.id, targetVillageId: target.id,
        units: cmd.units, startsAt: at, arrivesAt: arrivalAt(at.getTime() + (at - new Date(cmd.startsAt)), await CommandService.worldConfig(cmd, t)),
      }, { transaction: t });
    }
    const ctx = await VillageService.refresh(target.id, t, at);
    ctx.state.units = addUnits(ctx.state.units, { knight: 1 });
    ctx.village.set(ctx.state.toData());
    await ctx.village.save({ transaction: t });
    await knight.update({ homeVillageId: target.id }, { transaction: t });
  }

  /** Annulation pendant les premières minutes : les troupes font demi-tour. */
  static async cancel(villageId, commandId, { now = new Date() } = {}) {
    return sequelize.transaction(async (t) => {
      const cmd = await Command.findByPk(Number(commandId), { transaction: t, lock: t.LOCK.UPDATE });
      if (!cmd || cmd.originVillageId !== villageId || cmd.type === 'return') throw new GameError('Ordre introuvable.', 404);
      const village = await Village.findByPk(villageId, { include: [{ association: Village.associations.World }], transaction: t });
      const cfg = village.World.getConfig();
      // Nul pour une attaque à la suite pas encore partie (départ décalé, voir sendMany).
      const elapsed = Math.max(0, now - new Date(cmd.startsAt));
      if (elapsed > cfg.commandCancelSeconds * 1000 || now >= new Date(cmd.arrivesAt)) {
        throw new GameError("Il est trop tard pour annuler cet ordre.");
      }
      await cmd.update({ type: 'return', cancelled: true, startsAt: now, arrivesAt: arrivalAt(now.getTime() + elapsed, cfg) }, { transaction: t });
    });
  }

  /** Rappel (par le propriétaire) ou renvoi (par l'hôte) de troupes en soutien. */
  static async withdrawSupport(stackId, userId, { now = new Date() } = {}) {
    return sequelize.transaction(async (t) => {
      const stack = await SupportStack.findByPk(Number(stackId), {
        include: [
          { association: 'village', include: [Player, Village.associations.World] },
          { association: 'origin', include: [Player] },
        ],
        transaction: t,
      });
      const allowed = stack && [stack.village.Player?.userId, stack.origin.Player?.userId].includes(userId);
      if (!allowed) throw new GameError('Soutien introuvable.', 404);
      await CommandService.returnSupportStack(stack, now, t);
    });
  }

  static async returnSupportStack(stack, now, transaction) {
    const cfg = stack.village.World.getConfig();
    const seconds = travelSeconds(stack.units, stack.village, stack.origin, cfg, { withKnightSpeed: true });
    await Command.create({
      worldId: stack.village.worldId,
      type: 'return',
      originVillageId: stack.originVillageId,
      targetVillageId: stack.villageId,
      units: stack.units,
      startsAt: now,
      arrivesAt: arrivalAt(now.getTime() + seconds * 1000, cfg),
    }, { transaction });
    await stack.destroy({ transaction });
  }

  /** Renvoie ou rappelle les soutiens cochés sur un seul tableau du point de ralliement. */
  static async withdrawSupports(ids, userId, villageId, direction, { now = new Date() } = {}) {
    const selected = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number))];
    if (!selected.length || selected.some((id) => !Number.isSafeInteger(id) || id <= 0) || selected.length > 1000) {
      throw new GameError('Sélectionnez des soutiens valides.');
    }
    if (!['here', 'away'].includes(direction)) throw new GameError('Type de soutien inconnu.');
    return sequelize.transaction(async (transaction) => {
      const stacks = await SupportStack.findAll({
        where: { id: { [Op.in]: selected } },
        include: [
          { association: 'village', include: [Player, Village.associations.World] },
          { association: 'origin', include: [Player] },
        ],
        transaction,
      });
      if (stacks.length !== selected.length || stacks.some((stack) =>
        (direction === 'here' ? stack.villageId : stack.originVillageId) !== Number(villageId)
        || ![stack.village.Player?.userId, stack.origin.Player?.userId].includes(userId))) {
        throw new GameError('Soutien introuvable.', 404);
      }
      for (const stack of stacks) await CommandService.returnSupportStack(stack, now, transaction);
      return stacks.length;
    });
  }

  // ---------------------------------------------------------------- Traitement des arrivées

  /** Configuration du monde d'un ordre (précision des arrivées des retours qu'il crée). */
  static async worldConfig(cmd, t) {
    return (await World.findByPk(cmd.worldId, { transaction: t })).getConfig();
  }

  /** Traite toutes les arrivées échues (troupes et marchands), voir EventService. */
  static async processDue(now, options) {
    return require('./EventService').processDue(now, options);
  }

  static async process(commandId, { rng = Math.random } = {}) {
    return sequelize.transaction(async (t) => {
      const cmd = await Command.findByPk(commandId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!cmd) return; // déjà traité par un autre processus
      if (cmd.type === 'attack') await CommandService.resolveAttack(cmd, t, rng);
      else if (cmd.type === 'support') await CommandService.resolveSupport(cmd, t);
      else if (cmd.type === 'relocate') await CommandService.resolveRelocate(cmd, t);
      else await CommandService.resolveReturn(cmd, t);
      await cmd.destroy({ transaction: t });
    });
  }

  static async resolveAttack(cmd, t, rng) {
    const at = new Date(cmd.arrivesAt);
    // La cible a été conquise entre-temps par l'attaquant : les troupes s'y installent en soutien.
    const [originOwner, targetOwner] = await Promise.all([
      Village.findByPk(cmd.originVillageId, { attributes: ['playerId'], transaction: t }),
      Village.findByPk(cmd.targetVillageId, { attributes: ['playerId'], transaction: t }),
    ]);
    if (targetOwner.playerId && targetOwner.playerId === originOwner.playerId) {
      return CommandService.resolveSupport(cmd, t);
    }
    const sleeper = targetOwner.playerId ? await Player.findByPk(targetOwner.playerId, { transaction: t }) : null;
    if (sleeper && sleeper.isAsleep(at)) return CommandService.resolveVisit(cmd, sleeper, t);
    const ctx = await VillageService.refresh(cmd.targetVillageId, t, at);
    const { state, cfg, village: target } = ctx;
    const origin = await Village.findByPk(cmd.originVillageId, { include: [Player], transaction: t });
    const defenderPlayer = target.playerId ? await Player.findByPk(target.playerId, { transaction: t }) : null;
    const stacks = await SupportStack.findAll({ where: { villageId: target.id }, include: [{ association: 'origin' }], transaction: t });

    let defenders = { ...state.units };
    for (const s of stacks) defenders = addUnits(defenders, s.units);

    // Armes de paladin : celle de l'attaquant si son paladin est dans l'attaque, celles des paladins défenseurs.
    const knightsOn = KnightService.enabled(cfg);
    const itemOf = (player) => (knightsOn && player && player.knightItem ? player.knightItem : null);
    const attackerItem = cmd.units.knight ? itemOf(origin.Player) : null;
    const defenderItems = [];
    if (state.units.knight) defenderItems.push(itemOf(defenderPlayer));
    for (const s of stacks) {
      if (s.units.knight) defenderItems.push(itemOf(await Player.findByPk(s.origin.playerId, { transaction: t })));
    }

    // Paladins à compétences : celui du village d'origine s'il accompagne l'attaque, ceux présents en défense.
    const skillsOn = KnightSkillService.enabled(cfg);
    let attackerKnight = null;
    let defenderKnights = [];
    if (skillsOn) {
      if (cmd.units.knight) attackerKnight = (await KnightSkillService.ofVillages([origin.id], t)).get(origin.id) || null;
      const homes = stacks.filter((st) => st.units.knight).map((st) => st.originVillageId);
      if (state.units.knight) homes.push(target.id);
      defenderKnights = [...(await KnightSkillService.ofVillages(homes, t)).values()];
    }

    const result = combat.resolve({
      attackers: cmd.units,
      defenders,
      attackerItems: attackerItem ? [attackerItem] : [],
      defenderItems: defenderItems.filter(Boolean),
      attackerSkills: attackerKnight ? knightSkills.bonuses([attackerKnight], 'attack') : null,
      defenderSkills: defenderKnights.length ? knightSkills.bonuses(defenderKnights, 'defense') : null,
      wall: state.level('wall'),
      morale: defenderPlayer ? combat.morale(origin.Player.points, defenderPlayer.points, cfg.moral) : 1,
      luck: (rng() * 2 - 1) * cfg.luck,
      nightFactor: defenderPlayer && cfg.isNight(at) ? cfg.night.defFactor : 1,
      catapultTarget: cmd.catapultTarget ? { building: cmd.catapultTarget, level: state.level(cmd.catapultTarget) } : null,
      // Foi : l'attaque dépend de l'église du village d'origine, toute la défense (soutiens compris) de celle de la cible.
      attackerFaith: await FaithService.factor(origin, cfg, { t }),
      defenderFaith: await FaithService.factor(target, cfg, { t, buildings: state.buildings }),
    });

    // Pertes du défenseur : même proportion pour le village et chaque soutien.
    const lossesOf = (units) => {
      const out = {};
      for (const [id, n] of Object.entries(units)) out[id] = Math.round(n * result.defenderLossRatio);
      return out;
    };
    const homeBefore = { ...state.units };
    const homeLosses = lossesOf(state.units);
    state.units = addUnits(state.units, homeLosses, -1);
    const stackReports = [];
    for (const s of stacks) {
      const before = { ...s.units };
      const losses = lossesOf(before);
      const remaining = addUnits(before, losses, -1);
      if (hasUnits(remaining)) await s.update({ units: remaining }, { transaction: t });
      else await s.destroy({ transaction: t });
      stackReports.push({ stack: s, units: before, losses });
    }
    await CommandService.creditKills({
      origin, target, homeBefore, homeLosses, stackReports, attackerLosses: result.attackerLosses, cfg,
      knightXp: skillsOn ? { attacker: Boolean(attackerKnight) && !result.attackerLosses.knight } : null,
    }, t);
    if (skillsOn) {
      const dead = [];
      if (result.attackerLosses.knight) dead.push(origin.id);
      if (homeLosses.knight) dead.push(target.id);
      for (const st of stackReports) if (st.losses.knight) dead.push(st.stack.originVillageId);
      await KnightSkillService.onDeath(dead, t);
    }

    if (result.wallAfter !== result.wallBefore) state.buildings.wall = result.wallAfter;
    if (result.catapult && result.catapult.building !== 'wall') state.buildings[result.catapult.building] = result.catapult.after;

    const survivors = addUnits(cmd.units, result.attackerLosses, -1);
    let looted = { wood: 0, stone: 0, iron: 0 };
    const carry = combat.carryCapacity(survivors);
    if (result.attackerWins && result.hasBattle && carry > 0) {
      looted = combat.loot(state.resources, state.hideCapacity(), carry);
      for (const r of RESOURCES) state.resources[r] -= looted[r];
    }

    const intel = {};
    const telescope = survivors.knight && attackerItem && registry.ITEMS.get(attackerItem).spy;
    const spyRatio = telescope ? 1 : result.spies.survivedRatio;
    if ((result.spies.sent > 0 || telescope) && spyRatio > 0) {
      intel.units = defenders;
      if (spyRatio >= 0.5) intel.resources = Object.fromEntries(RESOURCES.map((r) => [r, Math.floor(state.resources[r])]));
      if (spyRatio >= 0.7) intel.buildings = { ...state.buildings };
    }

    // Nobles : chaque attaque gagnante avec au moins un noble survivant baisse la loyauté.
    let loyalty = null;
    let conquered = false;
    const previousOwnerId = target.playerId;
    if (result.attackerWins && (survivors.snob || 0) > 0 && target.playerId !== origin.playerId) {
      const { loyaltyLossMin: min, loyaltyLossMax: max } = cfg.snob;
      const before = state.loyalty;
      let drop = min + Math.floor(rng() * (max - min + 1));
      const scepter = survivors.knight && attackerItem && registry.ITEMS.get(attackerItem).loyalty;
      if (scepter) drop = Math.max(drop, scepter);
      // Persuasion : le paladin resté au village d'origine (sans accompagner l'attaque) renforce les nobles.
      if (skillsOn && !cmd.units.knight) drop += (await KnightSkillService.villageBonuses(origin, cfg, t))?.loyalty || 0;
      state.loyalty = before - drop;
      conquered = state.loyalty <= 0;
      loyalty = { before: Math.floor(before), after: conquered ? 0 : Math.floor(state.loyalty), exact: Math.floor(state.loyalty) };
      if (conquered) {
        survivors.snob -= 1;
        if (!survivors.snob) delete survivors.snob;
        state.loyalty = cfg.snob.loyaltyAfterConquest;
        // L'église (et la première église) du village disparaît avec la conquête, comme sur GT.
        delete state.buildings.church;
        delete state.buildings.church_f;
      }
    }

    const oldPoints = target.points;
    target.set(state.toData());
    target.points = state.points();
    if (conquered) {
      target.playerId = origin.playerId;
      target.isFirst = false;
      await CommandService.handOver(target, t);
    }
    await target.save({ transaction: t });
    if (conquered) {
      await VillageService.updatePlayerStats(origin.playerId, t);
      if (previousOwnerId) await VillageService.updatePlayerStats(previousOwnerId, t);
      // Fil des tribus (« Anoblissements ») : conquête pour la tribu du noble, perte pour celle de l'ancien propriétaire.
      const [winner, loser] = await Promise.all([
        Player.findByPk(origin.playerId, { attributes: ['id', 'name', 'tribeId'], transaction: t }),
        previousOwnerId ? Player.findByPk(previousOwnerId, { attributes: ['id', 'name', 'tribeId'], transaction: t }) : null,
      ]);
      await require('./TribeEventService').conquest({ village: target, winner, loser, at, t });
    } else if (target.playerId && target.points !== oldPoints) {
      await VillageService.updatePlayerStats(target.playerId, t);
    }

    if (conquered && hasUnits(survivors)) {
      // Les troupes restantes restent dans le village conquis, en soutien depuis leur village.
      const [stack] = await SupportStack.findOrCreate({
        where: { villageId: target.id, originVillageId: origin.id }, defaults: { units: {} }, transaction: t,
      });
      await stack.update({ units: addUnits(stack.units, survivors) }, { transaction: t });
    } else if (hasUnits(survivors)) {
      await Command.create({
        worldId: cmd.worldId,
        type: 'return',
        originVillageId: origin.id,
        targetVillageId: target.id,
        units: survivors,
        loot: looted,
        startsAt: at,
        arrivesAt: arrivalAt(at.getTime() + (at - new Date(cmd.startsAt)), cfg),
      }, { transaction: t });
    }

    // Compteurs des succès.
    const count = (units) => Object.values(units).reduce((n, c) => n + c, 0);
    const pop = (units) => Object.entries(units).reduce((n, [id, c]) => n + registry.unit(id).pop * c, 0);
    const defenderLosses = stackReports.reduce((acc, s) => addUnits(acc, s.losses), { ...homeLosses });
    const lootSum = looted.wood + looted.stone + looted.iron;
    await AchievementService.addStats(origin.playerId, {
      lootTotal: lootSum,
      plunders: lootSum > 0 ? 1 : 0,
      conquests: conquered ? 1 : 0,
      unitsKilled: count(defenderLosses),
      noblesKilled: defenderLosses.snob || 0,
      levelsDestroyed: result.catapult && result.catapult.building !== 'wall' ? result.catapult.before - result.catapult.after : 0,
      wallLevelsDestroyed: result.wallBefore - result.wallAfter,
      battlesWon: result.hasBattle && result.attackerWins && pop(cmd.units) >= 20 ? 1 : 0,
      attacked: previousOwnerId && previousOwnerId !== origin.playerId ? previousOwnerId : null,
    }, t);
    if (loyalty) {
      await AchievementService.addStats(origin.playerId, {
        luckyNoble: conquered && loyalty.exact === 0 ? 1 : 0,
        unluckyNoble: !conquered && loyalty.exact === 1 ? 1 : 0,
      }, t);
    }
    // Succès quotidiens : les unités attaquantes tuées se partagent entre le village et ses soutiens
    // au prorata de la population présente, comme les points de défense.
    await DailyService.add(cmd.worldId, origin.playerId, {
      plunders: lootSum > 0 ? 1 : 0, unitsKilledAttacker: count(defenderLosses), conquests: conquered ? 1 : 0, loot: lootSum,
    }, at, t);
    const killedAttackers = count(result.attackerLosses);
    if (killedAttackers) {
      const parts = [{ playerId: target.playerId, pop: pop(homeBefore), own: true }];
      for (const st of stackReports) parts.push({ playerId: st.stack.origin.playerId, pop: pop(st.units), own: st.stack.origin.playerId === target.playerId });
      const totalPop = parts.reduce((n, x) => n + x.pop, 0) || 1;
      if (!parts.some((x) => x.pop)) parts[0].pop = 1;
      for (const part of parts) {
        if (!part.playerId || !part.pop) continue;
        const share = (killedAttackers * part.pop) / totalPop;
        await DailyService.add(cmd.worldId, part.playerId, part.own ? { unitsKilledDefender: share } : { unitsKilledSupporter: share }, at, t);
      }
    }
    if (defenderPlayer && defenderPlayer.id !== origin.playerId) {
      await AchievementService.addStats(defenderPlayer.id, {
        unitsKilled: count(result.attackerLosses),
        noblesKilled: result.attackerLosses.snob || 0,
        spyDefenses: !result.hasBattle && result.spies.sent > 0 && result.spies.lost === result.spies.sent ? 1 : 0,
      }, t);
    }
    const supporterIds = [];
    for (const s of stackReports) {
      if (!s.stack.origin.playerId || s.stack.origin.playerId === defenderPlayer?.id) continue;
      supporterIds.push(s.stack.origin.playerId);
      await AchievementService.addStats(s.stack.origin.playerId, { supportBattles: 1, supportLosses: count(s.losses) }, t);
    }

    const attackerSeesDefense = hasUnits(survivors);
    const data = {
      attacker: {
        playerName: origin.Player.name, playerId: origin.Player.id, villageId: origin.id, village: villageLabel(origin),
        units: cmd.units, losses: result.attackerLosses,
      },
      defender: {
        playerName: defenderPlayer ? defenderPlayer.name : 'Barbares', playerId: defenderPlayer ? defenderPlayer.id : null, villageId: target.id, village: villageLabel(target),
        units: defenders, losses: addUnits(homeLosses, stackReports.reduce((acc, s) => addUnits(acc, s.losses), {})),
      },
      attackerWins: result.hasBattle ? result.attackerWins : null,
      luck: result.luck, morale: result.morale, night: result.nightFactor > 1,
      ...(cfg.hasFeature('church') ? { faith: { attacker: result.attackerFaith, defender: result.defenderFaith } } : {}),
      wall: { before: result.wallBefore, after: result.wallAfter },
      catapult: result.catapult ? { ...result.catapult, name: registry.building(result.catapult.building).name } : null,
      attackerItem: attackerItem ? registry.ITEMS.get(attackerItem).name : null,
      defenderItems: [...new Set(defenderItems.filter(Boolean))].map((id) => registry.ITEMS.get(id).name),
      loot: looted, carry, loyalty, conquered,
    };
    // Éclaireurs seuls : le joueur espionne, il n'attaque pas.
    const spyOnly = Object.entries(cmd.units).every(([id, n]) => !n || id === 'spy');
    const title = conquered
      ? `${origin.Player.name} a conquis ${villageLabel(target)}`
      : `${origin.Player.name} ${spyOnly ? 'espionne' : 'attaque'} ${villageLabel(target)}`;

    const attackReport = await Report.create({
      playerId: origin.playerId, type: 'attack', title, happenedAt: at,
      data: { ...data, perspective: 'attacker', hideDefender: !attackerSeesDefense, intel },
    }, { transaction: t });
    // Gommette de la carte : dernière attaque de ce joueur sur ce village.
    const last = { ...require('../game/lastAttack').outcome(data), happenedAt: at, reportId: attackReport.id, originVillageId: origin.id };
    const [mark, created] = await LastAttack.findOrCreate({ where: { playerId: origin.playerId, villageId: target.id }, defaults: last, transaction: t });
    if (!created && new Date(mark.happenedAt) <= at) await mark.update(last, { transaction: t });
    if (defenderPlayer && defenderPlayer.id !== origin.playerId) {
      await Report.create({
        playerId: defenderPlayer.id, type: 'defense', title, happenedAt: at,
        data: { ...data, perspective: 'defender' },
      }, { transaction: t });
    }
    // Succès de rang (classements) : calculés par la boucle de jeu, pas dans la transaction du combat.
    await AchievementService.evaluateMany([origin.playerId, defenderPlayer?.id, ...supporterIds], { now: at, t, ranks: false });
    for (const s of stackReports) {
      const owner = await Village.findByPk(s.stack.originVillageId, { attributes: ['playerId'], transaction: t });
      if (!owner?.playerId || owner.playerId === defenderPlayer?.id) continue;
      await Report.create({
        playerId: owner.playerId, type: 'support', happenedAt: at,
        title: `Vos troupes en soutien à ${villageLabel(target)} ont été attaquées`,
        data: { perspective: 'support', village: villageLabel(target), units: s.units, losses: s.losses },
      }, { transaction: t });
    }
  }

  /**
   * Adversaires vaincus. L'attaquant gagne des points ODA pour les défenseurs tués (village et soutiens).
   * Les points des attaquants tués sont partagés entre le village et ses soutiens, au prorata de la
   * population présente : ODD pour le propriétaire (et ses propres soutiens), ODS pour les autres.
   */
  static async creditKills({ origin, target, homeBefore, homeLosses, stackReports, attackerLosses, cfg, knightXp }, t) {
    const allDefenderLosses = stackReports.reduce((acc, s) => addUnits(acc, s.losses), { ...homeLosses });
    const oda = combat.killPoints(allDefenderLosses, 'att');
    if (oda && origin.playerId) {
      await Player.increment({ killsAttacker: oda }, { where: { id: origin.playerId }, transaction: t });
      await KnightService.addKills(origin.playerId, oda, cfg, t);
      if (knightXp?.attacker) await KnightSkillService.addXp(origin.id, oda, t);
    }

    const odd = combat.killPoints(attackerLosses, 'def');
    if (!odd) return;
    const pop = (units) => Object.entries(units).reduce((n, [id, c]) => n + registry.unit(id).pop * c, 0);
    const shares = [{ playerId: target.playerId, pop: pop(homeBefore), villageId: target.id, knight: homeBefore.knight > 0 }];
    for (const s of stackReports) {
      shares.push({ playerId: s.stack.origin.playerId, pop: pop(s.units), villageId: s.stack.originVillageId, knight: s.units.knight > 0 });
    }
    const totalPop = shares.reduce((n, x) => n + x.pop, 0);
    // Sans troupes, c'est le village (muraille, défense de base) qui a tué : tout va au propriétaire.
    if (!totalPop) shares[0].pop = 1;
    const sum = totalPop || 1;

    // Paladins défenseurs : expérience selon la part de leurs troupes (village ou soutien).
    if (knightXp) {
      for (const share of shares) if (share.knight && share.pop) await KnightSkillService.addXp(share.villageId, (odd * share.pop) / sum, t);
    }

    const credit = new Map();
    for (const { playerId, pop: p } of shares) {
      if (!playerId || !p) continue;
      const field = playerId === target.playerId ? 'killsDefender' : 'killsSupporter';
      const key = `${playerId}:${field}`;
      credit.set(key, (credit.get(key) || 0) + (odd * p) / sum);
    }
    for (const [key, points] of credit) {
      const [playerId, field] = key.split(':');
      const n = Math.round(points);
      if (!n) continue;
      await Player.increment({ [field]: n }, { where: { id: Number(playerId) }, transaction: t });
      await KnightService.addKills(Number(playerId), n, cfg, t);
    }
  }

  /**
   * Changement de propriétaire : les files du village sont perdues, ainsi que ses troupes
   * et marchands hors du village et ses offres au marché.
   */
  static async handOver(village, t) {
    await BuildOrder.destroy({ where: { villageId: village.id }, transaction: t });
    await RecruitOrder.destroy({ where: { villageId: village.id }, transaction: t });
    await ResearchOrder.destroy({ where: { villageId: village.id }, transaction: t });
    await Command.destroy({ where: { originVillageId: village.id }, transaction: t });
    await SupportStack.destroy({ where: { originVillageId: village.id }, transaction: t });
    await Transport.destroy({ where: { originVillageId: village.id }, transaction: t });
    await MarketOffer.destroy({ where: { villageId: village.id }, transaction: t });
    await Knight.destroy({ where: { homeVillageId: village.id }, transaction: t });
    await ScavengeRun.destroy({ where: { villageId: village.id }, transaction: t });
    // Village conquis : la milice de l'ancien propriétaire disparaît.
    const units = { ...village.units };
    delete units.militia;
    await village.update({ scavenging: {}, units, militiaUntil: null }, { transaction: t });
  }

  /** Mode sommeil : pas de combat, les troupes font demi-tour ; les deux joueurs sont prévenus. */
  static async resolveVisit(cmd, sleeper, t) {
    const at = new Date(cmd.arrivesAt);
    const [origin, target] = await Promise.all([
      Village.findByPk(cmd.originVillageId, { include: [Player], transaction: t }),
      Village.findByPk(cmd.targetVillageId, { transaction: t }),
    ]);
    await Command.create({
      worldId: cmd.worldId, type: 'return', originVillageId: origin.id, targetVillageId: target.id,
      units: cmd.units, loot: { wood: 0, stone: 0, iron: 0 }, startsAt: at, arrivesAt: arrivalAt(at.getTime() + (at - new Date(cmd.startsAt)), await CommandService.worldConfig(cmd, t)),
    }, { transaction: t });
    const title = `${origin.Player.name} a rendu visite à ${villageLabel(target)}`;
    const data = { perspective: 'visit', visit: true, from: villageLabel(origin), village: villageLabel(target), units: cmd.units, sleeper: sleeper.name };
    await Report.create({ playerId: origin.playerId, type: 'attack', title, happenedAt: at, data }, { transaction: t });
    await Report.create({ playerId: sleeper.id, type: 'defense', title, happenedAt: at, data }, { transaction: t });
  }

  static async resolveSupport(cmd, t) {
    const [stack] = await SupportStack.findOrCreate({
      where: { villageId: cmd.targetVillageId, originVillageId: cmd.originVillageId },
      defaults: { units: {} },
      transaction: t,
    });
    await stack.update({ units: addUnits(stack.units, cmd.units) }, { transaction: t });

    const [origin, target] = await Promise.all([
      Village.findByPk(cmd.originVillageId, { include: [Player], transaction: t }),
      Village.findByPk(cmd.targetVillageId, { include: [Player], transaction: t }),
    ]);
    const data = { perspective: 'support', from: villageLabel(origin), village: villageLabel(target), units: cmd.units };
    const at = new Date(cmd.arrivesAt);
    await Report.create({
      playerId: origin.playerId, type: 'support', happenedAt: at,
      title: `Votre soutien est arrivé à ${villageLabel(target)}`, data,
    }, { transaction: t });
    if (target.playerId && target.playerId !== origin.playerId) {
      await Report.create({
        playerId: target.playerId, type: 'support', happenedAt: at,
        title: `${origin.Player.name} soutient ${villageLabel(target)}`, data,
      }, { transaction: t });
    }
  }

  /** Retour : troupes rentrées, butin ajouté dans la limite de l'entrepôt. */
  static async resolveReturn(cmd, t) {
    const ctx = await VillageService.refresh(cmd.originVillageId, t, new Date(cmd.arrivesAt));
    const { state, village } = ctx;
    state.units = addUnits(state.units, cmd.units);
    if (cmd.loot) {
      const cap = state.storageCapacity();
      for (const r of RESOURCES) state.resources[r] = Math.max(state.resources[r], Math.min(cap, state.resources[r] + (cmd.loot[r] || 0)));
    }
    village.set(state.toData());
    await village.save({ transaction: t });
  }

  // ---------------------------------------------------------------- Lecture

  static async overview(villageId) {
    const withVillages = [
      { association: 'origin', include: [Player] },
      { association: 'target', include: [Player] },
    ];
    const [outgoing, incoming, stacksHere, stacksAway] = await Promise.all([
      Command.findAll({ where: { originVillageId: villageId }, include: withVillages, order: [['arrivesAt', 'ASC']] }),
      Command.findAll({
        where: { targetVillageId: villageId, type: { [Op.in]: ['attack', 'support'] } },
        include: withVillages,
        order: [['arrivesAt', 'ASC']],
      }),
      SupportStack.findAll({ where: { villageId }, include: [{ association: 'origin', include: [Player] }] }),
      SupportStack.findAll({ where: { originVillageId: villageId }, include: [{ association: 'village', include: [Player] }] }),
    ]);
    return { outgoing, incoming, stacksHere, stacksAway };
  }

  /** `villageIds` : villages du joueur s'ils sont déjà lus (en-tête des pages). */
  static async incomingAttackCount(playerId, villageIds = null) {
    const ids = villageIds || (await Village.findAll({ where: { playerId }, attributes: ['id'], raw: true })).map((v) => v.id);
    if (!ids.length) return 0;
    return Command.count({ where: { type: 'attack', targetVillageId: { [Op.in]: ids } } });
  }
}

CommandService.addUnits = addUnits;

CommandService.chainGapMs = chainGapMs;
CommandService.MAX_CHAINED = MAX_CHAINED;

module.exports = CommandService;
