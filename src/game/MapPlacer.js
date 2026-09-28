'use strict';

const terrain = require('./terrain');

// Placement des nouveaux villages : comme sur Guerre Tribale, la carte se remplit
// depuis le centre, en anneaux de plus en plus larges.

const DIRECTIONS = {
  nw: [-Math.PI, -Math.PI / 2],
  ne: [-Math.PI / 2, 0],
  se: [0, Math.PI / 2],
  sw: [Math.PI / 2, Math.PI],
  random: [-Math.PI, Math.PI],
};

// Recherches : 100 essais par pas, puis l'anneau (ou le cercle autour du joueur) s'élargit de 2 cases.
const STEP = { attempts: 100, cells: 2 };
const FIND_NEAR = { min: 2, max: 6, attempts: 600 };
// Inscription : bande de l'anneau parcourue avec une seule lecture de la base, avant de passer à la suivante.
const BAND = 10;

class MapPlacer {
  /**
   * @param {WorldConfig} world
   * @param {Set<string>} occupied coordonnées "x|y" déjà prises (toute la carte, ou seulement la couronne `ring`)
   * @param {() => number} rng
   * @param {object} [opts]
   * @param {number} [opts.count] villages sur la carte, quand `occupied` n'en contient qu'une partie
   * @param {{ min: number, max: number }} [opts.ring] distances au centre couvertes par `occupied` :
   *   hors de cette couronne, aucune case n'est libre (on ne sait pas ce qui s'y trouve)
   */
  constructor(world, occupied, rng = Math.random, { count, ring } = {}) {
    this.world = world;
    this.occupied = occupied;
    this.rng = rng;
    this.count = count ?? occupied.size;
    this.ring = ring || null;
  }

  static key(x, y) {
    return `${x}|${y}`;
  }

  /** Rayon théorique de l'anneau pour `count` villages (densité placement.density). */
  static radiusFor(world, count) {
    return Math.max(3, Math.sqrt(count / (Math.PI * world.placement.density)));
  }

  /**
   * Rayon où commencer la recherche d'une inscription : le bord réel de la zone peuplée, c'est-à-dire la distance
   * au centre du dernier village de joueur créé (un peu en deçà, pour boucher les trous). Le rayon théorique
   * prend du retard (cases bloquées, écart entre joueurs) et ne sert que sur une carte vide.
   */
  static startRadius(world, count, last) {
    if (!last) return MapPlacer.radiusFor(world, count);
    return Math.max(3, Math.hypot(last.x - world.center, last.y - world.center) - 4);
  }

  /** Distance au centre au-delà de laquelle on ne cherche plus (coins de la carte compris). */
  static edge(world) {
    return world.mapSize * 0.72;
  }

  /**
   * Couronne à lire pour chercher entre `r` et `r + BAND` : la bande, l'écart de ± 2 et 3 cases de findSpot,
   * les barbares à FIND_NEAR.max cases du joueur, et une case de marge.
   */
  static bandRing(r) {
    return { min: Math.max(0, r - 2 - FIND_NEAR.max - 1), max: r + BAND + 3 + FIND_NEAR.max + 1 };
  }

  /** Occupe une case (et la compte dans le rayon de l'anneau). */
  take(x, y) {
    this.occupied.add(MapPlacer.key(x, y));
    this.count++;
    return { x, y };
  }

  /** Rayon auquel placer le prochain village, selon le nombre de villages déjà sur la carte. */
  targetRadius() {
    return MapPlacer.radiusFor(this.world, this.count);
  }

  /** Villages barbares à créer pour une inscription : `percent` % (voir placement.emptyVillages). */
  static barbariansOnJoin(percent, rng = Math.random) {
    const p = Math.max(0, Number(percent) || 0);
    return Math.floor(p / 100) + (rng() < (p % 100) / 100 ? 1 : 0);
  }

  isFree(x, y, margin = 1) {
    const max = this.world.mapSize - 1;
    if (x < 0 || y < 0 || x > max || y > max) return false;
    if (this.ring) {
      const c = this.world.center;
      const d = Math.hypot(x - c, y - c);
      if (d < this.ring.min + margin || d > this.ring.max - margin) return false;
    }
    // Pas de village sur l'eau, les lacs, les montagnes ni au cœur des forêts.
    if (terrain.blocked(x, y)) return false;
    for (let dx = -margin; dx <= margin; dx++) {
      for (let dy = -margin; dy <= margin; dy++) {
        if (this.occupied.has(MapPlacer.key(x + dx, y + dy))) return false;
      }
    }
    return true;
  }

  /**
   * Cherche un emplacement libre sur l'anneau de rayon `radius`, élargi peu à peu jusqu'à `until` ; null sinon.
   * `margin` = cases libres exigées autour (1 pour un joueur, 0 pour un village barbare).
   */
  trySpot({ direction = 'random', radius, until, margin = 1 } = {}) {
    const [a0, a1] = DIRECTIONS[direction] || DIRECTIONS.random;
    const c = this.world.center;
    const stop = until ?? (this.ring ? this.ring.max : MapPlacer.edge(this.world));
    for (let r = radius ?? this.targetRadius(); r <= stop; r += STEP.cells) {
      for (let attempt = 0; attempt < STEP.attempts; attempt++) {
        const angle = a0 + this.rng() * (a1 - a0);
        const dist = Math.max(0, r + (this.rng() * 5 - 2));
        const x = Math.round(c + dist * Math.cos(angle));
        const y = Math.round(c + dist * Math.sin(angle));
        if (this.isFree(x, y, margin)) return this.take(x, y);
      }
    }
    return null;
  }

  /** Comme trySpot, mais la carte pleine est une erreur. */
  findSpot(opts = {}) {
    const spot = this.trySpot(opts);
    if (!spot) throw new Error('Aucun emplacement libre trouvé sur la carte');
    return spot;
  }

  /**
   * Emplacement libre près d'une case (villages barbares d'un nouveau joueur, comme sur Guerre Tribale) :
   * entre `min` et `max` cases de lui, en s'éloignant peu à peu si la zone est pleine ; sinon sur son anneau.
   */
  findNear({ x: x0, y: y0 }, { min = FIND_NEAR.min, max = FIND_NEAR.max, margin = 0 } = {}) {
    let far = max;
    for (let attempt = 0; attempt < FIND_NEAR.attempts; attempt++) {
      if (attempt > 0 && attempt % STEP.attempts === 0) far += STEP.cells;
      const angle = this.rng() * 2 * Math.PI;
      const dist = min + this.rng() * (far - min);
      const x = Math.round(x0 + dist * Math.cos(angle));
      const y = Math.round(y0 + dist * Math.sin(angle));
      if (this.isFree(x, y, margin)) return this.take(x, y);
    }
    return this.findSpot({ radius: Math.hypot(x0 - this.world.center, y0 - this.world.center), margin });
  }
}

MapPlacer.BAND = BAND;
MapPlacer.DIRECTIONS = Object.keys(DIRECTIONS);

/** Numéro de continent, ex. K55 pour 500|500. */
function continent(x, y) {
  return `K${Math.floor(y / 100)}${Math.floor(x / 100)}`;
}

module.exports = { MapPlacer, continent };
