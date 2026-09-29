'use strict';

// Milice (module `militia` du monde) : fin du stationnement de la milice d'un village.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const villages = await qi.describeTable('Villages');
  if (!villages.militiaUntil) await qi.addColumn('Villages', 'militiaUntil', { type: DataTypes.DATE, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Villages', 'militiaUntil');
}

module.exports = { up, down };
