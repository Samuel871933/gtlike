'use strict';

const { Op } = require('sequelize');
const { sequelize, Village, Knight, RecruitOrder, Command, SupportStack } = require('../models');
const skills = require('../game/knightSkills');
const GameError = require('./GameError');

/**
 * Paladins à compétences (knightSystem: 'skills'). Chaque paladin est rattaché à un village ;
 * l'unité « knight » d'un village (chez lui, en route ou en soutien) est toujours son paladin.
 */
class KnightSkillService {
  static enabled(cfg) {
    return cfg.hasFeature('knight') && cfg.knightSystem === 'skills';
  }

  static async ofPlayer(playerId, t) {
    return Knight.findAll({ where: { playerId }, include: [{ association: 'home', attributes: ['id', 'name', 'x', 'y'] }], order: [['id', 'ASC']], transaction: t });
  }

  static async ofVillage(villageId, t) {
    return Knight.findOne({ where: { homeVillageId: villageId }, transaction: t });
  }

  /** Paladins de plusieurs villages d'origine, en un seul appel. */
  static async ofVillages(villageIds, t) {
    const ids = [...new Set(villageIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const knights = await Knight.findAll({ where: { homeVillageId: { [Op.in]: ids }, alive: true }, transaction: t });
    return new Map(knights.map((k) => [k.homeVillageId, k]));
  }

  /**
   * Vérifie qu'un paladin peut être recruté (ou ressuscité) dans ce village : un par village,
   * et au plus `maxKnights(nombre de villages)` paladins pour le joueur.
   */
  static async assertCanRecruit(village, t) {
    const [villages, knights, existing, queued, away] = await Promise.all([
      Village.count({ where: { playerId: village.playerId }, transaction: t }),
      Knight.count({ where: { playerId: village.playerId }, transaction: t }),
      KnightSkillService.ofVillage(village.id, t),
      RecruitOrder.count({ where: { villageId: village.id, unit: 'knight' }, transaction: t }),
      KnightSkillService.awayFrom(village.id, t),
    ]);
    if (queued) throw new GameError('Un paladin est déjà en formation dans ce village.');
    if (existing && (existing.alive || away || (village.units.knight || 0) > 0)) {
      throw new GameError('Ce village a déjà son paladin.');
    }
    if (!existing && knights >= skills.maxKnights(villages)) {
      throw new GameError(`Avec ${villages} village(s), vous pouvez avoir ${skills.maxKnights(villages)} paladin(s).`);
    }
  }

  static async awayFrom(villageId, t) {
    const [commands, stacks] = await Promise.all([
      Command.findAll({ where: { originVillageId: villageId }, attributes: ['units'], transaction: t }),
      SupportStack.findAll({ where: { originVillageId: villageId }, attributes: ['units'], transaction: t }),
    ]);
    return [...commands, ...stacks].some((x) => x.units.knight > 0);
  }

  /** Recrutement terminé : nouveau paladin, ou résurrection du paladin mort du village. */
  static async onRecruited(village, t) {
    const existing = await KnightSkillService.ofVillage(village.id, t);
    if (existing) return existing.update({ alive: true }, { transaction: t });
    return Knight.create({ playerId: village.playerId, homeVillageId: village.id, name: `Paladin de ${village.name}`.slice(0, 32) }, { transaction: t });
  }

  /** Paladins morts au combat (identifiés par leur village d'attache). */
  static async onDeath(homeVillageIds, t) {
    const ids = homeVillageIds.filter(Boolean);
    if (ids.length) await Knight.update({ alive: false }, { where: { homeVillageId: { [Op.in]: ids } }, transaction: t });
  }

  static async addXp(homeVillageId, xp, t) {
    const n = Math.round(xp);
    if (!homeVillageId || n <= 0) return;
    const knight = await KnightSkillService.ofVillage(homeVillageId, t);
    if (!knight || !knight.alive) return;
    const total = knight.xp + n;
    await knight.update({ xp: total, level: skills.levelForXp(total) }, { transaction: t });
  }

  /**
   * Compétences « village » actives : le paladin du village est vivant et présent chez lui.
   */
  static async villageBonuses(village, cfg, t) {
    if (!KnightSkillService.enabled(cfg) || !(village.units?.knight > 0)) return null;
    const knight = await KnightSkillService.ofVillage(village.id, t);
    return knight && knight.alive ? skills.bonuses([knight], 'village') : null;
  }

  /** Bonus de village de plusieurs villages, en une lecture : Map id → bonus (les villages sans bonus en sont absents). */
  static async villageBonusesOf(villages, cfg, t) {
    if (!KnightSkillService.enabled(cfg)) return new Map();
    const knights = await KnightSkillService.ofVillages(villages.filter((v) => v.units?.knight > 0).map((v) => v.id), t);
    return new Map([...knights].map(([id, knight]) => [id, skills.bonuses([knight], 'village')]));
  }

  /**
   * Lance une formation : le paladin doit être vivant et chez lui ; il quitte le village
   * (pas de combat ni de bonus) et revient avec l'expérience du programme.
   */
  static async train(villageId, programId, { now } = {}) {
    const VillageService = require('./VillageService');
    return VillageService.withVillage(villageId, async (ctx, t) => {
      if (!KnightSkillService.enabled(ctx.cfg)) throw new GameError('Pas de paladin à compétences sur ce monde.');
      const program = ctx.cfg.knightTraining.find((p) => p.id === programId);
      if (!program) throw new GameError('Programme inconnu.');
      const knight = await KnightSkillService.ofVillage(ctx.village.id, t);
      if (!knight || !knight.alive) throw new GameError("Ce village n'a pas de paladin vivant.");
      if (knight.trainingEndsAt) throw new GameError('Le paladin est déjà en formation.');
      if (!(ctx.state.units.knight > 0)) throw new GameError('Le paladin doit être dans son village.');
      if (!ctx.state.canAfford(program.cost)) throw new GameError('Ressources insuffisantes.');
      ctx.state.pay(program.cost);
      ctx.state.units = { ...ctx.state.units, knight: ctx.state.units.knight - 1 };
      if (!ctx.state.units.knight) delete ctx.state.units.knight;
      await ctx.village.update({ ...ctx.state.resources, units: ctx.state.units }, { transaction: t });
      const endsAt = new Date(ctx.now.getTime() + (program.hours * 3600000) / ctx.cfg.speed);
      await knight.update({ trainingEndsAt: endsAt, trainingXp: program.xp }, { transaction: t });
      return knight;
    }, { now });
  }

  /** Fin de formation (appelé au rafraîchissement du village) : le paladin revient avec son expérience. */
  static async finishTraining(village, state, now, t) {
    const knight = await Knight.findOne({ where: { homeVillageId: village.id, trainingEndsAt: { [Op.lte]: now } }, transaction: t });
    if (!knight) return;
    const xp = knight.xp + knight.trainingXp;
    await knight.update({ trainingEndsAt: null, trainingXp: 0, xp, level: skills.levelForXp(xp) }, { transaction: t });
    if (knight.alive) state.units.knight = (state.units.knight || 0) + 1;
  }

  static async owned(playerId, knightId, t) {
    const knight = await Knight.findOne({ where: { id: Number(knightId), playerId }, transaction: t, lock: t?.LOCK.UPDATE });
    if (!knight) throw new GameError('Paladin introuvable.', 404);
    return knight;
  }

  static async learn(playerId, knightId, skillId) {
    return sequelize.transaction(async (t) => {
      const knight = await KnightSkillService.owned(playerId, knightId, t);
      const blocker = skills.learnBlocker(knight, skillId);
      if (blocker) throw new GameError(blocker);
      await knight.update({ skills: { ...knight.skills, [skillId]: (knight.skills[skillId] || 0) + 1 } }, { transaction: t });
      return knight;
    });
  }

  /** Réinitialisation des compétences : gratuite (aucune option premium), livres rendus. */
  static async respec(playerId, knightId) {
    return sequelize.transaction(async (t) => {
      const knight = await KnightSkillService.owned(playerId, knightId, t);
      await knight.update({ skills: {} }, { transaction: t });
    });
  }

  static async rename(playerId, knightId, name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean || clean.length > 32) throw new GameError('Le nom doit faire 1 à 32 caractères.');
    return sequelize.transaction(async (t) => {
      const knight = await KnightSkillService.owned(playerId, knightId, t);
      await knight.update({ name: clean }, { transaction: t });
    });
  }
}

module.exports = KnightSkillService;
