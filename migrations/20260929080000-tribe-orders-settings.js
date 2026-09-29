'use strict';

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.shareTribeOrders) await qi.addColumn('Players', 'shareTribeOrders', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  if (!players.showTribeOrders) await qi.addColumn('Players', 'showTribeOrders', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'showTribeOrders');
  await qi.removeColumn('Players', 'shareTribeOrders');
}

module.exports = { up, down };
