'use strict';

// Routes commerciales du gestionnaire de compte : intervalle entre deux envois (TradeRoutes.intervalMinutes, les jours
// choisis seulement ; nul : un seul envoi par jour, à l'heure de départ).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const table = await qi.describeTable('TradeRoutes');
  if (!table.intervalMinutes) await qi.addColumn('TradeRoutes', 'intervalMinutes', { type: DataTypes.INTEGER, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('TradeRoutes', 'intervalMinutes');
}

module.exports = { up, down };
