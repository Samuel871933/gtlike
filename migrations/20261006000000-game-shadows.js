'use strict';

// Ombres portées de l'interface (Compte → Style de jeu) : oui, non, ou nul pour suivre le style de jeu (voir
// src/web/gameLayouts.js).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const users = await qi.describeTable('Users');
  if (!users.gameShadows) await qi.addColumn('Users', 'gameShadows', { type: DataTypes.BOOLEAN, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Users', 'gameShadows');
}

module.exports = { up, down };
