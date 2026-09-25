'use strict';

const VillageService = require('./VillageService');
const CommandService = require('./CommandService');
const { World } = require('../models');

/**
 * Traite régulièrement les arrivées de troupes, constructions et recrutements terminés, même si le joueur
 * n'est pas connecté (points et carte à jour). Les pages, elles, font toujours un
 * rafraîchissement du village à la lecture : la boucle n'est pas nécessaire à l'exactitude.
 */
class GameLoop {
  constructor(intervalMs, { barbarianEveryMs = 10 * 60000 } = {}) {
    this.intervalMs = intervalMs;
    this.barbarianEveryMs = barbarianEveryMs;
    this.lastBarbarianGrowth = 0;
    this.timer = null;
    this.running = false;
  }

  start() {
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      // Les mouvements d'abord : un combat se calcule sur l'état du village à l'arrivée.
      await CommandService.processDue(now);
      const ids = await VillageService.dueVillageIds(now);
      for (const id of ids) {
        await VillageService.withVillage(id, async () => {});
      }
      if (now - this.lastBarbarianGrowth >= this.barbarianEveryMs) {
        this.lastBarbarianGrowth = now.getTime();
        await GameLoop.growBarbarians();
        await GameLoop.evaluateAchievements();
        await require('./DailyService').awardPending(now);
        await require('./VictoryService').checkAll(now);
      }
    } catch (err) {
      console.error('[GameLoop]', err);
    } finally {
      this.running = false;
    }
  }

  /** Succès qui dépendent du temps ou des autres joueurs (rangs, jours dans la tribu). */
  static async evaluateAchievements() {
    const AchievementService = require('./AchievementService');
    const { Player } = require('../models');
    const players = await Player.findAll({ attributes: ['id'], raw: true });
    for (const { id } of players) await AchievementService.evaluate(id);
  }

  /** Fait grandir les villages barbares de tous les mondes (la croissance est calculée au rafraîchissement). */
  static async growBarbarians() {
    for (const world of await World.findAll()) {
      const ids = await VillageService.growingBarbarianIds(world.id, world.getConfig().barbarian.maxPoints);
      for (const id of ids) await VillageService.withVillage(id, async () => {});
    }
  }
}

module.exports = GameLoop;
