'use strict';

// Aperçu Arrivant : nombre d'ordres par page choisi par le joueur (Players.incomingsPerPage, nul : 100).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.incomingsPerPage) await qi.addColumn('Players', 'incomingsPerPage', { type: DataTypes.INTEGER, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'incomingsPerPage');
}

module.exports = { up, down };
