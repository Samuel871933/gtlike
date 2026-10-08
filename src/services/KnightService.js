'use strict';

const { World, Player } = require('../models');
const registry = require('../game/registry');
const GameError = require('./GameError');

const DAY = 86400000;

/**
 * Armes du paladin. La jauge de découverte monte avec le temps (depuis la construction
 * de la statue) et avec les adversaires vaincus ; à 100 %, une arme au hasard est trouvée,
 * à condition d'avoir déjà recruté un paladin. Les points en trop sont conservés.
 */
class KnightService {
  static async config(player, t) {
    return (await World.cached(player.worldId)).getConfig();
  }

  static enabled(cfg) {
    return cfg.hasFeature('knight') && cfg.knightSystem === 'items' && cfg.knightItems.active;
  }

  /** Met à jour la jauge jusqu'à `now` et attribue les armes trouvées. Renvoie les nouvelles armes. */
  static async sync(player, { now = new Date(), rng = Math.random, t } = {}) {
    const cfg = await KnightService.config(player, t);
    if (!KnightService.enabled(cfg)) return [];
    let progress = player.knightProgress;
    let progressAt = player.knightProgressAt;
    if (progressAt && now > new Date(progressAt)) {
      progress += ((now - new Date(progressAt)) / DAY) * cfg.knightItems.progressPerDay * cfg.speed;
      progressAt = now;
    }
    const owned = [...player.knightItems];
    const found = [];
    const remaining = () => registry.itemsFor(cfg).filter((i) => !owned.includes(i.id));
    while (player.knightRecruited && progress >= 100 && remaining().length) {
      const pool = remaining();
      const item = pool[Math.floor(rng() * pool.length)];
      owned.push(item.id);
      found.push(item);
      progress -= 100;
    }
    if (!remaining().length) progress = Math.min(progress, 100);
    await player.update({
      knightProgress: progress, knightProgressAt: progressAt, knightItems: owned,
      knightItem: player.knightItem || (found[0] ? found[0].id : null),
    }, { transaction: t });
    if (found.length) await require('./AchievementService').evaluate(player.id, { now, t });
    return found;
  }

  /** La statue vient d'être construite : la jauge commence à monter avec le temps. */
  static async startClock(playerId, at, t) {
    await Player.update({ knightProgressAt: at }, { where: { id: playerId, knightProgressAt: null }, transaction: t });
  }

  /** Les adversaires vaincus font avancer la jauge (le paladin n'a pas besoin d'être présent). */
  static async addKills(playerId, killPoints, cfg, t) {
    if (!KnightService.enabled(cfg) || !killPoints) return;
    await Player.increment({ knightProgress: killPoints / cfg.knightItems.killPointsPerPercent }, { where: { id: playerId }, transaction: t });
  }

  static async equip(playerId, itemId) {
    const player = await Player.findByPk(playerId);
    if (!player.knightItems.includes(itemId)) throw new GameError("Vous n'avez pas encore trouvé cette arme.");
    await player.update({ knightItem: itemId });
    return registry.ITEMS.get(itemId);
  }
}

module.exports = KnightService;
