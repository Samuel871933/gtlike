'use strict';

const { Op } = require('sequelize');
const { Player, Village, Command, Report, LastAttack, ArmyTemplate } = require('../models');
const CommandService = require('./CommandService');
const PaginationService = require('./PaginationService');
const { distance } = require('../game/movement');
const GameError = require('./GameError');

// Filtres de l'assistant de pillage (comme sur GT), mémorisés sur le joueur (Players.farmSettings) :
//   here      : seulement les attaques parties du village courant ;
//   attacked  : garder les villages vers lesquels une attaque est déjà en route ;
//   loss      : garder les dernières attaques à pertes totales ;
//   partial   : garder les dernières attaques à pertes partielles ;
//   fullOnly  : seulement les attaques revenues avec un butin plein.
const FILTERS = { here: false, attacked: false, loss: false, partial: true, fullOnly: false };
const SORTS = ['distance', 'date'];

/**
 * Assistant de pillage (premium) : les villages barbares déjà attaqués par le joueur, d'après la dernière attaque sur
 * chacun (LastAttack, la gommette de la carte), et l'envoi rapide d'un modèle d'armée favori.
 * À la différence de GT, pas de modèles propres à l'assistant : il utilise les modèles d'armée favoris.
 */
class FarmService {
  /** Filtres et tri du joueur, complétés par les valeurs par défaut. */
  static settings(player) {
    const saved = (player && player.farmSettings) || {};
    const out = { sort: SORTS.includes(saved.sort) ? saved.sort : 'distance' };
    for (const [k, d] of Object.entries(FILTERS)) out[k] = typeof saved[k] === 'boolean' ? saved[k] : d;
    return out;
  }

  /** Enregistre les filtres d'un formulaire (case cochée : '1') et le tri. */
  static async saveSettings(playerId, input) {
    const player = await Player.findByPk(playerId);
    const next = { ...FarmService.settings(player) };
    for (const k of Object.keys(FILTERS)) next[k] = input[k] === '1' || input[k] === 'on';
    if (SORTS.includes(input.sort)) next.sort = input.sort;
    await player.update({ farmSettings: next });
    return next;
  }

  /**
   * Lignes de l'assistant vues depuis `village` : { village, last, distance, attacking, report: { resources, wall } }.
   * Filtrées par `settings`, triées (distance ou date), puis paginées.
   */
  static async list(player, village, settings, { page = 1, now = new Date() } = {}) {
    const marks = await LastAttack.findAll({ where: { playerId: player.id }, raw: true });
    const targets = marks.length
      ? await Village.findAll({ where: { id: marks.map((m) => m.villageId), worldId: village.worldId, playerId: null }, attributes: ['id', 'name', 'x', 'y', 'points'] })
      : [];
    const byId = new Map(targets.map((v) => [v.id, v]));
    // Attaques en route depuis n'importe lequel de ses villages.
    const going = targets.length ? await Command.findAll({
      where: { targetVillageId: targets.map((v) => v.id), type: 'attack', cancelled: false, arrivesAt: { [Op.gt]: now } },
      attributes: ['targetVillageId'], raw: true,
      include: [{ association: 'origin', attributes: [], required: true, where: { playerId: player.id } }],
    }) : [];
    const attacking = new Map();
    for (const c of going) attacking.set(c.targetVillageId, (attacking.get(c.targetVillageId) || 0) + 1);

    let rows = marks.filter((m) => byId.has(m.villageId)).map((m) => {
      const target = byId.get(m.villageId);
      return { village: target, last: m, distance: distance(village, target), attacking: attacking.get(target.id) || 0 };
    });
    rows = rows.filter(({ last, attacking: n }) => {
      if (settings.here && last.originVillageId !== village.id) return false;
      if (!settings.attacked && n) return false;
      if (!settings.loss && last.result === 'loss') return false;
      if (!settings.partial && last.result === 'partial') return false;
      if (settings.fullOnly && last.haul !== 'full') return false;
      return true;
    });
    const at = (r) => new Date(r.last.happenedAt).getTime();
    rows.sort(settings.sort === 'date'
      ? (a, b) => at(b) - at(a) || a.distance - b.distance
      : (a, b) => a.distance - b.distance || at(b) - at(a));

    const pagination = PaginationService.paginate(rows.length, page, PaginationService.perPage(player, 'farm'));
    rows = rows.slice(pagination.offset, pagination.offset + pagination.perPage);
    // Rapports de la page : ressources espionnées et niveau du mur connus à la dernière attaque.
    const ids = rows.map((r) => r.last.reportId).filter(Boolean);
    const reports = ids.length ? await Report.findAll({ where: { id: ids, playerId: player.id }, attributes: ['id', 'data'] }) : [];
    const byReport = new Map(reports.map((r) => [r.id, r.data || {}]));
    for (const row of rows) {
      const data = byReport.get(row.last.reportId);
      if (!data) { row.report = null; continue; }
      const intel = data.intel || {};
      const wall = intel.buildings ? intel.buildings.wall || 0 : data.hideDefender || !data.wall ? null : data.wall.after;
      row.report = { id: row.last.reportId, resources: intel.resources || null, wall };
    }
    return { rows, pagination };
  }

  /** Retire un village de la liste : sa dernière attaque est oubliée (il revient à la prochaine attaque). */
  static async forget(playerId, villageId) {
    const n = await LastAttack.destroy({ where: { playerId, villageId: Number(villageId) } });
    if (!n) throw new GameError('Village introuvable dans la liste.', 404);
  }

  /** Envoie le modèle `templateId` du joueur en attaque de `villageId` (cible) depuis `fromVillageId`. */
  static async send(fromVillageId, playerId, templateId, villageId, cfg) {
    const tpl = await ArmyTemplate.findOne({ where: { playerId, id: Number(templateId) } });
    if (!tpl) throw new GameError('Modèle introuvable.', 404);
    const from = await Village.findByPk(fromVillageId, { attributes: ['id', 'worldId'] });
    const target = await Village.findOne({ where: { id: Number(villageId), worldId: from.worldId }, attributes: ['id', 'x', 'y'] });
    if (!target) throw new GameError('Village introuvable.', 404);
    const units = CommandService.parseUnits(tpl.units, cfg);
    const command = await CommandService.send(fromVillageId, { x: target.x, y: target.y, type: 'attack', units });
    return { command, units, template: tpl, target };
  }
}

FarmService.FILTERS = FILTERS;
FarmService.SORTS = SORTS;

module.exports = FarmService;
