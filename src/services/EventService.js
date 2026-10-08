'use strict';

const { Op, QueryTypes } = require('sequelize');
const { sequelize, Command, Transport, Village } = require('../models');
const CommandService = require('./CommandService');
const TradeService = require('./TradeService');

/**
 * Traite toutes les arrivées échues (troupes et marchands) dans un seul ordre chronologique :
 * une livraison arrivée juste avant une attaque peut être pillée.
 */
// File d'attente des traitements de chaque monde dans ce processus (pages et boucle de jeu) : les mondes n'interagissent
// jamais, chacun suit son propre ordre chronologique. Chacun passe dans l'ordre d'arrivée (FIFO) : la boucle de jeu
// se remet en queue après chaque tranche au lieu de garder la main sur tout un arriéré.
const lanes = new Map();
async function inLane(lane, fn, { wait = true } = {}) {
  const before = lanes.get(lane) || Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  const tail = before.then(() => mine);
  lanes.set(lane, tail);
  await before;
  try {
    return await acrossProcesses(lane, fn, wait);
  } finally {
    release();
    if (lanes.get(lane) === tail) lanes.delete(lane);
  }
}

// Entre processus (boucle de jeu à part, plusieurs processus web) : verrou nommé de MySQL / MariaDB, pris sur une
// connexion réservée le temps de la tranche. Sans lui, les processus se disputeraient la même arrivée en tête de
// file (verrou de ligne), chacun attendant l'autre. `wait` faux : rien si un autre processus traite déjà ce monde.
// Délai d'attente du verrou (s) pour la boucle de jeu ; au-delà, elle réessaie au tour suivant.
const LOCK_WAIT_S = 10;
async function acrossProcesses(lane, fn, wait) {
  if (sequelize.getDialect() !== 'mysql') return fn();
  const name = `adarma:events:${lane}`;
  return sequelize.transaction(async (t) => {
    const [{ ok }] = await sequelize.query('SELECT GET_LOCK(?, ?) AS ok', { replacements: [name, wait ? LOCK_WAIT_S : 0], type: QueryTypes.SELECT, transaction: t });
    if (Number(ok) !== 1) return 0;
    try {
      return await fn();
    } finally {
      await sequelize.query('SELECT RELEASE_LOCK(?)', { replacements: [name], type: QueryTypes.SELECT, transaction: t });
    }
  });
}
// Arrivées traitées d'affilée avant de laisser passer une page qui attend le même monde.
const CHUNK = 50;
// SQLite (tests, développement) n'a qu'une connexion, une transaction à la fois : une seule file pour tous les mondes.
const laneOf = (worldId) => (sequelize.getDialect() === 'sqlite' ? 'all' : worldId);

class EventService {
  /**
   * Arrivées échues d'un monde (`worldId`), ou de tous les mondes qui en ont, traités en parallèle.
   * Un seul traitement à la fois par monde : les pages qui arrivent pendant un traitement l'attendent au lieu de se
   * disputer les verrous des mêmes ordres, puis traitent ce qui reste jusqu'à leur propre instant (souvent rien).
   */
  static async processDue(now = new Date(), { worldId = null, ...options } = {}) {
    const worlds = worldId ? [worldId] : await EventService.worldsDue(now);
    const counts = await Promise.all(worlds.map((id) => EventService.processWorld(id, now, options)));
    return counts.reduce((n, c) => n + c, 0);
  }

  /** Mondes qui ont au moins une arrivée échue (troupes ou marchands). */
  static async worldsDue(now) {
    const due = { where: { arrivesAt: { [Op.lte]: now } }, attributes: ['worldId'], group: ['worldId'], raw: true };
    const [cmds, trs] = await Promise.all([Command.findAll(due), Transport.findAll(due)]);
    return [...new Set([...cmds, ...trs].map((r) => r.worldId))];
  }

  /**
   * Arrivées d'un monde par tranches de CHUNK, la file du monde relâchée entre deux : une page qui attend son tour
   * n'attend qu'une tranche, pas tout un arriéré. `max` : arrivées traitées au plus (une page : une tranche).
   */
  static async processWorld(worldId, now, { max = 500, ifIdle = false, ...options } = {}) {
    const lane = laneOf(worldId);
    // `ifIdle` (pages) : rien si un traitement de ce monde est déjà en cours ou attendu ; il résorbe ce qui est échu, et la
    // page s'affiche aussitôt au lieu de faire la queue derrière tout un arriéré.
    if (ifIdle && lanes.has(lane)) return 0;
    let done = 0;
    while (done < max) {
      const limit = Math.min(CHUNK, max - done);
      const n = await inLane(lane, () => EventService.run(now, { ...options, worldId, max: limit }), { wait: !ifIdle });
      done += n;
      if (n < limit) break; // plus rien d'échu
    }
    return done;
  }

  /**
   * Une arrivée échue (troupes ou marchands) part-elle de l'un des villages du joueur ou y arrive-t-elle ? Lecture
   * sans verrou ni attente : une page n'attend le traitement global que si ce qu'elle affiche en dépend.
   */
  static async dueFor(playerId, now = new Date()) {
    const ids = (await Village.findAll({ where: { playerId }, attributes: ['id'], raw: true })).map((v) => v.id);
    if (!ids.length) return false;
    const where = { arrivesAt: { [Op.lte]: now }, [Op.or]: [{ originVillageId: { [Op.in]: ids } }, { targetVillageId: { [Op.in]: ids } }] };
    const [cmd, tr] = await Promise.all([
      Command.findOne({ where, attributes: ['id'], raw: true }),
      Transport.findOne({ where, attributes: ['id'], raw: true }),
    ]);
    return Boolean(cmd || tr);
  }

  static async run(now, { rng = Math.random, max = 500, worldId } = {}) {
    const due = { where: { worldId, arrivesAt: { [Op.lte]: now } }, order: [['arrivesAt', 'ASC'], ['id', 'ASC']], attributes: ['id', 'arrivesAt'] };
    let processed = 0;
    while (processed < max) {
      const [cmd, tr] = await Promise.all([Command.findOne(due), Transport.findOne(due)]);
      if (!cmd && !tr) break;
      if (tr && (!cmd || new Date(tr.arrivesAt) <= new Date(cmd.arrivesAt))) await TradeService.process(tr.id);
      else await CommandService.process(cmd.id, { rng });
      processed++;
    }
    return processed;
  }
}

EventService.CHUNK = CHUNK;

module.exports = EventService;
