'use strict';

const formulas = require('./formulas');
const registry = require('./registry');

const RESOURCES = ['wood', 'stone', 'iron'];

/**
 * État d'un village, indépendant de la base de données.
 * Les ressources ne sont jamais « tickées » : on stocke une valeur et sa date,
 * puis on calcule la production écoulée à la lecture (`accrue`).
 */
class VillageState {
  /**
   * @param {object} data { buildings, units, wood, stone, iron, resourcesAt }
   * @param {WorldConfig} world
   */
  constructor(data, world) {
    this.world = world;
    this.buildings = { ...data.buildings };
    this.units = { ...data.units };
    this.resources = { wood: data.wood, stone: data.stone, iron: data.iron };
    this.resourcesAt = new Date(data.resourcesAt);
    this.loyalty = data.loyalty ?? 100;
    this.research = { ...(data.research || {}) };
    // Bonus des compétences « village » du paladin présent (production, construction, recrutement).
    this.villageBonus = data.villageBonus || null;
  }

  /** L'unité est-elle disponible au recrutement (recherche faite ou inutile) ? */
  hasResearched(unit) {
    return !unit.needsResearch(this.world) || Boolean(this.research[unit.id]);
  }

  /** Applique les recherches terminées avant `now`. */
  applyResearchOrders(orders, now) {
    const done = orders.filter((o) => new Date(o.endsAt) <= now);
    for (const o of done) this.research[o.unit] = true;
    return done;
  }

  level(id) {
    return this.buildings[id] || 0;
  }

  productionPerHour() {
    const p = {};
    const bonus = 1 + (this.villageBonus?.production || 0);
    for (const r of RESOURCES) p[r] = formulas.production(this.level(r), this.world) * bonus;
    return p;
  }

  storageCapacity() {
    return formulas.storageCapacity(this.level('storage'));
  }

  farmCapacity() {
    return formulas.farmCapacity(this.level('farm'));
  }

  hideCapacity() {
    return formulas.hideCapacity(this.level('hide'));
  }

  /** Fait avancer les ressources (bornées par l'entrepôt) et la loyauté (+1/h × vitesse) jusqu'à `to`. */
  accrue(to) {
    const dt = (to - this.resourcesAt) / 3600000;
    if (dt <= 0) return;
    const cap = this.storageCapacity();
    const prod = this.productionPerHour();
    for (const r of RESOURCES) {
      if (this.resources[r] < cap) this.resources[r] = Math.min(cap, this.resources[r] + prod[r] * dt);
    }
    if (this.loyalty < 100) this.loyalty = Math.min(100, this.loyalty + dt * this.world.speed);
    this.resourcesAt = new Date(to);
  }

  /** Ressources à l'instant `at` sans modifier l'état. */
  resourcesAtTime(at) {
    const copy = new VillageState({ ...this.toData(), villageBonus: this.villageBonus }, this.world);
    copy.accrue(at);
    return copy.resources;
  }

  canAfford(cost) {
    return RESOURCES.every((r) => this.resources[r] >= cost[r]);
  }

  pay(cost) {
    for (const r of RESOURCES) this.resources[r] -= cost[r];
  }

  refund(cost, ratio) {
    for (const r of RESOURCES) this.resources[r] += Math.floor(cost[r] * ratio);
  }

  /**
   * Population occupée : bâtiments (y compris niveaux en file), troupes présentes,
   * troupes hors du village (`awayUnits`) et troupes en cours de recrutement.
   */
  popUsed(buildOrders = [], recruitOrders = [], awayUnits = {}) {
    const planned = { ...this.buildings };
    for (const o of buildOrders) planned[o.building] = Math.max(planned[o.building] || 0, o.level);
    let pop = 0;
    for (const [id, lvl] of Object.entries(planned)) pop += registry.building(id).popAt(lvl);
    for (const [id, n] of Object.entries(this.units)) pop += registry.unit(id).pop * n;
    for (const [id, n] of Object.entries(awayUnits)) pop += registry.unit(id).pop * n;
    for (const o of recruitOrders) pop += registry.unit(o.unit).pop * (o.count - o.done);
    return pop;
  }

  points() {
    let pts = 0;
    for (const [id, lvl] of Object.entries(this.buildings)) pts += registry.building(id).pointsAt(lvl);
    return pts;
  }

  /**
   * Applique toutes les constructions terminées avant `now`, dans l'ordre chronologique :
   * la production change au moment où une mine ou l'entrepôt passe de niveau.
   * @returns {object[]} les ordres de construction terminés
   */
  applyBuildOrders(buildOrders, now) {
    const done = buildOrders
      .filter((o) => new Date(o.endsAt) <= now)
      .sort((a, b) => new Date(a.endsAt) - new Date(b.endsAt));
    for (const o of done) {
      this.accrue(new Date(o.endsAt));
      this.buildings[o.building] = Math.max(this.level(o.building), o.level);
    }
    this.accrue(now);
    return done;
  }

  /**
   * Ajoute les unités recrutées avant `now`.
   * @returns {{ order, done }[]} nouvelle valeur de `done` pour chaque ordre modifié
   */
  applyRecruitOrders(recruitOrders, now) {
    const updates = [];
    for (const o of recruitOrders) {
      const elapsed = now - new Date(o.startsAt);
      if (elapsed <= 0) continue;
      const done = now >= new Date(o.endsAt) ? o.count : Math.min(o.count, Math.floor(elapsed / o.unitDurationMs));
      if (done > o.done) {
        this.units[o.unit] = (this.units[o.unit] || 0) + (done - o.done);
        updates.push({ order: o, done });
      }
    }
    return updates;
  }

  toData() {
    return {
      buildings: { ...this.buildings },
      units: { ...this.units },
      ...this.resources,
      resourcesAt: this.resourcesAt,
      loyalty: this.loyalty,
      research: { ...this.research },
    };
  }
}

VillageState.RESOURCES = RESOURCES;

module.exports = VillageState;
