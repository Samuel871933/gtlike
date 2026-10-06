'use strict';

const { Op } = require('sequelize');
const { Player, Village, VillageGroup, VillageGroupMember, MapMarker } = require('../models');
const GameError = require('./GameError');

const MAX_GROUPS = 50;
const NAME_MAX = 32;

/**
 * Groupes de villages d'un joueur, comme sur Guerre Tribale : un village peut être dans plusieurs groupes. Le groupe
 * actif (Player.villageGroupId) sert de contexte : il filtre les aperçus et le gestionnaire de compte, et les flèches
 * et la liste des villages de l'en-tête ne parcourent que ses villages.
 */
class VillageGroupService {
  /**
   * Groupes du joueur, par nom, avec leur nombre de villages.
   * @returns {Promise<{ id, name, count }[]>}
   */
  static async list(playerId) {
    const groups = await VillageGroup.findAll({ where: { playerId }, attributes: ['id', 'name'], order: [['name', 'ASC'], ['id', 'ASC']], raw: true });
    if (!groups.length) return [];
    const counts = await VillageGroupMember.count({ where: { groupId: groups.map((g) => g.id) }, group: ['groupId'] });
    const byGroup = new Map(counts.map((c) => [c.groupId, Number(c.count)]));
    return groups.map((g) => ({ ...g, count: byGroup.get(g.id) || 0 }));
  }

  /** Ids des villages d'un groupe du joueur (null : groupe inconnu ou d'un autre joueur). */
  static async villageIds(playerId, groupId) {
    const group = await VillageGroup.findOne({ where: { id: Number(groupId) || 0, playerId }, attributes: ['id'] });
    if (!group) return null;
    const rows = await VillageGroupMember.findAll({ where: { groupId: group.id }, attributes: ['villageId'], raw: true });
    return rows.map((r) => r.villageId);
  }

  /** Groupes de chaque village : Map villageId → [groupId, …]. */
  static async membership(playerId) {
    const rows = await VillageGroupMember.findAll({
      attributes: ['groupId', 'villageId'],
      include: [{ model: VillageGroup, attributes: [], where: { playerId } }],
      raw: true,
    });
    const out = new Map();
    for (const r of rows) {
      if (!out.has(r.villageId)) out.set(r.villageId, []);
      out.get(r.villageId).push(r.groupId);
    }
    return out;
  }

  /**
   * Contexte de groupe d'une page : groupes du joueur, groupe actif et ses villages. Un groupe actif disparu est oublié.
   * @returns {Promise<{ groups, active: object|null, ids: number[]|null }>} ids nul : tous les villages
   */
  static async context(player) {
    const groups = await VillageGroupService.list(player.id);
    const active = player.villageGroupId ? groups.find((g) => g.id === player.villageGroupId) || null : null;
    if (player.villageGroupId && !active) await Player.update({ villageGroupId: null }, { where: { id: player.id } });
    const ids = active ? await VillageGroupService.villageIds(player.id, active.id) : null;
    return { groups, active, ids };
  }

  /** Choisit le groupe actif ('' ou 0 : tous les villages). */
  static async select(playerId, groupId) {
    const id = Number(groupId) || null;
    if (id && !(await VillageGroup.count({ where: { id, playerId } }))) throw new GameError('Groupe introuvable.', 404);
    await Player.update({ villageGroupId: id }, { where: { id: playerId } });
    return id;
  }

  static cleanName(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    if (!clean) throw new GameError('Donne un nom au groupe.');
    if (clean.length > NAME_MAX) throw new GameError(`${NAME_MAX} caractères au plus pour le nom du groupe.`);
    return clean;
  }

  static async create(playerId, name) {
    const clean = VillageGroupService.cleanName(name);
    if (await VillageGroup.count({ where: { playerId } }) >= MAX_GROUPS) throw new GameError(`${MAX_GROUPS} groupes au maximum.`);
    if (await VillageGroup.count({ where: { playerId, name: clean } })) throw new GameError('Tu as déjà un groupe de ce nom.');
    return VillageGroup.create({ playerId, name: clean });
  }

