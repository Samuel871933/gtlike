'use strict';

// Placement des nouveaux villages : comme sur Guerre Tribale, la carte se remplit
// depuis le centre, en anneaux de plus en plus larges.

const DIRECTIONS = {
  nw: [-Math.PI, -Math.PI / 2],
  ne: [-Math.PI / 2, 0],
  se: [0, Math.PI / 2],
  sw: [Math.PI / 2, Math.PI],
  random: [-Math.PI, Math.PI],
};

class MapPlacer {
  /**
   * @param {WorldConfig} world
   * @param {Set<string>} occupied coordonnées "x|y" déjà prises
   * @param {() => number} rng
   */
  constructor(world, occupied, rng = Math.random) {
    this.world = world;
    this.occupied = occupied;
    this.rng = rng;
  }

  static key(x, y) {
    return `${x}|${y}`;
  }

  /** Rayon auquel placer le prochain village, selon le nombre de villages déjà sur la carte. */
  targetRadius() {
    return Math.max(3, Math.sqrt(this.occupied.size / (Math.PI * this.world.placement.density)));
  }

  isFree(x, y, margin = 1) {
    const max = this.world.mapSize - 1;
    if (x < 0 || y < 0 || x > max || y > max) return false;
    for (let dx = -margin; dx <= margin; dx++) {
      for (let dy = -margin; dy <= margin; dy++) {
        if (this.occupied.has(MapPlacer.key(x + dx, y + dy))) return false;
      }
    }
    return true;
  }

  /**
   * Trouve un emplacement libre. `margin` = cases libres exigées autour
   * (1 pour un joueur, 0 pour un village barbare).
   */
  findSpot({ direction = 'random', radius, margin = 1 } = {}) {
    const [a0, a1] = DIRECTIONS[direction] || DIRECTIONS.random;
    const c = this.world.center;
    let r = radius ?? this.targetRadius();
    for (let attempt = 0; attempt < 2000; attempt++) {
      if (attempt > 0 && attempt % 100 === 0) r += 2;
      const angle = a0 + this.rng() * (a1 - a0);
      const dist = Math.max(0, r + (this.rng() * 5 - 2));
      const x = Math.round(c + dist * Math.cos(angle));
      const y = Math.round(c + dist * Math.sin(angle));
      if (this.isFree(x, y, margin)) {
        this.occupied.add(MapPlacer.key(x, y));
        return { x, y };
      }
    }
    throw new Error('Aucun emplacement libre trouvé sur la carte');
  }
}

MapPlacer.DIRECTIONS = Object.keys(DIRECTIONS);

/** Numéro de continent, ex. K55 pour 500|500. */
function continent(x, y) {
  return `K${Math.floor(y / 100)}${Math.floor(x / 100)}`;
}

module.exports = { MapPlacer, continent };
