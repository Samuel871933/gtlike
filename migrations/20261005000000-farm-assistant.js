'use strict';

// Assistant de pillage (premium) : modèles d'armée favoris (ArmyTemplates.favorite, emplacement 1 à 3), village d'où
// partait la dernière attaque (LastAttacks.originVillageId), lignes par page et filtres du joueur
// (Players.farmPerPage, Players.farmSettings).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const templates = await qi.describeTable('ArmyTemplates');
  if (!templates.favorite) await qi.addColumn('ArmyTemplates', 'favorite', { type: DataTypes.INTEGER, allowNull: true });
  const attacks = await qi.describeTable('LastAttacks');
  if (!attacks.originVillageId) await qi.addColumn('LastAttacks', 'originVillageId', { type: DataTypes.INTEGER, allowNull: true });
  const players = await qi.describeTable('Players');
  if (!players.farmPerPage) await qi.addColumn('Players', 'farmPerPage', { type: DataTypes.INTEGER, allowNull: true });
  if (!players.farmSettings) await qi.addColumn('Players', 'farmSettings', { type: DataTypes.JSON, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'farmSettings');
  await qi.removeColumn('Players', 'farmPerPage');
  await qi.removeColumn('LastAttacks', 'originVillageId');
  await qi.removeColumn('ArmyTemplates', 'favorite');
}

module.exports = { up, down };
