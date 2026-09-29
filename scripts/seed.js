'use strict';

const { World } = require('../src/models');

// Mondes de base. Ajouter un monde = ajouter une entrée ici (ou insérer une ligne dans la table Worlds).
// La config d'un monde listé ici est resynchronisée à chaque démarrage.
// `features.militia` et `militia` : milice de la ferme (voir src/game/WorldConfig.js, désactivée par défaut).
// `victory` : condition de fin du monde (type dominance | pointsVillages | runes | siege | none et ses seuils) ;
// les valeurs absentes reprennent celles de src/game/WorldConfig.js (dominance GT : 50 %, 180 jours, 14 jours).
const WORLDS = [
  {
    slug: 'w1',
    name: 'Monde 1',
    config: {
      speed: 1,
      unitSpeed: 1,
      night: { active: true, startHour: 0, endHour: 8, defFactor: 2 },
      victory: { type: 'dominance', dominance: { endgamePercent: 50, minWorldAgeDays: 180, holdDays: 14, warningPercent: 35, warningWorldAgeDays: 80 } },
    },
  },
  {
    slug: 'speed',
    name: 'Monde rapide (test)',
    config: {
      speed: 100,
      unitSpeed: 1,
      newbieDays: 0,
      commandCancelSeconds: 60,
      sleep: { active: true, delayMinutes: 1, minHours: 0.05, maxHours: 0.2, minAwakeHours: 0.1 },
      features: { knight: true, archer: true, militia: true },
      // Milice de GT (20 par niveau de ferme jusqu'au niv. 15, production × 0,5, 2 villages max), 15 min pour tester.
      militia: { hours: 0.25 },
      // Villages barbares sans troupes (ni au peuplement, ni après l'abandon d'un joueur).
      barbarian: { troops: false },
      // Monde de test : fin de partie plus proche pour pouvoir l'essayer.
      victory: { type: 'dominance', dominance: { endgamePercent: 50, minWorldAgeDays: 10, holdDays: 2, warningPercent: 15, warningWorldAgeDays: 3 } },
    },
  },
  {
    slug: 'skills',
    name: 'Monde paladins (test)',
    config: {
      speed: 100,
      unitSpeed: 1,
      newbieDays: 0,
      commandCancelSeconds: 60,
      knightSystem: 'skills',
      features: { knight: true, archer: false },
    },
  },
];

async function seedWorlds() {
  for (const w of WORLDS) {
    const [world, created] = await World.findOrCreate({ where: { slug: w.slug }, defaults: w });
    if (!created) await world.update({ name: w.name, config: w.config });
  }
}

module.exports = { seedWorlds, WORLDS };

if (require.main === module) {
  const { sequelize } = require('../src/models');
  const config = require('../src/config');
  if (!config.databaseUrl) require('fs').mkdirSync(require('path').dirname(config.sqliteStorage), { recursive: true });
  require('../src/migrator').createMigrator().up().then(seedWorlds).then(() => {
    console.log('Mondes créés.');
    return sequelize.close();
  });
}
