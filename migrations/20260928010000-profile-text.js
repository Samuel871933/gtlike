'use strict';

// Texte personnel du profil joueur.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.profileText) await qi.addColumn('Players', 'profileText', { type: DataTypes.TEXT, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'profileText');
}

module.exports = { up, down };
