'use strict';

// Réglages tribu du joueur : partager ses notes de village avec sa tribu, afficher celles de la tribu.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.shareVillageNotes) await qi.addColumn('Players', 'shareVillageNotes', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  if (!players.showTribeNotes) await qi.addColumn('Players', 'showTribeNotes', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'showTribeNotes');
  await qi.removeColumn('Players', 'shareVillageNotes');
}

module.exports = { up, down };
