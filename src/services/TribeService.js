'use strict';

const { Op, fn, col } = require('sequelize');
const { sequelize, World, Player, Tribe, TribeInvite, TribeRelation, TribeMessage } = require('../models');
const GameError = require('./GameError');

const ROLES = { founder: 3, leader: 2, member: 1 };
const RELATIONS = ['ally', 'nap', 'enemy'];
const TAG_RE = /^[A-Za-z0-9_\-.!?]{1,6}$/;

function canManage(player) {
  return ROLES[player.tribeRole] >= ROLES.leader;
}

class TribeService {
  static canManage(player) {
    return canManage(player);
  }

  static async lockPlayer(playerId, t) {
    const player = await Player.findByPk(playerId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!player) throw new GameError('Joueur introuvable.', 404);
    return player;
  }

  static async requireManager(playerId, t) {
    const player = await TribeService.lockPlayer(playerId, t);
    if (!player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.");
    if (!canManage(player)) throw new GameError('Réservé aux chefs de la tribu.', 403);
    return player;
  }

  static async memberLimit(worldId, t) {
    const world = await World.findByPk(worldId, { transaction: t });
    return world.getConfig().tribe.memberLimit;
  }

  // ---------------------------------------------------------------- Création et adhésion

  static async create(playerId, { name, tag }) {
    name = String(name || '').trim();
    tag = String(tag || '').trim();
    if (name.length < 3 || name.length > 32) throw new GameError('Le nom doit faire 3 à 32 caractères.');
    if (!TAG_RE.test(tag)) throw new GameError('Le tag doit faire 1 à 6 caractères (lettres, chiffres, _ - . ! ?).');
    return sequelize.transaction(async (t) => {
      const player = await TribeService.lockPlayer(playerId, t);
      if (player.tribeId) throw new GameError('Vous êtes déjà dans une tribu.');
      const taken = await Tribe.findOne({ where: { worldId: player.worldId, [Op.or]: [{ name }, { tag }] }, transaction: t });
      if (taken) throw new GameError(taken.tag === tag ? 'Ce tag est déjà pris.' : 'Ce nom est déjà pris.');
      const tribe = await Tribe.create({ worldId: player.worldId, name, tag }, { transaction: t });
      await player.update({ tribeId: tribe.id, tribeRole: 'founder', tribeJoinedAt: new Date() }, { transaction: t });
      await TribeInvite.destroy({ where: { playerId }, transaction: t });
      // Forum de la tribu : Annonces, Attaque, Défense, Taverne, Vacances, Suggestions.
      await require('./TribeForumService').createDefaults(tribe.id, t);
      return tribe;
    });
  }

  static async invite(managerId, playerName) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireManager(managerId, t);
      const target = await Player.findOne({ where: { worldId: manager.worldId, name: String(playerName || '').trim() }, transaction: t });
      if (!target) throw new GameError('Aucun joueur de ce nom sur ce monde.');
      if (target.tribeId === manager.tribeId) throw new GameError('Ce joueur est déjà dans la tribu.');
      const [, created] = await TribeInvite.findOrCreate({
        where: { tribeId: manager.tribeId, playerId: target.id }, transaction: t,
      });
      if (!created) throw new GameError('Ce joueur est déjà invité.');
      return target;
    });
  }

  static async cancelInvite(managerId, inviteId) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireManager(managerId, t);
      const n = await TribeInvite.destroy({ where: { id: Number(inviteId), tribeId: manager.tribeId }, transaction: t });
      if (!n) throw new GameError('Invitation introuvable.', 404);
    });
  }

  static async acceptInvite(playerId, inviteId) {
    return sequelize.transaction(async (t) => {
      const player = await TribeService.lockPlayer(playerId, t);
      const invite = await TribeInvite.findOne({ where: { id: Number(inviteId), playerId }, transaction: t });
      if (!invite) throw new GameError('Invitation introuvable.', 404);
      if (player.tribeId) throw new GameError("Quittez d'abord votre tribu actuelle.");
      const members = await Player.count({ where: { tribeId: invite.tribeId }, transaction: t });
      if (members >= (await TribeService.memberLimit(player.worldId, t))) throw new GameError('Cette tribu est complète.');
      await player.update({ tribeId: invite.tribeId, tribeRole: 'member', tribeJoinedAt: new Date() }, { transaction: t });
      await TribeInvite.destroy({ where: { playerId }, transaction: t });
    });
  }

  static async declineInvite(playerId, inviteId) {
    const n = await TribeInvite.destroy({ where: { id: Number(inviteId), playerId } });
    if (!n) throw new GameError('Invitation introuvable.', 404);
  }

  /** Quitter la tribu. Le fondateur doit d'abord passer la main, sauf s'il est seul (la tribu est dissoute). */
  static async leave(playerId) {
    return sequelize.transaction(async (t) => {
      const player = await TribeService.lockPlayer(playerId, t);
      if (!player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.");
      const tribeId = player.tribeId;
      const others = await Player.count({ where: { tribeId, id: { [Op.ne]: player.id } }, transaction: t });
      if (player.tribeRole === 'founder' && others > 0) {
        throw new GameError('Nommez un autre fondateur avant de partir.');
      }
      await player.update({ tribeId: null, tribeRole: null, tribeJoinedAt: null }, { transaction: t });
      if (others === 0) await TribeService.dissolve(tribeId, t);
    });
  }

  static async dissolve(tribeId, t) {
    await TribeRelation.destroy({ where: { [Op.or]: [{ tribeId }, { otherTribeId: tribeId }] }, transaction: t });
    await TribeMessage.destroy({ where: { tribeId }, transaction: t });
    // Chargé ici : TribeForumService dépend lui-même de TribeService.
    await require('./TribeForumService').destroyTribe(tribeId, t);
    await TribeInvite.destroy({ where: { tribeId }, transaction: t });
    await Tribe.destroy({ where: { id: tribeId }, transaction: t });
  }

  // ---------------------------------------------------------------- Gestion des membres

  static async kick(managerId, memberId) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireManager(managerId, t);
      const member = await Player.findOne({ where: { id: Number(memberId), tribeId: manager.tribeId }, transaction: t });
      if (!member) throw new GameError('Membre introuvable.', 404);
      if (member.id === manager.id) throw new GameError('Utilisez « Quitter la tribu ».');
      if (ROLES[member.tribeRole] >= ROLES[manager.tribeRole]) throw new GameError('Vous ne pouvez pas exclure ce membre.', 403);
      await member.update({ tribeId: null, tribeRole: null, tribeJoinedAt: null }, { transaction: t });
    });
  }

  /** Changement de rôle, réservé au fondateur. Nommer un fondateur lui passe la main. */
  static async setRole(founderId, memberId, role) {
    if (!ROLES[role]) throw new GameError('Rôle inconnu.');
    return sequelize.transaction(async (t) => {
      const founder = await TribeService.lockPlayer(founderId, t);
      if (founder.tribeRole !== 'founder') throw new GameError('Réservé au fondateur.', 403);
      const member = await Player.findOne({ where: { id: Number(memberId), tribeId: founder.tribeId }, transaction: t });
      if (!member || member.id === founder.id) throw new GameError('Membre introuvable.', 404);
      await member.update({ tribeRole: role }, { transaction: t });
      if (role === 'founder') await founder.update({ tribeRole: 'leader' }, { transaction: t });
    });
  }

  static async updateDescription(managerId, description) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireManager(managerId, t);
      await Tribe.update({ description: String(description || '').slice(0, 5000) }, { where: { id: manager.tribeId }, transaction: t });
    });
  }

  // ---------------------------------------------------------------- Diplomatie

  static async setRelation(managerId, otherTag, type) {
    if (!RELATIONS.includes(type)) throw new GameError('Relation inconnue.');
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireManager(managerId, t);
      const other = await Tribe.findOne({ where: { worldId: manager.worldId, tag: String(otherTag || '').trim() }, transaction: t });
      if (!other) throw new GameError('Aucune tribu avec ce tag.');
      if (other.id === manager.tribeId) throw new GameError('Choisissez une autre tribu.');
      const [rel, created] = await TribeRelation.findOrCreate({
        where: { tribeId: manager.tribeId, otherTribeId: other.id }, defaults: { type }, transaction: t,
      });
      if (!created) await rel.update({ type }, { transaction: t });
    });
  }

  static async removeRelation(managerId, relationId) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireManager(managerId, t);
      const n = await TribeRelation.destroy({ where: { id: Number(relationId), tribeId: manager.tribeId }, transaction: t });
      if (!n) throw new GameError('Relation introuvable.', 404);
    });
  }

  /** Relation vue depuis la tribu du joueur : own | ally | nap | enemy | null. */
  static async relationsOf(tribeId) {
    const map = new Map();
    if (!tribeId) return map;
    map.set(tribeId, 'own');
    const rels = await TribeRelation.findAll({ where: { tribeId } });
    for (const r of rels) map.set(r.otherTribeId, r.type);
    return map;
  }

  // ---------------------------------------------------------------- Mur de la tribu

  static async post(playerId, body) {
    const text = String(body || '').trim();
    if (!text) throw new GameError('Message vide.');
    if (text.length > 2000) throw new GameError('Message trop long (2 000 caractères maximum).');
    const player = await Player.findByPk(playerId);
    if (!player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.");
    return TribeMessage.create({ tribeId: player.tribeId, playerId, body: text });
  }

  static async deleteMessage(playerId, messageId) {
    const player = await Player.findByPk(playerId);
    const msg = await TribeMessage.findOne({ where: { id: Number(messageId), tribeId: player.tribeId } });
    if (!msg) throw new GameError('Message introuvable.', 404);
    if (msg.playerId !== player.id && !canManage(player)) throw new GameError('Vous ne pouvez pas supprimer ce message.', 403);
    await msg.destroy();
  }

  // ---------------------------------------------------------------- Lecture

  static async profile(tribeId) {
    const tribe = await Tribe.findByPk(Number(tribeId));
    if (!tribe) throw new GameError('Tribu introuvable.', 404);
    const members = await Player.findAll({ where: { tribeId: tribe.id }, order: [['points', 'DESC'], ['id', 'ASC']] });
    const relations = await TribeRelation.findAll({ where: { tribeId: tribe.id }, include: [{ association: 'other' }], order: [['type', 'ASC']] });
    return {
      tribe, members, relations,
      points: members.reduce((n, m) => n + m.points, 0),
      villages: members.reduce((n, m) => n + m.villageCount, 0),
    };
  }

  static async dashboard(player) {
    const base = await TribeService.profile(player.tribeId);
    const [invites, messages] = await Promise.all([
      TribeInvite.findAll({ where: { tribeId: player.tribeId }, include: [Player] }),
      TribeMessage.findAll({ where: { tribeId: player.tribeId }, include: [Player], order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 50 }),
    ]);
    return { ...base, invites, messages };
  }

  static async invitesFor(playerId) {
    return TribeInvite.findAll({ where: { playerId }, include: [Tribe] });
  }

  /** Classement des tribus par points totaux des membres. */
  static async ranking(worldId, limit = 100) {
    const rows = await Player.findAll({
      where: { worldId, tribeId: { [Op.ne]: null } },
      attributes: ['tribeId', [fn('SUM', col('points')), 'points'], [fn('SUM', col('villageCount')), 'villages'], [fn('COUNT', col('id')), 'members']],
      group: ['tribeId'],
      raw: true,
    });
    const tribes = await Tribe.findAll({ where: { id: { [Op.in]: rows.map((r) => r.tribeId) } } });
    const byId = new Map(tribes.map((t) => [t.id, t]));
    return rows
      .map((r) => ({ tribe: byId.get(r.tribeId), points: Number(r.points), villages: Number(r.villages), members: Number(r.members) }))
      .filter((r) => r.tribe)
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
  }
}

TribeService.ROLES = ROLES;
TribeService.RELATIONS = RELATIONS;

module.exports = TribeService;
