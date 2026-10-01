'use strict';

// Index des joueurs lus à chaque affichage : points d'une tribu (cases de la carte, src/web/mapView.js) et rang du
// joueur (en-tête de chaque page, middleware loadVillage).

const INDEXES = [
  { name: 'players_tribe_id', fields: ['tribeId'] },
  { name: 'players_world_id_points', fields: ['worldId', 'points'] },
];

async function up({ context: qi }) {
  const existing = new Set((await qi.showIndex('Players')).map((i) => i.name));
  for (const { name, fields } of INDEXES) {
    if (!existing.has(name)) await qi.addIndex('Players', fields, { name });
  }
}

async function down({ context: qi }) {
  for (const { name } of INDEXES) await qi.removeIndex('Players', name);
}

module.exports = { up, down };
