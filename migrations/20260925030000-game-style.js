'use strict';

// Style de jeu choisi par le compte (habillage de l'interface en partie, voir src/web/gameStyles.js).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const users = await qi.describeTable('Users');
  if (!users.gameStyle) await qi.addColumn('Users', 'gameStyle', { type: DataTypes.STRING(16), allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Users', 'gameStyle');
}

module.exports = { up, down };
