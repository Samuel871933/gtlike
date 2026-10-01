'use strict';

const { Op } = require('sequelize');
const { sequelize, World, Player, Tribe, DailyStat, DailyAward, Report } = require('../models');

// Succès quotidiens (wiki DS) : attribués au gagnant unique de la journée (heure du serveur).
const DAILY = [
  { key: 'dailyPlunderer', name: 'Pillard du jour', field: 'plunders', text: 'le plus de villages pillés' },
  { key: 'dailyAttacker', name: 'Attaquant du jour', field: 'unitsKilledAttacker', text: "le plus d'unités tuées en attaque" },
  { key: 'dailyDefender', name: 'Défenseur du jour', field: 'unitsKilledDefender', text: "le plus d'unités tuées en défense" },
  { key: 'dailyConqueror', name: 'Grande puissance du jour', field: 'conquests', text: 'le plus de villages conquis' },
  { key: 'dailyRobber', name: 'Brigand du jour', field: 'loot', text: 'le plus de ressources pillées' },
  { key: 'dailySupporter', name: 'Soutien du jour', field: 'unitsKilledSupporter', text: "le plus d'unités tuées en soutien" },
];
// Records journaliers (« Record Journalier » du classement GT) : plus haut score obtenu en une journée.
const RECORDS = [
  { key: 'att', field: 'unitsKilledAttacker', name: 'Unités détruites en attaque' },
  { key: 'def', field: 'unitsKilledDefender', name: 'Unités détruites en défense' },
  { key: 'sup', field: 'unitsKilledSupporter', name: 'Unités détruites en soutien' },
  { key: 'loot', field: 'loot', name: 'Ressources pillées' },
  { key: 'plunders', field: 'plunders', name: 'Villages pillés' },
  { key: 'conquests', field: 'conquests', name: 'Villages conquis' },
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
        data: { perspective: 'award', daily: true, key: def.key, tier: 4, tiers: 1, name: def.name, description: `Vous avez obtenu ${def.text} le ${day} (${first[def.field]}).` },
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

  /** Nombre de succès quotidiens par catégorie pour un joueur, avec la date du dernier obtenu (`last`, AAAA-MM-JJ). */
  static async countsFor(playerId) {
    const rows = await DailyAward.findAll({ where: { playerId }, attributes: ['key', 'day'], raw: true });
    return DAILY.map((def) => {
      const days = rows.filter((r) => r.key === def.key).map((r) => r.day).sort();
      return { def, count: days.length, last: days.at(-1) || null };
    });
  }

  /**
   * Record journalier d'une catégorie de RECORDS : meilleure journée de chaque joueur du monde (la première s'il y en a
   * plusieurs à égalité), du plus haut score au plus bas. Lignes { player (avec Tribe), score, day }.
   */
  static async records(worldId, recordKey) {
    const def = RECORDS.find((r) => r.key === recordKey) || RECORDS[0];
    const table = DailyStat.getTableName();
    const best = await sequelize.query(
      `SELECT playerId, score, day FROM (
         SELECT playerId, "${def.field}" AS score, day,
                ROW_NUMBER() OVER (PARTITION BY playerId ORDER BY "${def.field}" DESC, day ASC) AS n
         FROM "${table}" WHERE worldId = :worldId AND "${def.field}" > 0
       ) WHERE n = 1 ORDER BY score DESC, day ASC, playerId ASC`,
      { replacements: { worldId }, type: sequelize.QueryTypes.SELECT },
    );
    const players = await Player.findAll({
      where: { id: best.map((r) => r.playerId) }, include: [{ model: Tribe, attributes: ['id', 'tag', 'name', 'avatar'] }],
    });
    const byId = new Map(players.map((p) => [p.id, p]));
    return best.filter((r) => byId.has(r.playerId)).map((r) => ({ player: byId.get(r.playerId), score: r.score, day: r.day }));
  }
}

DailyService.DAILY = DAILY;
DailyService.RECORDS = RECORDS;

module.exports = DailyService;
