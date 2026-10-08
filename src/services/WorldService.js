'use strict';

const { Op } = require('sequelize');
const { sequelize, World, Player, Village } = require('../models');
const { MapPlacer } = require('../game/MapPlacer');
const VillageState = require('../game/VillageState');
const GameError = require('./GameError');
const { FACTIONS, isFaction } = require('../game/factions');

class WorldService {
  static async createWorld({ slug, name, config = {} }) {
    return World.create({ slug, name, config });
  }

  /** Mondes, avec le joueur du compte s'il y est inscrit et les comptes qu'il remplace. */
  static async listForUser(userId) {
    // Sans les mondes des parties du matchup (voir MatchService) : ils ne se rejoignent pas depuis les listes.
    const worlds = await World.findAll({ where: World.NOT_MATCH, order: [['createdAt', 'DESC']] });
    // Hors connexion (userId null) : aucun joueur, et surtout pas les bots (sans compte).
    const players = userId ? await Player.findAll({ where: { userId } }) : [];
    const byWorld = new Map(players.map((p) => [p.worldId, p]));
    const sitting = players.length
      ? await Player.findAll({ where: { sitterId: players.map((p) => p.id), sitterAcceptedAt: { [Op.ne]: null } } })
      : [];
    return worlds.map((world) => ({
      world,
      player: byWorld.get(world.id) || null,
      sitting: sitting.filter((p) => p.worldId === world.id),
    }));
  }

