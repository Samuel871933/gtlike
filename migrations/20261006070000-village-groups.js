'use strict';

// Groupes de villages (comme sur Guerre Tribale) : groupes du joueur, villages de chaque groupe, groupe actif.
// Marquages de carte : couleur facultative et icône d'unité (`icon`), cible « group » (un groupe de ses villages).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('VillageGroups')) {
    await qi.createTable('VillageGroups', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: DataTypes.STRING(32), allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    });
    await qi.addIndex('VillageGroups', ['playerId']);
  }
  if (!tables.includes('VillageGroupMembers')) {
    await qi.createTable('VillageGroupMembers', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      groupId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'VillageGroups', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      villageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    });
    await qi.addIndex('VillageGroupMembers', ['groupId', 'villageId'], { unique: true });
    await qi.addIndex('VillageGroupMembers', ['villageId']);
  }
  const players = await qi.describeTable('Players');
  if (!players.villageGroupId) await qi.addColumn('Players', 'villageGroupId', { type: DataTypes.INTEGER, allowNull: true });
  const markers = await qi.describeTable('MapMarkers');
  if (!markers.icon) await qi.addColumn('MapMarkers', 'icon', { type: DataTypes.STRING(16), allowNull: true });
  if (!markers.color.allowNull) await qi.changeColumn('MapMarkers', 'color', { type: DataTypes.STRING(7), allowNull: true });
  // SQLite refait la table pour changer la colonne, sans ses index : l'index unique est remis s'il manque.
  const indexes = (await qi.showIndex('MapMarkers')).map((i) => i.fields.map((f) => f.attribute).join(','));
  if (!indexes.includes('playerId,targetType,targetId')) await qi.addIndex('MapMarkers', ['playerId', 'targetType', 'targetId'], { unique: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('MapMarkers', 'icon');
  await qi.removeColumn('Players', 'villageGroupId');
  await qi.dropTable('VillageGroupMembers');
  await qi.dropTable('VillageGroups');
}

module.exports = { up, down };
