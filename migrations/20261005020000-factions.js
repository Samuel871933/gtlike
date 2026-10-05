'use strict';

// Mondes à factions (config.factions.active) : faction du joueur (Players.faction), de la tribu (Tribes.faction,
// celle de son fondateur) et faction gagnante du monde (Worlds.winnerFaction). Nulles hors des mondes à factions.

const { DataTypes } = require('sequelize');

const COLUMNS = [['Players', 'faction'], ['Tribes', 'faction'], ['Worlds', 'winnerFaction']];

async function up({ context: qi }) {
  for (const [table, column] of COLUMNS) {
    const desc = await qi.describeTable(table);
    if (!desc[column]) await qi.addColumn(table, column, { type: DataTypes.STRING(8), allowNull: true });
  }
}

async function down({ context: qi }) {
  for (const [table, column] of COLUMNS) await qi.removeColumn(table, column);
}

module.exports = { up, down };
