'use strict';

const { MapFavorite, Village, Player } = require('../models');
const GameError = require('./GameError');

const MAX_FAVORITES = 50;

/** Villages favoris d'un joueur, sur la carte de son monde. */
class FavoriteService {
  static list(playerId) {
    return MapFavorite.findAll({
      where: { playerId },
      include: [{ model: Village, attributes: ['id', 'name', 'x', 'y', 'points'], include: [{ model: Player, attributes: ['id', 'name'] }] }],
      order: [['createdAt', 'DESC']],
    });
  }

  /** Ajoute le village aux favoris, ou l'en retire s'il y est déjà. Renvoie true si le village est désormais favori. */
  static async toggle(playerId, worldId, villageId) {
    const village = await Village.findOne({ where: { id: Number(villageId), worldId }, attributes: ['id'] });
    if (!village) throw new GameError('Village introuvable.', 404);
    const existing = await MapFavorite.findOne({ where: { playerId, villageId: village.id } });
    if (existing) {
      await existing.destroy();
      return false;
    }
    if (await MapFavorite.count({ where: { playerId } }) >= MAX_FAVORITES) throw new GameError(`${MAX_FAVORITES} favoris au maximum.`);
    await MapFavorite.create({ playerId, villageId: village.id });
    return true;
  }
}

FavoriteService.MAX_FAVORITES = MAX_FAVORITES;

module.exports = FavoriteService;
