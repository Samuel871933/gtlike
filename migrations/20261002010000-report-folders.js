'use strict';

// Archives des rapports (premium), comme sur Guerre Tribale : dossiers du joueur (ReportFolders), rapport rangé dans
// un dossier (Reports.folderId, hors de la limite de la boîte) et durée de conservation des archives
// (Players.reportArchiveMonths : 3 mois par défaut, 24 au plus).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('ReportFolders')) {
    await qi.createTable('ReportFolders', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: DataTypes.STRING(32), allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    });
    await qi.addIndex('ReportFolders', ['playerId']);
  }
  const reports = await qi.describeTable('Reports');
  if (!reports.folderId) {
    await qi.addColumn('Reports', 'folderId', {
      type: DataTypes.INTEGER, allowNull: true, references: { model: 'ReportFolders', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE',
    });
    await qi.addIndex('Reports', ['playerId', 'folderId', 'happenedAt'], { name: 'reports_player_id_folder_id_happened_at' });
  }
  const players = await qi.describeTable('Players');
  if (!players.reportArchiveMonths) {
    await qi.addColumn('Players', 'reportArchiveMonths', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 });
  }
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'reportArchiveMonths');
  await qi.removeIndex('Reports', 'reports_player_id_folder_id_happened_at');
  // MySQL : la clé étrangère d'abord.
  if (qi.sequelize.getDialect() === 'mysql') {
    for (const fk of await qi.getForeignKeyReferencesForTable('Reports')) {
      if (fk.columnName === 'folderId') await qi.removeConstraint('Reports', fk.constraintName);
    }
  }
  await qi.removeColumn('Reports', 'folderId');
  await qi.dropTable('ReportFolders');
}

module.exports = { up, down };
