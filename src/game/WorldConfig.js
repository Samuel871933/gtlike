'use strict';

// Configuration d'un monde. Tout ce qui varie d'un serveur à l'autre passe par ici
// (équivalent de interface.php?func=get_config).

const DEFAULTS = {
  speed: 1,
  unitSpeed: 1,
  baseProduction: 30,
  zeroLevelProduction: 5,
  mapSize: 1000,
  buildQueueSlots: 2,
  cancelRefund: 0.9,
  // Construction en cours terminée gratuitement quand il lui reste au plus ce temps (secondes réelles), comme sur GT.
  freeFinishSeconds: 180,
  // Démolition au quartier général (comme sur GT) : QG de ce niveau au moins, loyauté à 100 %.
  demolishMainLevel: 15,
  features: { knight: false, archer: false },
  startBuildings: { main: 1, farm: 1, storage: 1, place: 1 },
  startResources: { wood: 500, stone: 500, iron: 500 },
  // Placement. emptyVillages : villages barbares créés à chaque inscription, en % comme coord.empty_villages de
  // Guerre Tribale (170 = 1 barbare + 70 % de chances d'un 2e ; FR : 0 à 2000 selon le monde).
  placement: { density: 0.35, emptyVillages: 100 },
  // Mode sommeil (mondes speed) : délai avant activation, durée min/max, éveil minimal entre deux sommeils
  sleep: { active: false, delayMinutes: 60, minHours: 6, maxHours: 10, minAwakeHours: 12 },
  // Mode vacances : remplaçants autorisés, nombre maximal de comptes remplacés par un joueur
  sitter: { allow: true, maxAccounts: 3 },
  // Milice (module `features.militia`, comme sur GT) : 20 miliciens par niveau de ferme jusqu'au niveau 15, pendant
  // 6 heures, production des ressources × 0,5 pendant ce temps ; impossible au-delà de 2 villages.
  militia: { perFarmLevel: 20, maxFarmLevel: 15, hours: 6, productionFactor: 0.5, maxVillages: 2 },
  // Paladin (module features.knight) : 'items' (un paladin, armes) ou 'skills' (jusqu'à 10 paladins à compétences)
  knightSystem: 'items',
  // Formation des paladins à compétences (valeurs estimées, non publiées)
  knightTraining: [
    { id: 'drill', name: 'Entraînement', hours: 2, xp: 2500, cost: { wood: 1500, stone: 1500, iron: 1500 } },
    { id: 'exercise', name: 'Manœuvres', hours: 8, xp: 12000, cost: { wood: 5000, stone: 5000, iron: 5000 } },
    { id: 'campaign', name: 'Campagne', hours: 24, xp: 40000, cost: { wood: 15000, stone: 15000, iron: 15000 } },
  ],
  // Armes du paladin : progression par jour (%, × vitesse) et points d'adversaires vaincus pour 1 %
  knightItems: { active: true, progressPerDay: 3, killPointsPerPercent: 100 },
  // Recherche à la forge : 'simple' (les unités se recherchent une fois) ou 'none'
  tech: 'simple',
  // Combat
  moral: true,
  luck: 0.25,
  night: { active: false, startHour: 0, endHour: 8, defFactor: 2 },
  newbieDays: 5,
  commandCancelSeconds: 600,
  // Villages barbares : points gagnés par jour (× vitesse du monde) et plafond
  barbarian: { growthPerDay: 40, maxPoints: 1500 },
  // Collecte : 4 options (taux de butin), la première est ouverte d'office. Coûts et durées de
  // déblocage estimés (non publiés), durées divisées par la vitesse du monde.
  scavenging: {
    active: true,
    options: [
      { id: 1, name: 'Collecteurs paresseux', lootFactor: 0.1, unlock: null },
      { id: 2, name: 'Collecteurs modestes', lootFactor: 0.25, unlock: { cost: { wood: 250, stone: 300, iron: 250 }, hours: 1 } },
      { id: 3, name: 'Collecteurs astucieux', lootFactor: 0.5, unlock: { cost: { wood: 1000, stone: 1200, iron: 1000 }, hours: 4 } },
      { id: 4, name: 'Grands collecteurs', lootFactor: 0.75, unlock: { cost: { wood: 10000, stone: 12000, iron: 10000 }, hours: 12 } },
    ],
  },
  // Conditions de victoire. `type` : dominance | pointsVillages | runes | siege | none.
  // Les durées sont en jours réels (comme sur Guerre Tribale, elles ne suivent pas la vitesse du monde).
  victory: {
    type: 'dominance',
    dominance: { warningPercent: 35, warningWorldAgeDays: 80, endgamePercent: 50, minWorldAgeDays: 180, holdDays: 14 },
    pointsVillages: { scope: 'tribe', points: 5000000, villages: 1000, holdHours: 72 },
    runes: { spawnAfterDays: 90, villagesPerContinent: 25, winPercent: 60, holdDays: 14, garrison: { spear: 3000, sword: 3000, heavy: 300 } },
    siege: {
      startAfterDays: 140, villages: 36, influencePerVillagePerDay: 500, requiredInfluence: 162000,
      reductionEveryDays: 7, reductionPercent: 12, maxReductionPercent: 85, garrison: { spear: 5000, sword: 5000, heavy: 500 },
    },
  },
  // Tribus : membres max, attaque interdite entre membres, soutien réservé à la tribu et aux alliés
  tribe: { memberLimit: 25, noHarm: true, supportOnlyTribe: false },
  // Marché : capacité d'un marchand, minutes par case, écart de valeur maximal d'une offre (1:maxRatio)
  market: { merchantCapacity: 1000, merchantSpeed: 6, maxRatio: 3 },
  // Nobles (système de pièces d'or)
  snob: {
    maxDistance: 70,
    coin: { wood: 28000, stone: 30000, iron: 25000 },
    loyaltyLossMin: 20,
    loyaltyLossMax: 35,
    loyaltyAfterConquest: 25,
  },
};

