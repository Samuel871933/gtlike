'use strict';

const { Op, fn, col, where: whereFn } = require('sequelize');
const { MapMarker, Player, Tribe, Village, VillageGroup, VillageGroupMember } = require('../models');
const GameError = require('./GameError');

const MAX_MARKERS = 50;
// Cibles : joueur, tribu, village, ou un des groupes de villages du joueur (tous ses villages du groupe).
const TYPES = ['player', 'tribe', 'village', 'group'];
// Icônes d'unité proposées (images de public/img/units) : seules, ou sur la couleur du marquage.
const ICONS = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
// Couleur libre (sélecteur de couleur), au format #rrggbb : seul format accepté, car elle est écrite telle quelle
// dans les styles de la carte, de la mini-carte et de la légende.
const COLOR_RE = /^#[0-9a-f]{6}$/;
const DEFAULT_COLOR = '#ff3b30';

/**
 * Marquages de carte d'un joueur (comme « Modifier les marquages sur la carte » sur Guerre Tribale) : une couleur, une
 * icône d'unité ou les deux pour un joueur, une tribu, un village ou un de ses groupes de villages, visibles sur la
 * carte, la mini-carte (couleur seulement) et la légende.
 */
class MarkerService {
  /**
   * Marquages du joueur, avec leur cible (nom, tag, coordonnées, villages d'un groupe). Les cibles disparues (compte
   * supprimé, tribu dissoute, groupe supprimé) sont ignorées.
   * @returns {{ id, targetType, targetId, color, icon, label, x?, y?, villageIds? }[]}
   */
  static async list(playerId, worldId) {
    const markers = await MapMarker.findAll({ where: { playerId }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
    const ids = (type) => markers.filter((m) => m.targetType === type).map((m) => m.targetId);
    const [players, tribes, villages, groups] = await Promise.all([
      Player.findAll({ where: { id: ids('player'), worldId }, attributes: ['id', 'name'] }),
      Tribe.findAll({ where: { id: ids('tribe'), worldId }, attributes: ['id', 'tag', 'name'] }),
      Village.findAll({ where: { id: ids('village'), worldId }, attributes: ['id', 'name', 'x', 'y'] }),
      VillageGroup.findAll({ where: { id: ids('group'), playerId }, attributes: ['id', 'name'], include: [{ model: VillageGroupMember, attributes: ['villageId'] }] }),
    ]);
    const label = {
      player: new Map(players.map((p) => [p.id, { label: p.name }])),
      tribe: new Map(tribes.map((t) => [t.id, { label: `[${t.tag}] ${t.name}` }])),
      village: new Map(villages.map((v) => [v.id, { label: `${v.name} (${v.x}|${v.y})`, x: v.x, y: v.y }])),
      group: new Map(groups.map((g) => [g.id, { label: g.name, villageIds: g.VillageGroupMembers.map((m) => m.villageId) }])),
    };
    return markers
      .filter((m) => label[m.targetType] && label[m.targetType].has(m.targetId))
      .map((m) => ({ id: m.id, targetType: m.targetType, targetId: m.targetId, color: m.color, icon: m.icon, ...label[m.targetType].get(m.targetId) }));
  }

  /**
   * Style par cible : { player: Map(id → { color, icon }), tribe, village, group: Map(id de village → style) }. Un
   * village dans plusieurs groupes marqués prend le style du marquage le plus ancien.
   */
  static colorMaps(markers) {
    const maps = { player: new Map(), tribe: new Map(), village: new Map(), group: new Map() };
    for (const m of markers) {
      const style = { color: m.color || null, icon: m.icon || null };
      if (m.targetType === 'group') {
        for (const id of m.villageIds || []) if (!maps.group.has(id)) maps.group.set(id, style);
      } else {
        maps[m.targetType].set(m.targetId, style);
      }
    }
    return maps;
  }

  /**
   * Style d'un village selon les marquages : celui du village, sinon d'un de ses groupes, sinon de son propriétaire,
   * sinon de sa tribu. `v` : village avec son Player (tribeId). @returns {{ color, icon }|null}
   */
  static styleOf(maps, v) {
    return maps.village.get(v.id) || maps.group.get(v.id) || (v.playerId && maps.player.get(v.playerId))
      || (v.Player && v.Player.tribeId && maps.tribe.get(v.Player.tribeId)) || null;
  }

  /** Couleur de marquage d'un village (mini-carte, carte du monde) : nulle pour un marquage sans couleur. */
  static colorOf(maps, v) {
    const style = MarkerService.styleOf(maps, v);
    return (style && style.color) || null;
  }

  /**
   * Ajoute un marquage, ou change son style s'il existe déjà. La cible est donnée par son id (`targetId`, depuis le
   * menu de la carte ou la liste des groupes) ou saisie (`target`) : nom du joueur, tag ou nom de la tribu,
   * coordonnées « x|y », nom du groupe. Couleur (#rrggbb, `color` vide : sans couleur) et icône d'unité (`icon`) :
   * l'une ou l'autre au moins.
   */
  static async set(playerId, worldId, { type, targetId, target, color, icon }) {
    if (!TYPES.includes(type)) throw new GameError('Type de marquage inconnu.');
    color = String(color || '').trim().toLowerCase() || null;
    if (color && !COLOR_RE.test(color)) throw new GameError('Couleur invalide (format #rrggbb).');
    icon = String(icon || '').trim() || null;
    if (icon && !ICONS.includes(icon)) throw new GameError('Icône inconnue.');
    if (!color && !icon) throw new GameError('Choisis une couleur, une icône, ou les deux.');
    const id = await MarkerService.resolve(worldId, type, targetId, target, playerId);
    const existing = await MapMarker.findOne({ where: { playerId, targetType: type, targetId: id } });
    if (existing) return existing.update({ color, icon });
    if (await MapMarker.count({ where: { playerId } }) >= MAX_MARKERS) throw new GameError(`${MAX_MARKERS} marquages au maximum.`);
    return MapMarker.create({ playerId, targetType: type, targetId: id, color, icon });
  }

  static async resolve(worldId, type, targetId, target, playerId = null) {
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
    } else if (type === 'group') {
      found = Number.isFinite(byId)
        ? await VillageGroup.findOne({ where: { id: byId, playerId }, attributes: ['id'] })
        : await VillageGroup.findOne({ where: { playerId, [Op.and]: [lower('name')] }, attributes: ['id'] });
    } else if (Number.isFinite(byId)) {
      found = await Village.findOne({ where: { id: byId, worldId }, attributes: ['id'] });
    } else {
      const m = /^\s*(\d+)\D+(\d+)\s*$/.exec(text);
      if (m) found = await Village.findOne({ where: { worldId, x: Number(m[1]), y: Number(m[2]) }, attributes: ['id'] });
    }
    if (!found) {
      throw new GameError({ player: 'Aucun joueur de ce nom.', tribe: 'Aucune tribu avec ce tag ou ce nom.', village: 'Aucun village à ces coordonnées.', group: 'Aucun de tes groupes de villages ne porte ce nom.' }[type]);
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
MarkerService.ICONS = ICONS;
MarkerService.MAX_MARKERS = MAX_MARKERS;

module.exports = MarkerService;
