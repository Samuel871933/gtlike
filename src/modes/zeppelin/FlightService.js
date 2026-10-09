'use strict';

// Vols des vaisseaux (mode Zeppelin). Seule règle ajoutée au moteur de base : un village peut changer de case.
// Pendant le vol, le village reste à sa case de départ pour tout le moteur (distances, ordres qui le visent, carte) ;
// il prend sa nouvelle case à l'atterrissage. Durée : distance × minutes par case du vaisseau, divisées par la vitesse
// du monde et des unités, exactement comme une troupe (movement.travelSeconds), arrivée arrondie comme les ordres.

const { Op } = require('sequelize');
const { sequelize, Village, Player, ShipFlight } = require('../../models');
const GameError = require('../../services/GameError');
const VillageService = require('../../services/VillageService');
const movement = require('../../game/movement');
const terrain = require('../../game/terrain');

/** Durée d'un vol (secondes) entre deux cases. */
function flightSeconds(from, to, cfg) {
  const minutesPerField = cfg.zeppelin.minutesPerField / (cfg.speed * cfg.unitSpeed);
  return Math.round(movement.distance(from, to) * minutesPerField * 60);
}

/** Attente après un atterrissage (ms), divisée par la vitesse du monde. */
const cooldownMs = (cfg) => Math.round((cfg.zeppelin.cooldownMinutes * 60000) / cfg.speed);

/** Instant à partir duquel le vaisseau peut repartir (null : tout de suite). */
function readyAt(flight, cfg) {
  if (!flight) return null;
  if (!flight.landedAt) return new Date(flight.arrivesAt);
  const at = new Date(new Date(flight.landedAt).getTime() + cooldownMs(cfg));
  return at;
}

const isFlying = (flight) => Boolean(flight && !flight.landedAt);

async function current(villageId, t) {
  return ShipFlight.findOne({ where: { villageId }, transaction: t });
}

/** Case libre pour un atterrissage : dans le monde, hors terrain bloqué, sans village ni autre vaisseau en approche. */
async function isFree(worldId, x, y, cfg, { t, exceptVillageId } = {}) {
  if (x < 0 || y < 0 || x >= cfg.mapSize || y >= cfg.mapSize) return false;
  if (terrain.blocked(x, y)) return false;
  if (await Village.count({ where: { worldId, x, y }, transaction: t })) return false;
  const reserved = await ShipFlight.count({ where: { worldId, toX: x, toY: y, landedAt: null, ...(exceptVillageId ? { villageId: { [Op.ne]: exceptVillageId } } : {}) }, transaction: t });
  return !reserved;
}

/**
 * Vérifie un vol sans rien modifier : { from, to, seconds, arrivesAt }. Sert à la confirmation et au départ.
 */
async function plan(ctx, { x, y }, t) {
  const { village, cfg, now } = ctx;
  if (cfg.mode !== 'zeppelin') throw new GameError('Les villages ne se déplacent qu’en mode Zeppelin.');
  const to = { x: Number(x), y: Number(y) };
  if (!Number.isInteger(to.x) || !Number.isInteger(to.y)) throw new GameError('Coordonnées invalides.');
  const flight = await current(village.id, t);
  if (isFlying(flight)) throw new GameError('Le vaisseau est déjà en vol.');
  const ready = readyAt(flight, cfg);
  if (ready && ready > now) throw new GameError(`Les machines refroidissent : prochain départ possible à ${ready.toLocaleTimeString('fr-FR')}.`);
  const from = { x: village.x, y: village.y };
  if (to.x === from.x && to.y === from.y) throw new GameError('Le vaisseau est déjà sur cette case.');
  const max = cfg.zeppelin.maxDistance;
  if (max > 0 && movement.distance(from, to) > max) throw new GameError(`Trop loin : un vol ne dépasse pas ${max} cases.`);
  if (!(await isFree(village.worldId, to.x, to.y, cfg, { t, exceptVillageId: village.id }))) throw new GameError(`La case ${to.x}|${to.y} n’est pas libre.`);
  const seconds = flightSeconds(from, to, cfg);
  return { from, to, seconds, arrivesAt: movement.arrivalAt(now.getTime() + seconds * 1000, cfg) };
}

