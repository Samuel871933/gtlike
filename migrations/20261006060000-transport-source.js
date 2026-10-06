'use strict';

// Livraisons envoyées par le gestionnaire de compte (Transports.source : route, reserve ; nul pour un envoi à la main) :
// à l'arrivée, le propriétaire reçoit un rapport de commerce, même entre ses propres villages.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const table = await qi.describeTable('Transports');
  if (!table.source) await qi.addColumn('Transports', 'source', { type: DataTypes.STRING(8), allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Transports', 'source');
}

module.exports = { up, down };
