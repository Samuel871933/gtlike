'use strict';

// Rapports par page choisis par le joueur (nul : valeur par défaut, voir PaginationService).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const cols = await qi.describeTable('Players');
  if (!cols.reportsPerPage) await qi.addColumn('Players', 'reportsPerPage', { type: DataTypes.INTEGER, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'reportsPerPage');
}

module.exports = { up, down };
