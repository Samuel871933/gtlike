'use strict';

// Matchup (parties compétitives courtes, voir services/MatchService.js) : elo par classement, groupes d'amis, file
// d'attente, parties et leurs joueurs.

const { DataTypes } = require('sequelize');

const id = { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
const stamps = { createdAt: { type: DataTypes.DATE, allowNull: false }, updatedAt: { type: DataTypes.DATE, allowNull: false } };
const ref = (model, allowNull = false) => ({ type: DataTypes.INTEGER, allowNull, references: { model, key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('MatchRatings')) {
    await qi.createTable('MatchRatings', {
      id,
      userId: ref('Users'),
      ladder: { type: DataTypes.STRING(8), allowNull: false },
      elo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1000 },
      games: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      wins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      losses: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      draws: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ...stamps,
    });
    await qi.addIndex('MatchRatings', ['userId', 'ladder'], { unique: true });
    await qi.addIndex('MatchRatings', ['ladder', 'elo']);
  }
  if (!tables.includes('MatchGroups')) {
    await qi.createTable('MatchGroups', {
      id,
      leaderUserId: ref('Users'),
      code: { type: DataTypes.STRING(8), allowNull: false },
      ...stamps,
    });
    await qi.addIndex('MatchGroups', ['code'], { unique: true });
  }
  if (!tables.includes('MatchGroupMembers')) {
    await qi.createTable('MatchGroupMembers', {
      id,
      groupId: ref('MatchGroups'),
      userId: ref('Users'),
      ...stamps,
    });
    await qi.addIndex('MatchGroupMembers', ['userId'], { unique: true });
  }
  if (!tables.includes('MatchQueue')) {
    await qi.createTable('MatchQueue', {
      id,
      format: { type: DataTypes.STRING(4), allowNull: false },
      userIds: { type: DataTypes.JSON, allowNull: false },
      size: { type: DataTypes.INTEGER, allowNull: false },
      rating: { type: DataTypes.INTEGER, allowNull: false },
      queuedAt: { type: DataTypes.DATE, allowNull: false },
      seenAt: { type: DataTypes.DATE, allowNull: false },
      ...stamps,
    });
    await qi.addIndex('MatchQueue', ['format', 'queuedAt']);
  }
  if (!tables.includes('Matches')) {
    await qi.createTable('Matches', {
      id,
      worldId: ref('Worlds'),
      format: { type: DataTypes.STRING(4), allowNull: false },
      ladder: { type: DataTypes.STRING(8), allowNull: false },
      status: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'running' },
      startedAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      endedAt: { type: DataTypes.DATE, allowNull: true },
      winnerTeam: { type: DataTypes.INTEGER, allowNull: true },
      reason: { type: DataTypes.STRING(8), allowNull: true },
      scores: { type: DataTypes.JSON, allowNull: true },
      ...stamps,
    });
    await qi.addIndex('Matches', ['worldId'], { unique: true });
    await qi.addIndex('Matches', ['status']);
  }
  if (!tables.includes('MatchPlayers')) {
    await qi.createTable('MatchPlayers', {
      id,
      matchId: ref('Matches'),
      userId: ref('Users', true),
      playerId: { type: DataTypes.INTEGER, allowNull: false },
      team: { type: DataTypes.INTEGER, allowNull: false },
      eloBefore: { type: DataTypes.INTEGER, allowNull: false },
      eloAfter: { type: DataTypes.INTEGER, allowNull: true },
      forfeitedAt: { type: DataTypes.DATE, allowNull: true },
      ...stamps,
    });
    await qi.addIndex('MatchPlayers', ['matchId']);
    await qi.addIndex('MatchPlayers', ['userId']);
  }
}

async function down({ context: qi }) {
  for (const t of ['MatchPlayers', 'Matches', 'MatchQueue', 'MatchGroupMembers', 'MatchGroups', 'MatchRatings']) await qi.dropTable(t);
}

module.exports = { up, down };
