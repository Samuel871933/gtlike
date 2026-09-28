'use strict';

// Style global choisi par le compte (normal ou minimaliste, voir src/web/gameLayouts.js).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const users = await qi.describeTable('Users');
  if (!users.gameLayout) await qi.addColumn('Users', 'gameLayout', { type: DataTypes.STRING(16), allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Users', 'gameLayout');
}

module.exports = { up, down };
