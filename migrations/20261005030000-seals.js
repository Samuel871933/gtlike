'use strict';

// Sceaux (les « drapeaux » de Guerre Tribale, module features.seals) : sceaux de chaque compte (Seals), historique
// (SealEvents), échanges en tribu (SealTrades) et sceau posé sur chaque village (Villages.sealType, sealLevel, sealAt).

const { DataTypes } = require('sequelize');

const user = { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' };
const stamps = () => ({ createdAt: { type: DataTypes.DATE, allowNull: false }, updatedAt: { type: DataTypes.DATE, allowNull: false } });
const id = () => ({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false } });

async function up({ context: qi }) {
  const villages = await qi.describeTable('Villages');
  if (!villages.sealType) await qi.addColumn('Villages', 'sealType', { type: DataTypes.STRING(12), allowNull: true });
  if (!villages.sealLevel) await qi.addColumn('Villages', 'sealLevel', { type: DataTypes.INTEGER, allowNull: true });
  if (!villages.sealAt) await qi.addColumn('Villages', 'sealAt', { type: DataTypes.DATE, allowNull: true });
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('Seals')) {
    await qi.createTable('Seals', {
      ...id(), userId: user,
      type: { type: DataTypes.STRING(12), allowNull: false },
      level: { type: DataTypes.INTEGER, allowNull: false },
      count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ...stamps(),
    });
    await qi.addIndex('Seals', ['userId', 'type', 'level'], { unique: true });
  }
  if (!tables.includes('SealEvents')) {
    await qi.createTable('SealEvents', {
      ...id(), userId: user,
      worldId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Worlds', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      type: { type: DataTypes.STRING(12), allowNull: false },
      level: { type: DataTypes.INTEGER, allowNull: false },
      source: { type: DataTypes.STRING(12), allowNull: false },
      detail: { type: DataTypes.STRING(160), allowNull: true },
      ...stamps(),
    });
    await qi.addIndex('SealEvents', ['userId', 'createdAt']);
  }
  if (!tables.includes('SealTrades')) {
    await qi.createTable('SealTrades', {
      ...id(),
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      fromUserId: user, toUserId: user,
      giveType: { type: DataTypes.STRING(12), allowNull: false },
      wantType: { type: DataTypes.STRING(12), allowNull: false },
      level: { type: DataTypes.INTEGER, allowNull: false },
      ...stamps(),
    });
    await qi.addIndex('SealTrades', ['toUserId']);
    await qi.addIndex('SealTrades', ['fromUserId']);
  }
}

async function down({ context: qi }) {
  await qi.dropTable('SealTrades');
  await qi.dropTable('SealEvents');
  await qi.dropTable('Seals');
  await qi.removeColumn('Villages', 'sealAt');
  await qi.removeColumn('Villages', 'sealLevel');
  await qi.removeColumn('Villages', 'sealType');
}

module.exports = { up, down };
