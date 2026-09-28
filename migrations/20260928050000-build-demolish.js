'use strict';

// Démolition au quartier général : un ordre de la file de construction qui fait baisser le bâtiment d'un niveau.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const orders = await qi.describeTable('BuildOrders');
  if (!orders.demolish) await qi.addColumn('BuildOrders', 'demolish', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
}

async function down({ context: qi }) {
  await qi.removeColumn('BuildOrders', 'demolish');
}

module.exports = { up, down };
