'use strict';

// Bâtiments favoris de la barre d'accès rapide (sous le menu principal).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.favoriteBuildings) await qi.addColumn('Players', 'favoriteBuildings', { type: DataTypes.JSON, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'favoriteBuildings');
}

module.exports = { up, down };
