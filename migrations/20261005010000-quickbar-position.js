'use strict';

// Emplacement de la barre des favoris, réglage du compte (Users.quickbarPosition : top, bottom, left, right ; nul : top).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const users = await qi.describeTable('Users');
  if (!users.quickbarPosition) await qi.addColumn('Users', 'quickbarPosition', { type: DataTypes.STRING(8), allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Users', 'quickbarPosition');
}

module.exports = { up, down };
