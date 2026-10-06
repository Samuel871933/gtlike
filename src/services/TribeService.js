'use strict';

const { Op, fn, col } = require('sequelize');
const { sequelize, World, Player, Tribe, TribeInvite, TribeRelation, TribeEvent } = require('../models');
const GameError = require('./GameError');
const tribeRights = require('../game/tribeRights');
const TribeEventService = require('./TribeEventService');
const ImageService = require('./ImageService');
const { factionName } = require('../game/factions');

const { who } = TribeEventService;

const RELATIONS = ['ally', 'nap', 'enemy'];
const TAG_RE = /^[A-Za-z0-9_\-.!?]{1,6}$/;
// Rang des titres : un baron ne gère ni les ducs ni les autres barons.
const RANK = { duke: 3, baron: 2, member: 1 };

const DENIED = {
  duke: 'Réservé aux ducs de la tribu.',
  baron: 'Réservé aux ducs et barons de la tribu.',
  invite: "Il faut le droit d'inviter.",
  diplomacy: 'Il faut le droit de diplomatie.',
  massMail: 'Il faut le droit de courrier circulaire.',
  forumMod: 'Il faut le droit de modérateur du forum.',
  hiddenForum: 'Il faut le droit Forum caché.',
};

class TribeService {
  /** Le joueur a-t-il ce pouvoir dans sa tribu (voir game/tribeRights.js) ? */
  static can(player, right) {
    return tribeRights.has(player, right);
  }

  static async lockPlayer(playerId, t) {
    const player = await Player.findByPk(playerId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!player) throw new GameError('Joueur introuvable.', 404);
    return player;
  }

