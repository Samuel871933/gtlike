'use strict';

const { Op } = require('sequelize');
const { ScavengeRun, Report } = require('../models');
const scavenging = require('../game/scavenging');
const registry = require('../game/registry');
const GameError = require('./GameError');

const RESOURCES = ['wood', 'stone', 'iron'];

class ScavengeService {
  static enabled(cfg) {
    return Boolean(cfg.scavenging?.active);
  }

  /** Options débloquées d'un village (la première, sans coût de déblocage, l'est toujours). */
  static unlocked(village, cfg) {
    const done = new Set(village.scavenging?.unlocked || []);
    for (const o of cfg.scavenging.options) if (!o.unlock) done.add(o.id);
    return done;
  }

  /** État des options pour l'affichage : verrouillée, en déblocage, libre ou en cours. */
  static async overview(ctx) {
    const runs = await ScavengeRun.findAll({ where: { villageId: ctx.village.id }, order: [['option', 'ASC']] });
    const unlocked = ScavengeService.unlocked(ctx.village, ctx.cfg);
    const unlocking = ctx.village.scavenging?.unlocking || null;
    return ctx.cfg.scavenging.options.map((option) => ({
      option,
      unlocked: unlocked.has(option.id),
      unlocking: unlocking && unlocking.option === option.id ? unlocking : null,
      run: runs.find((r) => r.option === option.id) || null,
    }));
  }

  static assertAvailable(ctx) {
    if (!ScavengeService.enabled(ctx.cfg)) throw new GameError("La collecte n'existe pas sur ce monde.");
    if (ctx.state.level('place') < 1) throw new GameError('Il faut un point de ralliement.');
  }

  /** Débloque une option (une à la fois, dans l'ordre). */
  static async unlock(villageId, optionId, { now } = {}) {
    const VillageService = require('./VillageService');
    return VillageService.withVillage(villageId, async (ctx, t) => {
      ScavengeService.assertAvailable(ctx);
      const option = ctx.cfg.scavenging.options.find((o) => o.id === Number(optionId));
      if (!option) throw new GameError('Option inconnue.');
      const unlocked = ScavengeService.unlocked(ctx.village, ctx.cfg);
      if (unlocked.has(option.id)) throw new GameError('Option déjà débloquée.');
      if (ctx.village.scavenging?.unlocking) throw new GameError('Un déblocage est déjà en cours.');
      const previous = ctx.cfg.scavenging.options.find((o) => o.id === option.id - 1);
      if (previous && !unlocked.has(previous.id)) throw new GameError(`Débloquez d'abord « ${previous.name} ».`);
      if (!ctx.state.canAfford(option.unlock.cost)) throw new GameError('Ressources insuffisantes.');
      ctx.state.pay(option.unlock.cost);
      const endsAt = new Date(ctx.now.getTime() + (option.unlock.hours * 3600000) / ctx.cfg.speed);
      await ctx.village.update({
        ...ctx.state.resources,
        scavenging: { ...ctx.village.scavenging, unlocking: { option: option.id, endsAt: endsAt.toISOString() } },
      }, { transaction: t });
    }, { now });
  }

  /** Envoie des troupes présentes au village sur une option libre. */
  static async send(villageId, optionId, input, { now } = {}) {
    const VillageService = require('./VillageService');
    return VillageService.withVillage(villageId, async (ctx, t) => {
      ScavengeService.assertAvailable(ctx);
      const option = ctx.cfg.scavenging.options.find((o) => o.id === Number(optionId));
      if (!option || !ScavengeService.unlocked(ctx.village, ctx.cfg).has(option.id)) throw new GameError('Option non débloquée.');
      if (await ScavengeRun.count({ where: { villageId: ctx.village.id, option: option.id }, transaction: t })) {
        throw new GameError('Cette option est déjà en cours.');
      }
      const units = {};
      for (const u of scavenging.unitsFor(ctx.cfg)) {
        const n = Math.floor(Number(input?.[u.id]));
        if (!Number.isFinite(n) || n <= 0) continue;
        if ((ctx.state.units[u.id] || 0) < n) throw new GameError(`Pas assez de ${u.name} dans le village.`);
        units[u.id] = n;
      }
      const cap = scavenging.capacity(units);
      if (!cap) throw new GameError('Choisissez des unités capables de transporter des ressources.');

      for (const [id, n] of Object.entries(units)) {
        ctx.state.units[id] -= n;
        if (!ctx.state.units[id]) delete ctx.state.units[id];
      }
      await ctx.village.update({ units: { ...ctx.state.units } }, { transaction: t });
      const seconds = scavenging.duration(cap, option.lootFactor, ctx.cfg);
      return ScavengeRun.create({
        villageId: ctx.village.id, option: option.id, units, resources: scavenging.haul(cap, option.lootFactor),
        startsAt: ctx.now, endsAt: new Date(ctx.now.getTime() + seconds * 1000),
      }, { transaction: t });
    }, { now });
  }

  /**
   * Au rafraîchissement du village : fin des déblocages et retour des expéditions terminées
   * (le butin au-delà de l'entrepôt est perdu).
   */
  static async applyFinished(village, state, cfg, now, t) {
    const unlocking = village.scavenging?.unlocking;
    if (unlocking && new Date(unlocking.endsAt) <= now) {
      village.scavenging = { unlocked: [...new Set([...(village.scavenging.unlocked || []), unlocking.option])] };
    }
    const runs = await ScavengeRun.findAll({ where: { villageId: village.id, endsAt: { [Op.lte]: now } }, order: [['endsAt', 'ASC']], transaction: t });
    const cap = state.storageCapacity();
    for (const run of runs) {
      for (const [id, n] of Object.entries(run.units)) state.units[id] = (state.units[id] || 0) + n;
      for (const r of RESOURCES) {
        const cur = state.resources[r];
        state.resources[r] = Math.max(cur, Math.min(cap, cur + (run.resources[r] || 0)));
      }
      if (village.playerId) {
        const option = cfg.scavenging.options.find((o) => o.id === run.option);
        await Report.create({
          playerId: village.playerId, type: 'scavenge', happenedAt: new Date(run.endsAt),
          title: `Collecte terminée (${option ? option.name : `option ${run.option}`}) à ${village.name}`,
          data: { perspective: 'scavenge', village: `${village.name} (${village.x}|${village.y})`, units: run.units, received: run.resources },
        }, { transaction: t });
      }
      await run.destroy({ transaction: t });
    }
  }

  static unitName(id) {
    return registry.unit(id).name;
  }
}

module.exports = ScavengeService;