/** Fait décoller le vaisseau d'un village vers (x, y). */
async function launch(villageId, target, { now = new Date() } = {}) {
  return VillageService.withVillage(villageId, async (ctx, t) => {
    const p = await plan(ctx, target, t);
    const values = { worldId: ctx.village.worldId, fromX: p.from.x, fromY: p.from.y, toX: p.to.x, toY: p.to.y, startsAt: ctx.now, arrivesAt: p.arrivesAt, landedAt: null };
    const flight = await current(villageId, t);
    if (flight) await flight.update(values, { transaction: t });
    else await ShipFlight.create({ villageId, ...values }, { transaction: t });
    return p;
  }, { now });
}

/** Case libre la plus proche de (x, y) (atterrissage sur une case prise entre-temps, par un nouveau village). */
async function nearestFree(worldId, x, y, cfg, t, villageId) {
  for (let r = 0; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (await isFree(worldId, x + dx, y + dy, cfg, { t, exceptVillageId: villageId })) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/** Atterrissages échus avant `now` (tous les mondes, ou un seul). Renvoie le nombre de vaisseaux posés. */
async function landDue(now = new Date(), { worldId } = {}) {
  const due = await ShipFlight.findAll({ where: { landedAt: null, arrivesAt: { [Op.lte]: now }, ...(worldId ? { worldId } : {}) }, attributes: ['id'], order: [['arrivesAt', 'ASC']] });
  let landed = 0;
  for (const { id } of due) {
    await sequelize.transaction(async (t) => {
      const flight = await ShipFlight.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!flight || flight.landedAt) return;
      const world = await VillageService.cachedWorld(flight.worldId);
      const cfg = world.getConfig();
      const spot = (await isFree(flight.worldId, flight.toX, flight.toY, cfg, { t, exceptVillageId: flight.villageId }))
        ? { x: flight.toX, y: flight.toY }
        : await nearestFree(flight.worldId, flight.toX, flight.toY, cfg, t, flight.villageId);
      // Aucune case libre autour : retour à la case de départ, toujours réservée par le village.
      const at = spot || { x: flight.fromX, y: flight.fromY };
      await Village.update(at, { where: { id: flight.villageId }, transaction: t });
      await flight.update({ toX: at.x, toY: at.y, landedAt: flight.arrivesAt }, { transaction: t });
      landed++;
    });
  }
  return landed;
}

/** Le vaisseau du village est-il en vol ? */
async function inFlight(villageId, t) {
  return isFlying(await current(villageId, t));
}

/** Vols en cours d'un monde, pour la carte (positions interpolées par le navigateur). */
async function flightsFor(worldId) {
  const rows = await ShipFlight.findAll({
    where: { worldId, landedAt: null },
    include: [{ model: Village, attributes: ['id', 'name', 'points', 'playerId'], include: [{ model: Player, attributes: ['id', 'name'] }] }],
  });
  return rows.map((f) => ({
    villageId: f.villageId, name: f.Village.name, owner: f.Village.Player?.name || null, playerId: f.Village.playerId, points: f.Village.points,
    from: [f.fromX, f.fromY], to: [f.toX, f.toY], startsAt: new Date(f.startsAt).getTime(), arrivesAt: new Date(f.arrivesAt).getTime(),
  }));
}

/** État du vaisseau d'un village, pour ses pages : { flying, flight, readyAt }. */
async function status(villageId, cfg, now = new Date()) {
  const flight = await current(villageId);
  const ready = readyAt(flight, cfg);
  return { flying: isFlying(flight), flight: flight && flight.get({ plain: true }), readyAt: ready && ready > now ? ready : null };
}

module.exports = { flightSeconds, cooldownMs, plan, launch, landDue, inFlight, flightsFor, status, isFree };
