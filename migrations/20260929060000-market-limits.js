'use strict';

// Marché comme sur GT : limites d'une offre (durée maximale du voyage, commerce de tribu uniquement)
// et nombre d'offres par page de la recherche.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const offers = await qi.describeTable('MarketOffers');
  if (!offers.maxHours) await qi.addColumn('MarketOffers', 'maxHours', { type: DataTypes.INTEGER, allowNull: true });
  if (!offers.tribeOnly) await qi.addColumn('MarketOffers', 'tribeOnly', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  const players = await qi.describeTable('Players');
  if (!players.marketPerPage) await qi.addColumn('Players', 'marketPerPage', { type: DataTypes.INTEGER, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'marketPerPage');
  await qi.removeColumn('MarketOffers', 'tribeOnly');
  await qi.removeColumn('MarketOffers', 'maxHours');
}

module.exports = { up, down };
