'use strict';

// Mode sommeil : fenêtre de sommeil du joueur.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.sleepStartsAt) await qi.addColumn('Players', 'sleepStartsAt', { type: DataTypes.DATE, allowNull: true });
  if (!players.sleepEndsAt) await qi.addColumn('Players', 'sleepEndsAt', { type: DataTypes.DATE, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'sleepStartsAt');
  await qi.removeColumn('Players', 'sleepEndsAt');
}

module.exports = { up, down };
