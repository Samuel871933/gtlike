'use strict';

// Matchup : MMR caché (Glicko : note et incertitude) à côté de l'elo visible, parties de placement, blocage de la file
// après une partie trouvée refusée ou manquée.

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const ratings = await qi.describeTable('MatchRatings');
  if (!ratings.mmr) await qi.addColumn('MatchRatings', 'mmr', { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 1000 });
  if (!ratings.rd) await qi.addColumn('MatchRatings', 'rd', { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 350 });
  if (!ratings.lastPlayedAt) await qi.addColumn('MatchRatings', 'lastPlayedAt', { type: DataTypes.DATE, allowNull: true });
  const players = await qi.describeTable('MatchPlayers');
  if (!players.placement) await qi.addColumn('MatchPlayers', 'placement', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  const users = await qi.describeTable('Users');
  if (!users.matchBlockedUntil) await qi.addColumn('Users', 'matchBlockedUntil', { type: DataTypes.DATE, allowNull: true });
  // Notes déjà jouées : le MMR part de l'elo visible.
  await qi.sequelize.query('UPDATE "MatchRatings" SET mmr = elo WHERE games > 0');
}

async function down({ context: qi }) {
  await qi.removeColumn('MatchRatings', 'mmr');
  await qi.removeColumn('MatchRatings', 'rd');
  await qi.removeColumn('MatchRatings', 'lastPlayedAt');
  await qi.removeColumn('MatchPlayers', 'placement');
  await qi.removeColumn('Users', 'matchBlockedUntil');
}

module.exports = { up, down };
