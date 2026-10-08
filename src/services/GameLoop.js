'use strict';

const VillageService = require('./VillageService');
const CommandService = require('./CommandService');
const { World } = require('../models');

// Villages rafraîchis d'affilée avant de repasser par les arrivées échues.
const VILLAGE_BATCH = 200;

/**
 * Traite régulièrement les arrivées de troupes, constructions et recrutements terminés, même si le joueur
 * n'est pas connecté (points et carte à jour). Les pages, elles, font toujours un
 * rafraîchissement du village à la lecture : la boucle n'est pas nécessaire à l'exactitude.
 */
class GameLoop {
  constructor(intervalMs, { barbarianEveryMs = 10 * 60000, imageSweepEveryMs = 60 * 60000, managerEveryMs = 60000 } = {}) {
    this.intervalMs = intervalMs;
    this.barbarianEveryMs = barbarianEveryMs;
    this.imageSweepEveryMs = imageSweepEveryMs;
    this.managerEveryMs = managerEveryMs;
    this.lastManagerRun = 0;
    this.lastBarbarianGrowth = 0;
    this.lastImageSweep = 0;
    this.timer = null;
    this.running = false;
    this.slowRunning = false;
    this.managerRunning = false;
    this.botsRunning = false;
  }

  start() {
    this.timer = setInterval(() => { this.tick(); this.botsTick(); this.managerTick(); this.slowTick(); }, this.intervalMs);
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
      // Par lots : les arrivées échues entre-temps passent entre deux lots, un gros arriéré de recrues ne les fait
      // pas attendre. Rafraîchissement « nu » : rien du contexte complet n'est lu ici.
      const ids = await VillageService.dueVillageIds(now);
      for (let i = 0; i < ids.length; i += VILLAGE_BATCH) {
        if (i) await CommandService.processDue(new Date());
        for (const id of ids.slice(i, i + VILLAGE_BATCH)) {
          await VillageService.withVillage(id, async () => {}, { bare: true });
        }
      }
    } catch (err) {
      console.error('[GameLoop]', err);
    } finally {
      this.running = false;
    }
  }

  /** Bots dont c'est l'heure (quelques-uns par tour), à part du tick : leurs ordres ne retardent pas les combats. */
  async botsTick() {
    if (this.botsRunning) return;
    this.botsRunning = true;
    try {
      await require('./BotService').processDue(new Date());
    } catch (err) {
      console.error('[GameLoop]', err);
    } finally {
      this.botsRunning = false;
    }
  }

  /**
   * Gestionnaire de compte (premium) : constructions et recrutements des modèles, routes commerciales, réserve du
   * marché, notifications d'attaque. Chaque village géré a sa prochaine vérification (1 à 15 minutes). À part du
   * tick : des milliers de villages gérés ne retardent pas les combats.
   */
  async managerTick() {
    if (this.managerRunning) return;
    const now = new Date();
    if (now - this.lastManagerRun < this.managerEveryMs) return;
    this.managerRunning = true;
    this.lastManagerRun = now.getTime();
    try {
      await require('./AccountManagerService').runDue(now);
    } catch (err) {
      console.error('[GameLoop]', err);
    } finally {
      this.managerRunning = false;
    }
  }

  /**
   * Tâches périodiques longues (barbares, bots, succès, victoire, rapports, images) : à part du tick, pour que les
   * combats, constructions et recrues ne les attendent pas.
   */
  async slowTick() {
    if (this.slowRunning) return;
    this.slowRunning = true;
    try {
      const now = new Date();
      if (now - this.lastBarbarianGrowth >= this.barbarianEveryMs) {
        this.lastBarbarianGrowth = now.getTime();
        await GameLoop.growBarbarians(now);
        await GameLoop.ensureBots(now);
        await GameLoop.evaluateAchievements();
        await require('./DailyService').awardPending(now);
        await require('./VictoryService').checkAll(now);
        // Conservation des rapports (100 + 10 par village, comme sur Guerre Tribale).
        await require('./ReportService').pruneAll();
      }
      // Images de profil qui ne sont plus référencées (premier passage au démarrage, puis toutes les heures).
      if (now - this.lastImageSweep >= this.imageSweepEveryMs) {
        this.lastImageSweep = now.getTime();
        await require('./ImageService').sweepOrphans({ now: now.getTime() });
      }
    } catch (err) {
      console.error('[GameLoop]', err);
    } finally {
      this.slowRunning = false;
    }
  }

  /** Succès qui dépendent du temps ou des autres joueurs (rangs, jours dans la tribu). */
  static async evaluateAchievements() {
    const AchievementService = require('./AchievementService');
    for (const world of await World.findAll()) await AchievementService.evaluateWorld(world);
  }

  /** Complète les bots des mondes qui en demandent (config.bots.count). */
  static async ensureBots(now) {
    const BotService = require('./BotService');
    for (const world of await World.findAll({ where: { endedAt: null } })) await BotService.ensureBots(world, { now });
  }

  /** Fait grandir les villages barbares de tous les mondes (la croissance est calculée au rafraîchissement). */
  static async growBarbarians(now = new Date()) {
    for (const world of await World.findAll()) await VillageService.growBarbarians(world, now);
  }
}

module.exports = GameLoop;