class WorldConfig {
  constructor(raw = {}) {
    const merged = {
      ...DEFAULTS,
      ...raw,
      features: { ...DEFAULTS.features, ...(raw.features || {}) },
      startResources: { ...DEFAULTS.startResources, ...(raw.startResources || {}) },
      placement: { ...DEFAULTS.placement, ...(raw.placement || {}) },
      night: { ...DEFAULTS.night, ...(raw.night || {}) },
      snob: { ...DEFAULTS.snob, ...(raw.snob || {}) },
      market: { ...DEFAULTS.market, ...(raw.market || {}) },
      tribe: { ...DEFAULTS.tribe, ...(raw.tribe || {}) },
      scavenging: { ...DEFAULTS.scavenging, ...(raw.scavenging || {}) },
      victory: {
        ...DEFAULTS.victory,
        ...(raw.victory || {}),
        dominance: { ...DEFAULTS.victory.dominance, ...(raw.victory?.dominance || {}) },
        pointsVillages: { ...DEFAULTS.victory.pointsVillages, ...(raw.victory?.pointsVillages || {}) },
        runes: { ...DEFAULTS.victory.runes, ...(raw.victory?.runes || {}) },
        siege: { ...DEFAULTS.victory.siege, ...(raw.victory?.siege || {}) },
      },
      barbarian: { ...DEFAULTS.barbarian, ...(raw.barbarian || {}) },
      sleep: { ...DEFAULTS.sleep, ...(raw.sleep || {}) },
      sitter: { ...DEFAULTS.sitter, ...(raw.sitter || {}) },
      militia: { ...DEFAULTS.militia, ...(raw.militia || {}) },
      knightItems: { ...DEFAULTS.knightItems, ...(raw.knightItems || {}) },
      startBuildings: raw.startBuildings || DEFAULTS.startBuildings,
    };
    Object.assign(this, merged);
    Object.freeze(this);
  }

  hasFeature(name) {
    return !name || Boolean(this.features[name]);
  }

  /** Le bonus de nuit s'applique-t-il à cette date (heure du serveur) ? */
  isNight(date) {
    if (!this.night.active) return false;
    const h = new Date(date).getHours();
    const { startHour: a, endHour: b } = this.night;
    return a <= b ? h >= a && h < b : h >= a || h < b;
  }

  get center() {
    return Math.floor(this.mapSize / 2);
  }

  toJSON() {
    return { ...this };
  }
}

WorldConfig.DEFAULTS = DEFAULTS;

module.exports = WorldConfig;
