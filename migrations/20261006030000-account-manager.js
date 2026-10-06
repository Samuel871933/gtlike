'use strict';

// Gestionnaire de compte (premium) : ManagerTemplates (modèles de construction et de troupes du joueur),
// ManagerVillages (modèles appliqués à un village, pauses, prochaine vérification), TradeRoutes (routes commerciales
// du gestionnaire de marché), Players.managerSettings (réserve, notifications d'attaque) et Players.lastSeenAt
// (dernière page vue : notifications « seulement si je ne suis pas connecté »).

const { DataTypes } = require('sequelize');

const ref = (model, { allowNull = false, onDelete = 'CASCADE' } = {}) => ({ type: DataTypes.INTEGER, allowNull, references: { model, key: 'id' }, onDelete, onUpdate: 'CASCADE' });
const id = () => ({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false } });
const ts = () => ({ createdAt: { type: DataTypes.DATE, allowNull: false }, updatedAt: { type: DataTypes.DATE, allowNull: false } });

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('ManagerTemplates')) {
    await qi.createTable('ManagerTemplates', {
      ...id(),
      playerId: ref('Players'),
      kind: { type: DataTypes.STRING(8), allowNull: false },
      name: { type: DataTypes.STRING(32), allowNull: false },
      data: { type: DataTypes.JSON, allowNull: false },
      ...ts(),
    });
    await qi.addIndex('ManagerTemplates', ['playerId']);
  }
  if (!tables.includes('ManagerVillages')) {
    await qi.createTable('ManagerVillages', {
      ...id(),
      villageId: ref('Villages'),
      playerId: ref('Players'),
      buildTemplate: { type: DataTypes.STRING(16), allowNull: true },
      buildPaused: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      troopTemplateId: { type: DataTypes.INTEGER, allowNull: true },
      troops: { type: DataTypes.JSON, allowNull: true },
      troopsPaused: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      reserve: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'both' },
      checkAt: { type: DataTypes.DATE, allowNull: true },
      status: { type: DataTypes.JSON, allowNull: true },
      ...ts(),
    });
    await qi.addIndex('ManagerVillages', ['villageId'], { unique: true });
    await qi.addIndex('ManagerVillages', ['playerId']);
  }
  if (!tables.includes('TradeRoutes')) {
    await qi.createTable('TradeRoutes', {
      ...id(),
      playerId: ref('Players'),
      originVillageId: ref('Villages'),
      targetVillageId: ref('Villages'),
      resources: { type: DataTypes.JSON, allowNull: false },
      days: { type: DataTypes.JSON, allowNull: false },
      minute: { type: DataTypes.INTEGER, allowNull: false },
      nextAt: { type: DataTypes.DATE, allowNull: false },
      lastResult: { type: DataTypes.STRING(120), allowNull: true },
      ...ts(),
    });
    await qi.addIndex('TradeRoutes', ['playerId']);
    await qi.addIndex('TradeRoutes', ['nextAt']);
  }
  const players = await qi.describeTable('Players');
  if (!players.managerSettings) await qi.addColumn('Players', 'managerSettings', { type: DataTypes.JSON, allowNull: true });
  if (!players.lastSeenAt) await qi.addColumn('Players', 'lastSeenAt', { type: DataTypes.DATE, allowNull: true });
}

async function down({ context: qi }) {
  await qi.removeColumn('Players', 'lastSeenAt');
  await qi.removeColumn('Players', 'managerSettings');
  await qi.dropTable('TradeRoutes');
  await qi.dropTable('ManagerVillages');
  await qi.dropTable('ManagerTemplates');
}

module.exports = { up, down };
