'use strict';

const formulas = require('./formulas');

class UnitType {
  constructor(def) {
    Object.assign(this, def);
    Object.freeze(this);
  }

  isAvailableIn(world) {
    return world.hasFeature(this.feature);
  }

  costFor(count) {
    return { wood: this.cost.wood * count, stone: this.cost.stone * count, iron: this.cost.iron * count };
  }

  /** Durée (s, non arrondie) de recrutement d'une unité selon le niveau du bâtiment. */
  recruitTimeFor(buildingLevel, world) {
    return formulas.recruitTime(this.buildTime, buildingLevel, world.speed);
  }

  /** Minutes par case, selon la vitesse du monde et des unités. */
  minutesPerField(world) {
    return this.speed / (world.speed * world.unitSpeed);
  }

  /** L'unité doit-elle être recherchée à la forge sur ce monde ? */
  needsResearch(world) {
    return world.tech === 'simple' && Boolean(this.research);
  }

  /** Prérequis de bâtiments, y compris ceux de la recherche quand elle est active. */
  missingRequirements(levels, world) {
    const requires = world && this.needsResearch(world) ? { ...this.requires, ...this.researchRequires } : this.requires;
    return Object.entries(requires)
      .filter(([id, lvl]) => (levels[id] || 0) < lvl)
      .map(([building, level]) => ({ building, level }));
  }

  researchTimeFor(smithLevel, world) {
    return formulas.researchTime(this.research, smithLevel, world.speed);
  }
}

module.exports = UnitType;