  static async requireRight(playerId, right, t) {
    const player = await TribeService.lockPlayer(playerId, t);
    if (!player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.");
    if (!tribeRights.has(player, right)) throw new GameError(DENIED[right], 403);
    return player;
  }

  static async memberLimit(worldId, t) {
    const world = await World.findByPk(worldId, { transaction: t });
    return world.getConfig().tribe.memberLimit;
  }

  /** Monde à factions : une tribu n'accueille que les joueurs de sa faction. */
  static checkFaction(tribe, player) {
    if (tribe && tribe.faction && tribe.faction !== player.faction) {
      throw new GameError(`Cette tribu est réservée à la faction des ${factionName(tribe.faction).toLowerCase()}.`);
    }
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
      // Monde à factions : la tribu prend la faction de son fondateur.
      const tribe = await Tribe.create({ worldId: player.worldId, name, tag, faction: player.faction || null }, { transaction: t });
      await player.update({ tribeId: tribe.id, tribeRole: 'duke', tribeRights: null, tribeJoinedAt: new Date() }, { transaction: t });
      await TribeInvite.destroy({ where: { playerId }, transaction: t });
      // Forum de la tribu : Annonces, Attaque, Défense, Taverne, Vacances, Suggestions.
      await require('./TribeForumService').createDefaults(tribe.id, t);
      await TribeEventService.log(tribe.id, 'founded', { actor: who(player) }, { t });
      return tribe;
    });
  }

  static async invite(managerId, playerName) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireRight(managerId, 'invite', t);
      const target = await Player.findOne({ where: { worldId: manager.worldId, name: String(playerName || '').trim() }, transaction: t });
      if (!target) throw new GameError('Aucun joueur de ce nom sur ce monde.');
      if (target.isBot) throw new GameError('Les bots ne rejoignent pas de tribu.');
      if (target.tribeId === manager.tribeId) throw new GameError('Ce joueur est déjà dans la tribu.');
      const tribe = await Tribe.findByPk(manager.tribeId, { attributes: ['faction'], transaction: t });
      TribeService.checkFaction(tribe, target);
      const [, created] = await TribeInvite.findOrCreate({
        where: { tribeId: manager.tribeId, playerId: target.id }, transaction: t,
      });
      if (!created) throw new GameError('Ce joueur est déjà invité.');
      await TribeEventService.log(manager.tribeId, 'invited', { actor: who(manager), target: who(target) }, { t });
      return target;
    });
  }

  static async cancelInvite(managerId, inviteId) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireRight(managerId, 'invite', t);
      const invite = await TribeInvite.findOne({ where: { id: Number(inviteId), tribeId: manager.tribeId }, include: [Player], transaction: t });
      if (!invite) throw new GameError('Invitation introuvable.', 404);
      await invite.destroy({ transaction: t });
      await TribeEventService.log(manager.tribeId, 'inviteCancelled', { actor: who(manager), target: who(invite.Player) }, { t });
    });
  }

  static async acceptInvite(playerId, inviteId) {
    return sequelize.transaction(async (t) => {
      const player = await TribeService.lockPlayer(playerId, t);
      const invite = await TribeInvite.findOne({ where: { id: Number(inviteId), playerId }, transaction: t });
      if (!invite) throw new GameError('Invitation introuvable.', 404);
      if (player.tribeId) throw new GameError("Quittez d'abord votre tribu actuelle.");
      TribeService.checkFaction(await Tribe.findByPk(invite.tribeId, { attributes: ['faction'], transaction: t }), player);
      const members = await Player.count({ where: { tribeId: invite.tribeId }, transaction: t });
      if (members >= (await TribeService.memberLimit(player.worldId, t))) throw new GameError('Cette tribu est complète.');
      await player.update({ tribeId: invite.tribeId, tribeRole: 'member', tribeRights: null, tribeJoinedAt: new Date() }, { transaction: t });
      await TribeInvite.destroy({ where: { playerId }, transaction: t });
      await TribeEventService.log(invite.tribeId, 'joined', { actor: who(player) }, { t });
    });
  }

  static async declineInvite(playerId, inviteId) {
    return sequelize.transaction(async (t) => {
      const invite = await TribeInvite.findOne({ where: { id: Number(inviteId), playerId }, include: [Player], transaction: t });
      if (!invite) throw new GameError('Invitation introuvable.', 404);
      await invite.destroy({ transaction: t });
      await TribeEventService.log(invite.tribeId, 'inviteDeclined', { actor: who(invite.Player) }, { t });
    });
  }

  /** Quitter la tribu. Le dernier duc doit d'abord nommer un autre duc, sauf s'il est seul (la tribu est dissoute). */
  static async leave(playerId) {
    return sequelize.transaction(async (t) => {
      const player = await TribeService.lockPlayer(playerId, t);
      if (!player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.");
      const tribeId = player.tribeId;
      const others = await Player.count({ where: { tribeId, id: { [Op.ne]: player.id } }, transaction: t });
      if (player.tribeRole === 'duke' && others > 0) {
        const dukes = await Player.count({ where: { tribeId, tribeRole: 'duke', id: { [Op.ne]: player.id } }, transaction: t });
        if (!dukes) throw new GameError('Nommez un autre duc avant de partir.');
      }
      await player.update({ tribeId: null, tribeRole: null, tribeRights: null, tribeJoinedAt: null }, { transaction: t });
      if (others === 0) await TribeService.dissolve(tribeId, t);
      else await TribeEventService.log(tribeId, 'left', { actor: who(player) }, { t });
    });
  }

  static async dissolve(tribeId, t) {
    const gone = await Tribe.findByPk(tribeId, { attributes: ['avatar'], transaction: t });
    if (gone?.avatar) t.afterCommit(() => ImageService.remove(gone.avatar));
    await TribeRelation.destroy({ where: { [Op.or]: [{ tribeId }, { otherTribeId: tribeId }] }, transaction: t });
    // Chargé ici : TribeForumService dépend lui-même de TribeService.
    await require('./TribeForumService').destroyTribe(tribeId, t);
    await TribeInvite.destroy({ where: { tribeId }, transaction: t });
    await TribeEvent.destroy({ where: { tribeId }, transaction: t });
    await Tribe.destroy({ where: { id: tribeId }, transaction: t });
  }

  // ---------------------------------------------------------------- Gestion des membres

  static async kick(managerId, memberId) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireRight(managerId, 'baron', t);
      const member = await Player.findOne({ where: { id: Number(memberId), tribeId: manager.tribeId }, transaction: t });
      if (!member) throw new GameError('Membre introuvable.', 404);
      if (member.id === manager.id) throw new GameError('Utilisez « Quitter la tribu ».');
      if (!TribeService.canEdit(manager, member)) throw new GameError('Vous ne pouvez pas renvoyer ce membre.', 403);
      await member.update({ tribeId: null, tribeRole: null, tribeRights: null, tribeJoinedAt: null }, { transaction: t });
      await TribeEventService.log(manager.tribeId, 'kicked', { actor: who(manager), target: who(member) }, { t });
    });
  }

  /** `manager` peut-il changer les droits de `member` ou le renvoyer ? Un duc gère tout le monde sauf les ducs, un baron les membres. */
  static canEdit(manager, member) {
    if (manager.id === member.id || !tribeRights.has(manager, 'baron')) return false;
    return RANK[member.tribeRole] < RANK[manager.tribeRole];
  }

  /**
   * Titres et pouvoirs d'un membre (page Membres, comme l'onglet « Droits » de GT) : `title` duke | baron | member,
   * `rights` les droits cochés (ignorés pour un duc ou un baron, qui les ont tous). Seul un duc nomme ducs et barons ;
   * un duc qui nomme un autre duc le fait sans perdre son titre (plusieurs ducs possibles).
   */
  static async setRights(managerId, memberId, { title, rights } = {}) {
    return TribeService.setAllRights(managerId, [{ memberId, title, rights }]);
  }

  /**
   * Droits de plusieurs membres d'un coup (onglet « Droits » : un seul bouton Enregistrer) : [{ memberId, title,
   * rights }]. Tout ou rien ; seuls les membres dont le titre ou les droits changent sont modifiés (et journalisés).
   */
  static async setAllRights(managerId, entries = []) {
    for (const { title } of entries) if (!RANK[title]) throw new GameError('Titre inconnu.');
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireRight(managerId, 'baron', t);
      let changed = 0;
      for (const { memberId, title, rights } of entries) {
        const member = await Player.findOne({ where: { id: Number(memberId), tribeId: manager.tribeId }, transaction: t, lock: t.LOCK.UPDATE });
        if (!member) throw new GameError('Membre introuvable.', 404);
        const next = title === 'member' ? tribeRights.clean(rights) : null;
        // Inchangé : même titre et, pour un simple membre, mêmes droits.
        const same = member.tribeRole === title && (title !== 'member' || tribeRights.clean(member.tribeRights).join() === next.join());
        if (same) continue;
        if (!TribeService.canEdit(manager, member)) throw new GameError('Vous ne pouvez pas modifier les droits de ce membre.', 403);
        if (title !== 'member' && manager.tribeRole !== 'duke') throw new GameError(DENIED.duke, 403);
        await member.update({ tribeRole: title, tribeRights: next }, { transaction: t });
        await TribeEventService.log(manager.tribeId, 'rights', { actor: who(manager), target: who(member), title: tribeRights.label(member) }, { t });
        changed++;
      }
      return changed;
    });
  }

  static async updateDescription(managerId, description) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireRight(managerId, 'diplomacy', t);
      await Tribe.update({ description: String(description || '').slice(0, 5000) }, { where: { id: manager.tribeId }, transaction: t });
      await TribeEventService.log(manager.tribeId, 'profile', { actor: who(manager) }, { t });
    });
  }

  /** Image du profil public (comme la description, il faut le droit de diplomatie) ; sans `buffer`, la retire. */
  static async updateAvatar(managerId, buffer) {
    const manager = await sequelize.transaction((t) => TribeService.requireRight(managerId, 'diplomacy', t));
    const tribe = await Tribe.findByPk(manager.tribeId, { attributes: ['id', 'avatar'] });
    if (!tribe) throw new GameError('Tribu introuvable.', 404);
    await ImageService.replaceAvatar(tribe, 'tribe', buffer);
    await TribeEventService.log(tribe.id, 'profile', { actor: who(manager) });
  }

  /** Annonces internes (encadré de l'aperçu), modifiables par les ducs et barons, comme les « administrateurs » de GT. */
  static async updateAnnouncement(managerId, text) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireRight(managerId, 'baron', t);
      const value = String(text || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
      await Tribe.update({ announcement: value || null }, { where: { id: manager.tribeId }, transaction: t });
      await TribeEventService.log(manager.tribeId, 'announcement', { actor: who(manager) }, { t });
    });
  }

  // ---------------------------------------------------------------- Diplomatie

  static async setRelation(managerId, otherTag, type) {
    if (!RELATIONS.includes(type)) throw new GameError('Relation inconnue.');
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireRight(managerId, 'diplomacy', t);
      const other = await Tribe.findOne({ where: { worldId: manager.worldId, tag: String(otherTag || '').trim() }, transaction: t });
      if (!other) throw new GameError('Aucune tribu avec ce tag.');
      if (other.id === manager.tribeId) throw new GameError('Choisissez une autre tribu.');
      const [rel, created] = await TribeRelation.findOrCreate({
        where: { tribeId: manager.tribeId, otherTribeId: other.id }, defaults: { type }, transaction: t,
      });
      if (!created) await rel.update({ type }, { transaction: t });
      await TribeEventService.log(manager.tribeId, 'relation', { actor: who(manager), tribe: TribeEventService.tribe(other), relation: type }, { t });
    });
  }

  static async removeRelation(managerId, relationId) {
    return sequelize.transaction(async (t) => {
      const manager = await TribeService.requireRight(managerId, 'diplomacy', t);
      const rel = await TribeRelation.findOne({ where: { id: Number(relationId), tribeId: manager.tribeId }, include: [{ association: 'other' }], transaction: t });
      if (!rel) throw new GameError('Relation introuvable.', 404);
      await rel.destroy({ transaction: t });
      await TribeEventService.log(manager.tribeId, 'relationRemoved', { actor: who(manager), tribe: TribeEventService.tribe(rel.other) }, { t });
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

  // ---------------------------------------------------------------- Lecture

  /** Données du profil public : aucune relation diplomatique ni annonce interne. */
  static async profile(tribeId) {
    const tribe = await Tribe.findByPk(Number(tribeId), { attributes: ['id', 'worldId', 'name', 'tag', 'description', 'avatar', 'faction'] });
    if (!tribe) throw new GameError('Tribu introuvable.', 404);
    const members = await Player.findAll({ where: { tribeId: tribe.id }, order: [['points', 'DESC'], ['id', 'ASC']] });
    return {
      tribe, members,
      points: members.reduce((n, m) => n + m.points, 0),
      villages: members.reduce((n, m) => n + m.villageCount, 0),
    };
  }

  static async dashboard(player) {
    if (!player || !player.tribeId) throw new GameError("Vous n'êtes dans aucune tribu.", 403);
    const member = await Player.findOne({ where: { id: player.id, tribeId: player.tribeId }, attributes: ['id'] });
    if (!member) throw new GameError("Vous n'êtes pas membre de cette tribu.", 403);
    const base = await TribeService.profile(player.tribeId);
    const [tribe, relations, invites] = await Promise.all([
      Tribe.findByPk(player.tribeId),
      TribeRelation.findAll({ where: { tribeId: player.tribeId }, include: [{ association: 'other' }], order: [['type', 'ASC']] }),
      TribeInvite.findAll({ where: { tribeId: player.tribeId }, include: [Player] }),
    ]);
    return { ...base, tribe, relations, invites };
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

TribeService.RANK = RANK;
TribeService.RELATIONS = RELATIONS;

module.exports = TribeService;
