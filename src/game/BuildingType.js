'use strict';

const formulas = require('./formulas');

const RESOURCES = ['wood', 'stone', 'iron'];

class BuildingType {
  constructor(def) {
    Object.assign(this, def);
    Object.freeze(this);
  }

  isAvailableIn(world) {
    return world.hasFeature(this.feature);
  }

  /** Coût pour passer au niveau `level`. */
  costFor(level) {
    const cost = {};
    for (const r of RESOURCES) cost[r] = Math.round(this.cost[r] * Math.pow(this.factor[r], level - 1));
    return cost;
  }

  /** Population totale occupée par le bâtiment au niveau `level`. */
  popAt(level) {
    if (level <= 0) return 0;
    return Math.round(this.pop * Math.pow(this.popFactor, level - 1));
  }

  /** Population supplémentaire nécessaire pour passer au niveau `level`. */
  popFor(level) {
    return this.popAt(level) - this.popAt(level - 1);
  }

  /** Durée (s) pour passer au niveau `level` avec le QG au niveau `hqLevel`. */
  buildTimeFor(level, hqLevel, world) {
    return formulas.buildTime(this.buildTime, this.buildTimeFactor, level, hqLevel, world.speed);
  }

  /** Points cumulés du bâtiment au niveau `level`. */
  pointsAt(level) {
    let total = 0;
    for (let i = 1; i <= level; i++) total += Math.round(this.points * Math.pow(1.2, i - 1));
    return total;
  }

  /** Prérequis non remplis pour un jeu de niveaux donné : [{ building, level }]. */
  missingRequirements(levels) {
    return Object.entries(this.requires)
      .filter(([id, lvl]) => (levels[id] || 0) < lvl)
      .map(([building, level]) => ({ building, level }));
  }
}

BuildingType.RESOURCES = RESOURCES;

module.exports = BuildingType;
