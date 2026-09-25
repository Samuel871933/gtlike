'use strict';

const { Op } = require('sequelize');
const { World, DailyStat, DailyAward, Report } = require('../models');

// Succès quotidiens (wiki DS) : attribués au gagnant unique de la journée (heure du serveur).
const DAILY = [
  { key: 'dailyPlunderer', name: 'Pillard du jour', field: 'plunders', text: 'le plus de villages pillés' },
  { key: 'dailyAttacker', name: 'Attaquant du jour', field: 'unitsKilledAttacker', text: "le plus d'unités tuées en attaque" },
  { key: 'dailyDefender', name: 'Défenseur du jour', field: 'unitsKilledDefender', text: "le plus d'unités tuées en défense" },
  { key: 'dailyConqueror', name: 'Grande puissance du jour', field: 'conquests', text: 'le plus de villages conquis' },
  { key: 'dailyRobber', name: 'Brigand du jour', field: 'loot', text: 'le plus de ressources pillées' },
  { key: 'dailySupporter', name: 'Soutien du jour', field: 'unitsKilledSupporter', text: "le plus d'unités tuées en soutien" },
];
const pad = (n) => String(n).padStart(2, '0');

class DailyService {
  static dayKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Ajoute des compteurs à la journée de `at` pour ce joueur. */
  static async add(worldId, playerId, deltas, at, t) {
    if (!playerId) return;
    const values = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)]));
    if (!Object.keys(values).length) return;
    const [row] = await DailyStat.findOrCreate({
      where: { playerId, day: DailyService.dayKey(at) }, defaults: { worldId }, transaction: t,
    });
    await row.increment(values, { transaction: t });
  }

  /** Attribue les succès d'une journée terminée (sans effet si déjà fait). */
  static async awardDay(worldId, day, t) {
    const awarded = [];
    for (const def of DAILY) {
      if (await DailyAward.findOne({ where: { worldId, day, key: def.key }, transaction: t })) continue;
      const [first, second] = await DailyStat.findAll({
        where: { worldId, day, [def.field]: { [Op.gt]: 0 } }, order: [[def.field, 'DESC']], limit: 2, transaction: t,
      });
      if (!first || (second && second[def.field] === first[def.field])) continue; // pas de gagnant unique
      await DailyAward.create({ worldId, day, key: def.key, playerId: first.playerId, value: first[def.field] }, { transaction: t });
      await Report.create({
        playerId: first.playerId, type: 'award', happenedAt: new Date(),
        title: `Succès du jour : ${def.name} (${day})`,
        data: { perspective: 'award', key: def.key, tier: 4, name: def.name, description: `Vous avez obtenu ${def.text} le ${day} (${first[def.field]}).` },
      }, { transaction: t });
      awarded.push({ def, playerId: first.playerId });
    }
    return awarded;
  }

  /** Journées terminées des 7 derniers jours pas encore traitées, pour tous les mondes. */
  static async awardPending(now = new Date()) {
    const today = DailyService.dayKey(now);
    const since = DailyService.dayKey(new Date(now.getTime() - 7 * 86400000));
    for (const world of await World.findAll({ attributes: ['id'] })) {
      const days = await DailyStat.findAll({
        where: { worldId: world.id, day: { [Op.lt]: today, [Op.gte]: since } },
        attributes: ['day'], group: ['day'], raw: true,
      });
      for (const { day } of days) await DailyService.awardDay(world.id, day);
    }
  }

  /** Nombre de succès quotidiens par catégorie pour un joueur. */
  static async countsFor(playerId) {
    const rows = await DailyAward.findAll({ where: { playerId }, attributes: ['key'], raw: true });
    return DAILY.map((def) => ({ def, count: rows.filter((r) => r.key === def.key).length }));
  }
}

DailyService.DAILY = DAILY;

module.exports = DailyService;
