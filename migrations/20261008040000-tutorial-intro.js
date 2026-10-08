'use strict';

// Quêtes du tutoriel : date à laquelle le joueur les a ouvertes, ou a fermé la bulle d'accueil qui montre leur bouton
// à son arrivée sur le monde.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const players = await qi.describeTable('Players');
  if (!players.tutorialSeenAt) await qi.addColumn('Players', 'tutorialSeenAt', { type: DataTypes.DATE, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'tutorialSeenAt');
}

module.exports = { up, down };
