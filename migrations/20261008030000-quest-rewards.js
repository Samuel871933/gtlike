'use strict';

// Quêtes du tutoriel : leurs récompenses rejoignent BuildRewards (building 'quest', level = numéro de la quête), avec
// des troupes possibles (`units`).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const columns = await qi.describeTable('BuildRewards');
  if (!columns.units) await qi.addColumn('BuildRewards', 'units', { type: DataTypes.JSON, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('BuildRewards', 'units');
}

module.exports = { up, down };