  static async find(playerId, groupId) {
    const group = await VillageGroup.findOne({ where: { id: Number(groupId) || 0, playerId } });
    if (!group) throw new GameError('Groupe introuvable.', 404);
    return group;
  }

  static async rename(playerId, groupId, name) {
    const group = await VillageGroupService.find(playerId, groupId);
    const clean = VillageGroupService.cleanName(name);
    if (await VillageGroup.count({ where: { playerId, name: clean, id: { [Op.ne]: group.id } } })) throw new GameError('Tu as déjà un groupe de ce nom.');
    return group.update({ name: clean });
  }

  /** Supprime un groupe, ses marquages de carte, et l'oublie comme groupe actif. */
  static async remove(playerId, groupId) {
    const group = await VillageGroupService.find(playerId, groupId);
    await MapMarker.destroy({ where: { playerId, targetType: 'group', targetId: group.id } });
    await Player.update({ villageGroupId: null }, { where: { id: playerId, villageGroupId: group.id } });
    await group.destroy();
    return group;
  }

  /**
   * Grille de l'onglet Groupes : pour les villages affichés (`shown`), appartenances remplacées par les cases cochées
   * (`pairs` : « groupId:villageId »). Les villages pas encore chargés dans la page ne sont pas touchés.
   * @returns {Promise<{ id, count }[]>} nombre de villages de chaque groupe après l'enregistrement
   */
  static async setMatrix(playerId, shown, pairs) {
    const villages = await Village.findAll({ where: { id: [].concat(shown || []).map(Number).filter((n) => n > 0), playerId }, attributes: ['id'], raw: true });
    const vids = new Set(villages.map((v) => v.id));
    const gids = new Set((await VillageGroup.findAll({ where: { playerId }, attributes: ['id'], raw: true })).map((g) => g.id));
    const wanted = new Set([].concat(pairs || []).map(String).filter((p) => {
      const [g, v] = p.split(':').map(Number);
      return gids.has(g) && vids.has(v);
    }));
    if (vids.size && gids.size) {
      const current = await VillageGroupMember.findAll({ where: { villageId: [...vids], groupId: [...gids] }, attributes: ['id', 'groupId', 'villageId'], raw: true });
      const have = new Set(current.map((m) => `${m.groupId}:${m.villageId}`));
      const stale = current.filter((m) => !wanted.has(`${m.groupId}:${m.villageId}`)).map((m) => m.id);
      if (stale.length) await VillageGroupMember.destroy({ where: { id: stale } });
      const fresh = [...wanted].filter((p) => !have.has(p)).map((p) => p.split(':').map(Number));
      if (fresh.length) await VillageGroupMember.bulkCreate(fresh.map(([groupId, villageId]) => ({ groupId, villageId })));
    }
    return (await VillageGroupService.list(playerId)).map(({ id, count }) => ({ id, count }));
  }

  /** Groupes d'un village : remplace ses appartenances par `groupIds` (cases de l'aperçu du village). */
  static async setForVillage(playerId, villageId, groupIds) {
    const village = await Village.findOne({ where: { id: Number(villageId) || 0, playerId }, attributes: ['id'] });
    if (!village) throw new GameError('Village introuvable.', 404);
    const { id } = village;
    const groups = await VillageGroup.findAll({ where: { playerId }, attributes: ['id'], raw: true });
    const mine = groups.map((g) => g.id);
    const wanted = new Set([].concat(groupIds || []).map(Number).filter((g) => mine.includes(g)));
    await VillageGroupMember.destroy({ where: { villageId: id, groupId: mine.filter((g) => !wanted.has(g)) } });
    const current = new Set((await VillageGroupMember.findAll({ where: { villageId: id, groupId: mine }, attributes: ['groupId'], raw: true })).map((r) => r.groupId));
    const fresh = [...wanted].filter((g) => !current.has(g));
    if (fresh.length) await VillageGroupMember.bulkCreate(fresh.map((groupId) => ({ groupId, villageId: id })));
    return wanted.size;
  }
}

VillageGroupService.MAX_GROUPS = MAX_GROUPS;
VillageGroupService.NAME_MAX = NAME_MAX;

module.exports = VillageGroupService;
