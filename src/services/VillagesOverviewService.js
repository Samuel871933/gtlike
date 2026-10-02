'use strict';

// Aperçus des villages (overview_villages de Guerre Tribale) : une ligne par village du joueur, avec ses
// ressources, sa ferme, ses troupes, ses bâtiments et l'activité de ses files, à jour à l'instant de la requête.

const { Op, fn, col } = require('sequelize');
const {
  World, Village, Command, BuildOrder, RecruitOrder, ResearchOrder, SupportStack, ScavengeRun, Knight, Transport, MarketOffer,
} = require('../models');
const VillageService = require('./VillageService');
const KnightSkillService = require('./KnightSkillService');
const VillageState = require('../game/VillageState');
const formulas = require('../game/formulas');

/** Lignes groupées par village : Map id → lignes. */
function byVillage(rows, column = 'villageId') {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r[column])) out.set(r[column], []);
    out.get(r[column]).push(r);
  }
  return out;
}

class VillagesOverviewService {
  /**
   * Les villages qui ont une échéance passée (construction, recrue, recherche, collecte, formation) sont rafraîchis
   * et enregistrés un par un, comme à l'affichage du village. Les autres n'ont rien à enregistrer : leur état à cet
   * instant se calcule en mémoire, à partir de quelques lectures communes à tous les villages (et non une
   * transaction par village, des centaines pour un gros joueur).
   * @returns {Promise<object[]>} une ligne par village, dans l'ordre du sélecteur de villages (nom, puis id)
   */
  static async rows(playerId, now = new Date()) {
    let villages = await Village.findAll({ where: { playerId }, attributes: ['id'], order: [['name', 'ASC'], ['id', 'ASC']], raw: true });
    const ids = villages.map((v) => v.id);
    if (!ids.length) return [];

    const fresh = new Map();
    for (const id of await VillageService.dueVillageIds(now, ids)) {
      fresh.set(id, await VillageService.withVillage(id, async (ctx) => ctx, { now }));
    }
    villages = await Village.findAll({ where: { id: { [Op.in]: ids }, playerId } });
    const cfg = (await World.findByPk(villages[0].worldId)).getConfig();
    const where = (column) => ({ where: { [column]: { [Op.in]: ids } } });
    const [builds, recruits, research, commands, stacks, runs, training, moving, offers, attacks] = await Promise.all([
      BuildOrder.findAll({ ...where('villageId'), order: [['endsAt', 'ASC']] }),
      RecruitOrder.findAll({ ...where('villageId'), order: [['startsAt', 'ASC']] }),
      ResearchOrder.findAll({ ...where('villageId'), order: [['endsAt', 'ASC']] }),
      Command.findAll({ ...where('originVillageId'), attributes: ['originVillageId', 'units'] }),
      SupportStack.findAll({ ...where('originVillageId'), attributes: ['originVillageId', 'units'] }),
      ScavengeRun.findAll({ ...where('villageId'), attributes: ['villageId', 'units'] }),
      Knight.findAll({ where: { homeVillageId: { [Op.in]: ids }, trainingEndsAt: { [Op.ne]: null } }, attributes: ['homeVillageId'], raw: true }),
      Transport.findAll({ ...where('originVillageId'), attributes: ['originVillageId', [fn('SUM', col('merchants')), 'n']], group: ['originVillageId'], raw: true }),
      MarketOffer.findAll({ ...where('villageId'), attributes: ['villageId', 'count', 'merchantsPerOffer'], raw: true }),
      Command.findAll({ where: { type: 'attack', targetVillageId: { [Op.in]: ids } }, attributes: ['targetVillageId'], raw: true }),
    ]);
    const buildsOf = byVillage(builds);
    const recruitsOf = byVillage(recruits);
    const researchOf = byVillage(research);
    const awayOf = new Map();
    const addAway = (id, units) => {
      const total = awayOf.get(id) || {};
      for (const [unit, n] of Object.entries(units)) total[unit] = (total[unit] || 0) + n;
      awayOf.set(id, total);
    };
    for (const c of commands) addAway(c.originVillageId, c.units);
    for (const s of stacks) addAway(s.originVillageId, s.units);
    for (const r of runs) addAway(r.villageId, r.units);
    // Un paladin en formation reste à la charge de la ferme de son village (VillageService.awayUnits).
    for (const k of training) addAway(k.homeVillageId, { knight: 1 });
    const busyOf = new Map(moving.map((m) => [m.originVillageId, Number(m.n) || 0]));
    for (const o of offers) busyOf.set(o.villageId, (busyOf.get(o.villageId) || 0) + o.count * o.merchantsPerOffer);

    const byId = new Map(villages.map((v) => [v.id, v]));
    const out = [];
    for (const id of ids) {
      const village = byId.get(id);
      if (!village) continue; // perdu entre-temps (conquête traitée pendant le rafraîchissement)
      let ctx = fresh.get(id);
      if (!ctx) {
        const buildOrders = buildsOf.get(id) || [];
        const recruitOrders = recruitsOf.get(id) || [];
        const villageBonus = await KnightSkillService.villageBonuses(village, cfg);
        const state = new VillageState({ ...village.get({ plain: true }), villageBonus }, cfg);
        // Rien n'est échu : ces appels ne font qu'avancer la production jusqu'à maintenant (voir VillageService.refresh).
        state.applyBuildOrders(buildOrders, now);
        if (state.militiaUntil && now >= state.militiaUntil) state.dismissMilitia();
        state.applyRecruitOrders(recruitOrders, now);
        state.applyResearchOrders(researchOf.get(id) || [], now);
        ctx = { village, state, buildOrders, recruitOrders, researchOrders: researchOf.get(id) || [], awayUnits: awayOf.get(id) || {} };
      }
      const { state } = ctx;
      const popUsed = state.popUsed(ctx.buildOrders, ctx.recruitOrders, ctx.awayUnits);
      const total = formulas.merchantCount(state.level('market'));
      const busy = busyOf.get(id) || 0;
      out.push({
        village: ctx.village,
        points: ctx.village.points,
        resources: { ...state.resources },
        production: state.productionPerHour(),
        storage: state.storageCapacity(),
        pop: { used: popUsed, max: state.farmCapacity() },
        units: { ...state.units },
        away: ctx.awayUnits,
        buildings: { ...state.buildings },
        buildOrders: ctx.buildOrders,
        recruiting: (b) => ctx.recruitOrders.filter((o) => o.building === b),
        researchOrders: ctx.researchOrders,
        merchants: { total, busy, free: Math.max(0, total - busy) },
        incomingAttacks: attacks.filter((c) => c.targetVillageId === id).length,
      });
    }
    return out;
  }
}

module.exports = VillagesOverviewService;
