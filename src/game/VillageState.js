'use strict';

const formulas = require('./formulas');
const registry = require('./registry');
const seals = require('./seals');

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
    // Milice stationnée jusqu'à cette date : production réduite (world.militia.productionFactor) jusque-là.
    this.militiaUntil = data.militiaUntil ? new Date(data.militiaUntil) : null;
    // Sceau posé sur le village (module features.seals, voir game/seals.js) : { type, level } ou null.
    this.seal = seals.of(data, world);
  }

  /** La milice est-elle stationnée à l'instant `at` (par défaut : l'heure des ressources) ? */
  militiaActive(at = this.resourcesAt) {
    return Boolean(this.militiaUntil) && new Date(at) < this.militiaUntil;
  }

  /** Renvoie la milice : les miliciens disparaissent et la production redevient normale. */
  dismissMilitia() {
    delete this.units.militia;
    this.militiaUntil = null;
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
    const militia = this.militiaActive() ? this.world.militia.productionFactor : 1;
    const bonus = (1 + (this.villageBonus?.production || 0) + seals.bonus(this.seal, 'production')) * militia;
    for (const r of RESOURCES) p[r] = formulas.production(this.level(r), this.world) * bonus;
    return p;
  }

  storageCapacity() {
    return formulas.storageCapacity(this.level('storage'));
  }

  farmCapacity() {
    // Sceau de population : ferme agrandie.
    return Math.floor(formulas.farmCapacity(this.level('farm')) * (1 + seals.bonus(this.seal, 'population')));
  }

  hideCapacity() {
    return formulas.hideCapacity(this.level('hide'));
  }

  /** Fait avancer les ressources (bornées par l'entrepôt) et la loyauté (+1/h × vitesse) jusqu'à `to`. */
  accrue(to) {
    // Fin de la milice pendant l'intervalle : production réduite jusqu'à cette date, normale ensuite.
    if (this.militiaActive() && new Date(to) > this.militiaUntil) {
      this.accrue(this.militiaUntil);
      this.dismissMilitia();
    }
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

  /** Facteur du temps de recrutement : compétence « recrutement » du paladin, sceau de recrutement (+20 % de vitesse). */
  recruitFactor() {
    return (1 - (this.villageBonus?.recruitSpeed || 0)) / (1 + seals.bonus(this.seal, 'recruit'));
  }

  /** Champs du sceau du village, pour une copie de l'état (ils ne font pas partie de toData). */
  sealData() {
    return this.seal ? { sealType: this.seal.type, sealLevel: this.seal.level } : {};
  }

  /** Ressources à l'instant `at` sans modifier l'état. */
  resourcesAtTime(at) {
    const copy = new VillageState({ ...this.toData(), villageBonus: this.villageBonus, ...this.sealData() }, this.world);
    copy.accrue(at);
    return copy.resources;
  }

  canAfford(cost) {
    return RESOURCES.every((r) => this.resources[r] >= cost[r]);
  }

  /**
   * Heure à laquelle la production couvrira `cost` (`now` si c'est déjà le cas), comme « Ressources disponibles … »
   * sur GT ; null si ça n'arrivera jamais (coût au-delà de l'entrepôt, production nulle).
   */
  affordableAt(cost, now) {
    const cap = this.storageCapacity();
    const prod = this.productionPerHour();
    let wait = 0;
    for (const r of RESOURCES) {
      const missing = cost[r] - this.resources[r];
      if (missing <= 0) continue;
      if (cost[r] > cap || !(prod[r] > 0)) return null;
      wait = Math.max(wait, (missing / prod[r]) * 3600);
    }
    return new Date(new Date(now).getTime() + Math.ceil(wait) * 1000);
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
      // Démolition : le bâtiment descend au niveau de l'ordre ; construction : il y monte.
      this.buildings[o.building] = o.demolish ? Math.min(this.level(o.building), o.level) : Math.max(this.level(o.building), o.level);
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
      militiaUntil: this.militiaUntil,
    };
  }
}

VillageState.RESOURCES = RESOURCES;

module.exports = VillageState;
