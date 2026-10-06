'use strict';

// Aperçus des villages : nombre de villages par page, choisi par le joueur (Players.villagesPerPage, nul : par défaut).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.villagesPerPage) await qi.addColumn('Players', 'villagesPerPage', { type: DataTypes.INTEGER, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'villagesPerPage');
}

module.exports = { up, down };
