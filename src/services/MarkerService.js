'use strict';

const { Op, fn, col, where: whereFn } = require('sequelize');
const { MapMarker, Player, Tribe, Village } = require('../models');
const GameError = require('./GameError');

const MAX_MARKERS = 50;
const TYPES = ['player', 'tribe', 'village'];
// Couleur libre (sélecteur de couleur), au format #rrggbb : seul format accepté, car elle est écrite telle quelle
// dans les styles de la carte, de la mini-carte et de la légende.
const COLOR_RE = /^#[0-9a-f]{6}$/;
const DEFAULT_COLOR = '#ff3b30';

/**
 * Marquages de carte d'un joueur (comme « Modifier les marquages sur la carte » sur Guerre Tribale) :
 * une couleur pour un joueur, une tribu ou un village, visible sur la carte, la mini-carte et la légende.
 */
class MarkerService {
  /**
   * Marquages du joueur, avec leur cible (nom, tag, coordonnées). Les cibles disparues (compte supprimé,
   * tribu dissoute) sont ignorées.
   * @returns {{ id, targetType, targetId, color, label, x?, y? }[]}
   */
  static async list(playerId, worldId) {
    const markers = await MapMarker.findAll({ where: { playerId }, order: [['createdAt', 'ASC']] });
    const ids = (type) => markers.filter((m) => m.targetType === type).map((m) => m.targetId);
    const [players, tribes, villages] = await Promise.all([
      Player.findAll({ where: { id: ids('player'), worldId }, attributes: ['id', 'name'] }),
      Tribe.findAll({ where: { id: ids('tribe'), worldId }, attributes: ['id', 'tag', 'name'] }),
      Village.findAll({ where: { id: ids('village'), worldId }, attributes: ['id', 'name', 'x', 'y'] }),
    ]);
    const label = {
      player: new Map(players.map((p) => [p.id, { label: p.name }])),
      tribe: new Map(tribes.map((t) => [t.id, { label: `[${t.tag}] ${t.name}` }])),
      village: new Map(villages.map((v) => [v.id, { label: `${v.name} (${v.x}|${v.y})`, x: v.x, y: v.y }])),
    };
    return markers
      .filter((m) => label[m.targetType] && label[m.targetType].has(m.targetId))
      .map((m) => ({ id: m.id, targetType: m.targetType, targetId: m.targetId, color: m.color, ...label[m.targetType].get(m.targetId) }));
  }

  /** Couleurs par cible : { player: Map(id → couleur), tribe: Map, village: Map }. */
  static colorMaps(markers) {
    const maps = { player: new Map(), tribe: new Map(), village: new Map() };
    for (const m of markers) maps[m.targetType].set(m.targetId, m.color);
    return maps;
  }

  /**
   * Couleur d'un village selon les marquages : celui du village, sinon de son propriétaire, sinon de sa tribu.
   * `v` : village avec son Player (tribeId).
   */
  static colorOf(maps, v) {
    return maps.village.get(v.id) || (v.playerId && maps.player.get(v.playerId)) || (v.Player && v.Player.tribeId && maps.tribe.get(v.Player.tribeId)) || null;
  }

  /**
   * Ajoute un marquage, ou change sa couleur s'il existe déjà. La cible est donnée par son id (`targetId`,
   * depuis le menu de la carte) ou saisie (`target`) : nom du joueur, tag ou nom de la tribu, coordonnées « x|y ».
   */
  static async set(playerId, worldId, { type, targetId, target, color }) {
    if (!TYPES.includes(type)) throw new GameError('Type de marquage inconnu.');
    color = String(color || '').trim().toLowerCase();
    if (!COLOR_RE.test(color)) throw new GameError('Couleur invalide (format #rrggbb).');
    const id = await MarkerService.resolve(worldId, type, targetId, target);
    const existing = await MapMarker.findOne({ where: { playerId, targetType: type, targetId: id } });
    if (existing) return existing.update({ color });
    if (await MapMarker.count({ where: { playerId } }) >= MAX_MARKERS) throw new GameError(`${MAX_MARKERS} marquages au maximum.`);
    return MapMarker.create({ playerId, targetType: type, targetId: id, color });
  }

  static async resolve(worldId, type, targetId, target) {
    const text = String(target || '').trim();
    const byId = Number.parseInt(targetId, 10);
    const lower = (column) => whereFn(fn('lower', col(column)), text.toLowerCase());
    let found = null;
    if (type === 'player') {
      found = Number.isFinite(byId)
        ? await Player.findOne({ where: { id: byId, worldId }, attributes: ['id'] })
        : await Player.findOne({ where: { worldId, [Op.and]: [lower('name')] }, attributes: ['id'] });
    } else if (type === 'tribe') {
      found = Number.isFinite(byId)
        ? await Tribe.findOne({ where: { id: byId, worldId }, attributes: ['id'] })
        : await Tribe.findOne({ where: { worldId, [Op.or]: [lower('tag'), lower('name')] }, attributes: ['id'] });
    } else if (Number.isFinite(byId)) {
      found = await Village.findOne({ where: { id: byId, worldId }, attributes: ['id'] });
    } else {
      const m = /^\s*(\d+)\D+(\d+)\s*$/.exec(text);
      if (m) found = await Village.findOne({ where: { worldId, x: Number(m[1]), y: Number(m[2]) }, attributes: ['id'] });
    }
    if (!found) {
      throw new GameError({ player: 'Aucun joueur de ce nom.', tribe: 'Aucune tribu avec ce tag ou ce nom.', village: 'Aucun village à ces coordonnées.' }[type]);
    }
    return found.id;
  }

  static async remove(playerId, markerId) {
    const n = await MapMarker.destroy({ where: { id: Number(markerId), playerId } });
    if (!n) throw new GameError('Marquage introuvable.', 404);
  }
}

MarkerService.DEFAULT_COLOR = DEFAULT_COLOR;
MarkerService.TYPES = TYPES;
MarkerService.MAX_MARKERS = MAX_MARKERS;

module.exports = MarkerService;
