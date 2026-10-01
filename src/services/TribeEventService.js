'use strict';

const { Op } = require('sequelize');
const { TribeEvent, Player } = require('../models');
const { paginate } = require('./PaginationService');
const { continent } = require('../game/MapPlacer');

// Catégories du fil (filtres « Anoblissements, Diplomatie, Membres, Divers » de GT) et type → catégorie.
const CATEGORIES = { noble: 'Anoblissements', diplomacy: 'Diplomatie', members: 'Membres', misc: 'Divers' };
const TYPES = {
  conquered: 'noble', lost: 'noble',
  relation: 'diplomacy', relationRemoved: 'diplomacy',
  joined: 'members', invited: 'members', inviteCancelled: 'members', inviteDeclined: 'members',
  left: 'members', kicked: 'members', rights: 'members', quitWorld: 'members',
  founded: 'misc', profile: 'misc', announcement: 'misc',
};
const PAGE_SIZE = 20;

/** Joueur, village ou tribu tels qu'affichés dans le fil (les noms restent ceux du moment). */
const who = (p) => (p ? { id: p.id, name: p.name } : null);
const place = (v) => (v ? { id: v.id, name: v.name, x: v.x, y: v.y, k: continent(v.x, v.y) } : null);
const tribe = (tr) => (tr ? { id: tr.id, tag: tr.tag, name: tr.name } : null);

class TribeEventService {
  /** Ajoute un événement au fil d'une tribu. */
  static async log(tribeId, type, data, { at = new Date(), t } = {}) {
    if (!tribeId) return null;
    if (!TYPES[type]) throw new Error(`Événement de tribu inconnu : ${type}`);
    return TribeEvent.create({ tribeId, type, category: TYPES[type], data, happenedAt: at }, { transaction: t });
  }

  /** Village conquis : dans le fil de la tribu du conquérant et, s'il en a une, de celle du joueur qui l'a perdu. */
  static async conquest({ village, winner, loser, at, t }) {
    const data = { actor: who(winner), target: who(loser), village: place(village) };
    if (winner && winner.tribeId) await TribeEventService.log(winner.tribeId, 'conquered', data, { at, t });
    if (loser && loser.tribeId && loser.tribeId !== (winner && winner.tribeId)) await TribeEventService.log(loser.tribeId, 'lost', data, { at, t });
  }

  /** Page du fil, du plus récent au plus ancien ; `category` : une clé de CATEGORIES, sinon tout. */
  static async list(tribeId, { category, page = 1 } = {}) {
    const where = { tribeId, ...(CATEGORIES[category] ? { category } : {}) };
    const total = await TribeEvent.count({ where });
    const { page: current, pages, offset } = paginate(total, page, PAGE_SIZE);
    const events = await TribeEvent.findAll({
      where, order: [['happenedAt', 'DESC'], ['id', 'DESC']], limit: PAGE_SIZE, offset,
    });
    // Joueur à l'origine de chaque événement (sinon celui qu'il concerne), avec son image de profil actuelle.
    const who = (e) => (e.data && ((e.data.actor && e.data.actor.id) || (e.data.target && e.data.target.id))) || null;
    const ids = [...new Set(events.map(who).filter(Boolean))];
    const players = ids.length ? await Player.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name', 'avatar'] }) : [];
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const e of events) e.player = byId.get(who(e)) || null;
    return { events, page: current, pages, total, category: CATEGORIES[category] ? category : 'all' };
  }
}

TribeEventService.CATEGORIES = CATEGORIES;
TribeEventService.who = who;
TribeEventService.place = place;
TribeEventService.tribe = tribe;

module.exports = TribeEventService;