  /** Nombre de joueurs actifs (au moins un village, bots non compris) de chaque monde : Map(worldId → nombre). */
  static async playerCounts(worldIds) {
    if (!worldIds.length) return new Map();
    const rows = await Player.findAll({
      where: { worldId: worldIds, isBot: false, villageCount: { [Op.gt]: 0 } },
      attributes: ['worldId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['worldId'], raw: true,
    });
    return new Map(rows.map((r) => [r.worldId, Number(r.n)]));
  }

  static async getPlayer(userId, worldId, options = {}) {
    return Player.findOne({ where: { userId, worldId }, ...options });
  }

  /**
   * Inscrit le compte sur un monde : crée le joueur et son premier village
   * sur la carte (plus quelques villages barbares autour). Sert aussi à recommencer
   * après la perte de tous ses villages. Monde à factions : `faction` est obligatoire à la première inscription,
   * puis définitive (on recommence dans la même faction).
   */
  static async join(user, worldSlug, { direction = 'random', faction = null, now = new Date(), rng = Math.random } = {}) {
    return sequelize.transaction(async (transaction) => {
      const world = await World.findOne({ where: { slug: worldSlug }, transaction });
      if (!world) throw new GameError('Monde introuvable.', 404);
      if (!world.isOpen) throw new GameError("Ce monde n'accepte plus de nouveaux joueurs.");
      // Un joueur qui a perdu tous ses villages peut recommencer avec un nouveau village.
      let player = await Player.findOne({ where: { userId: user.id, worldId: world.id }, transaction });
      if (player && (await Village.count({ where: { playerId: player.id }, transaction })) > 0) {
        throw new GameError('Vous jouez déjà sur ce monde.');
      }

      const factions = world.getConfig().factions.active;
      if (!player) {
        if (factions && !isFaction(faction)) throw new GameError('Choisis ta faction : elfes, nains, orques ou humains.');
        player = await Player.create({ userId: user.id, worldId: world.id, name: user.username, faction: factions ? faction : null }, { transaction });
      } else {
        await player.update({ stats: { ...player.stats, restarts: (player.stats.restarts || 0) + 1 } }, { transaction });
      }
      const village = await WorldService.settle(world, player, { direction, now, rng }, transaction);
      return { player, village };
    });
  }

  /**
   * Fait entrer un bot sur le monde (joueur sans compte, voir BotService) : nouveau joueur nommé `name`, ou `player`
   * existant qui a perdu tous ses villages et recommence. Mêmes règles de placement qu'un joueur.
   */
  static async joinBot(world, { name, player = null, now = new Date(), rng = Math.random } = {}) {
    return sequelize.transaction(async (transaction) => {
      if (player) {
        await player.update({ stats: { ...player.stats, restarts: (player.stats.restarts || 0) + 1 } }, { transaction });
      } else {
        const faction = world.getConfig().factions.active ? await WorldService.smallestFaction(world.id, transaction, rng) : null;
        player = await Player.create({ userId: null, isBot: true, worldId: world.id, name, faction }, { transaction });
      }
      const village = await WorldService.settle(world, player, { now, rng }, transaction);
      return { player, village };
    });
  }

  /** Joueurs de chaque faction d'un monde : Map(faction → nombre). */
  static async factionCounts(worldId, transaction) {
    const rows = await Player.findAll({
      where: { worldId, faction: { [Op.ne]: null } },
      attributes: ['faction', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['faction'], raw: true, transaction,
    });
    return new Map(rows.map((r) => [r.faction, Number(r.n)]));
  }

  /** Faction la moins peuplée (au hasard entre les ex aequo) : celle des bots qui entrent dans le monde. */
  static async smallestFaction(worldId, transaction, rng = Math.random) {
    const counts = await WorldService.factionCounts(worldId, transaction);
    const min = Math.min(...FACTIONS.map((f) => counts.get(f.id) || 0));
    const pool = FACTIONS.filter((f) => (counts.get(f.id) || 0) === min);
    return pool[Math.floor(rng() * pool.length)].id;
  }

  /** Premier village d'un joueur (et ses barbares autour), points et nombre de villages du joueur à jour. */
  static async settle(world, player, { direction = 'random', now, rng }, transaction) {
    const cfg = world.getConfig();
    // Emplacements du village et de ses barbares (autour de lui : ses premières cibles de pillage). On part du
    // bord de la zone peuplée et on avance par bandes de MapPlacer.BAND cases : chaque bande ne lit que ses
    // villages, jamais toute la carte.
    const count = await Village.count({ where: { worldId: world.id }, transaction });
    const last = await Village.findOne({
      where: { worldId: world.id, playerId: { [Op.ne]: null } }, order: [['id', 'DESC']], attributes: ['x', 'y'], raw: true, transaction,
    });
    const barbarians = MapPlacer.barbariansOnJoin(cfg.placement.emptyVillages, rng);
    let spots = null;
    for (let r = MapPlacer.startRadius(cfg, count, last); !spots; r += MapPlacer.BAND) {
      if (r > MapPlacer.edge(cfg)) throw new GameError("La carte est pleine : plus aucun emplacement libre.");
      const ring = MapPlacer.bandRing(r);
      const coords = await WorldService.villagesInRing(world.id, cfg.center, ring, transaction);
      const placer = new MapPlacer(cfg, new Set(coords.map((c) => MapPlacer.key(c.x, c.y))), rng, { count, ring });
      const spot = placer.trySpot({ direction, radius: r, until: r + MapPlacer.BAND });
      if (spot) spots = { spot, barbs: Array.from({ length: barbarians }, () => placer.findNear(spot)) };
    }

    const village = await WorldService.createVillage(world, {
      ...spots.spot, player, name: `Village de ${player.name}`, isFirst: true, now,
      // Mondes avec église : le premier village a déjà sa première église, comme sur GT.
      buildings: cfg.hasFeature('church') ? { ...cfg.startBuildings, church_f: 1 } : cfg.startBuildings,
    }, transaction);
    for (const barbSpot of spots.barbs) {
      const buildings = { ...cfg.startBuildings };
      for (const r of ['wood', 'stone', 'iron']) buildings[r] = 1 + Math.floor(rng() * 5);
      await WorldService.createVillage(world, { ...barbSpot, player: null, name: 'Village barbare', buildings, now }, transaction);
    }

    await player.update({ points: village.points, villageCount: 1 }, { transaction });
    return village;
  }

  /** Coordonnées des villages entre `ring.min` et `ring.max` cases du centre (index worldId, x, y). */
  static async villagesInRing(worldId, c, { min, max }, transaction) {
    const lo = Math.max(0, Math.floor(min)); const hi = Math.ceil(max);
    return Village.findAll({
      where: {
        worldId,
        x: { [Op.between]: [c - hi, c + hi] },
        y: { [Op.between]: [c - hi, c + hi] },
        [Op.and]: [sequelize.where(sequelize.literal(`(("x" - ${Number(c)}) * ("x" - ${Number(c)}) + ("y" - ${Number(c)}) * ("y" - ${Number(c)}))`), { [Op.gte]: lo * lo })],
      },
      attributes: ['x', 'y'],
      raw: true,
      transaction,
    });
  }

  static async createVillage(world, { x, y, player, name, isFirst = false, buildings, units = {}, now }, transaction) {
    const cfg = world.getConfig();
    const state = new VillageState(
      { buildings, units, ...cfg.startResources, resourcesAt: now },
      cfg,
    );
    return Village.create({
      worldId: world.id,
      playerId: player ? player.id : null,
      name, x, y, isFirst,
      ...state.toData(),
      points: state.points(),
    }, { transaction });
  }
}

module.exports = WorldService;
