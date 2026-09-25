'use strict';

const { Op } = require('sequelize');
const { sequelize, World, Player, Village } = require('../models');
const { MapPlacer } = require('../game/MapPlacer');
const VillageState = require('../game/VillageState');
const GameError = require('./GameError');

class WorldService {
  static async createWorld({ slug, name, config = {} }) {
    return World.create({ slug, name, config });
  }

  /** Mondes, avec le joueur du compte s'il y est inscrit et les comptes qu'il remplace. */
  static async listForUser(userId) {
    const worlds = await World.findAll({ order: [['createdAt', 'DESC']] });
    const players = await Player.findAll({ where: { userId } });
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

  static async getPlayer(userId, worldId, options = {}) {
    return Player.findOne({ where: { userId, worldId }, ...options });
  }

  /**
   * Inscrit le compte sur un monde : crée le joueur et son premier village
   * sur la carte (plus quelques villages barbares autour). Sert aussi à recommencer
   * après la perte de tous ses villages.
   */
  static async join(user, worldSlug, { direction = 'random', now = new Date(), rng = Math.random } = {}) {
    return sequelize.transaction(async (transaction) => {
      const world = await World.findOne({ where: { slug: worldSlug }, transaction });
      if (!world) throw new GameError('Monde introuvable.', 404);
      if (!world.isOpen) throw new GameError("Ce monde n'accepte plus de nouveaux joueurs.");
      // Un joueur qui a perdu tous ses villages peut recommencer avec un nouveau village.
      let player = await Player.findOne({ where: { userId: user.id, worldId: world.id }, transaction });
      if (player && (await Village.count({ where: { playerId: player.id }, transaction })) > 0) {
        throw new GameError('Vous jouez déjà sur ce monde.');
      }

      const cfg = world.getConfig();
      if (!player) {
        player = await Player.create({ userId: user.id, worldId: world.id, name: user.username }, { transaction });
      } else {
        await player.update({ stats: { ...player.stats, restarts: (player.stats.restarts || 0) + 1 } }, { transaction });
      }

      const coords = await Village.findAll({ where: { worldId: world.id }, attributes: ['x', 'y'], raw: true, transaction });
      const placer = new MapPlacer(cfg, new Set(coords.map((c) => MapPlacer.key(c.x, c.y))), rng);

      const spot = placer.findSpot({ direction });
      const village = await WorldService.createVillage(world, {
        ...spot, player, name: `Village de ${player.name}`, isFirst: true, buildings: cfg.startBuildings, now,
      }, transaction);

      for (let i = 0; i < cfg.placement.barbariansPerPlayer; i++) {
        const barbSpot = placer.findSpot({ direction, radius: placer.targetRadius() + 2, margin: 0 });
        const buildings = { ...cfg.startBuildings };
        for (const r of ['wood', 'stone', 'iron']) buildings[r] = 1 + Math.floor(rng() * 5);
        await WorldService.createVillage(world, { ...barbSpot, player: null, name: 'Village barbare', buildings, now }, transaction);
      }

      await player.update({ points: village.points, villageCount: 1 }, { transaction });
      return { player, village };
    });
  }

  static async createVillage(world, { x, y, player, name, isFirst = false, buildings, now }, transaction) {
    const cfg = world.getConfig();
    const state = new VillageState(
      { buildings, units: {}, ...cfg.startResources, resourcesAt: now },
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
