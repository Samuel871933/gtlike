'use strict';

// Opérations de tribu : TribeOperations (nom, couleur, tribus visées, consignes), TribeOperationTargets (village,
// attaques demandées, troupes, heure d'arrivée et écart entre les attaques) et TribeOperationClaims (une ligne par
// attaque revendiquée : sa place `slot` dans la cible).

const { DataTypes } = require('sequelize');

const ref = (model, { allowNull = false, onDelete = 'CASCADE' } = {}) => ({ type: DataTypes.INTEGER, allowNull, references: { model, key: 'id' }, onDelete, onUpdate: 'CASCADE' });
const id = () => ({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false } });
const ts = () => ({ createdAt: { type: DataTypes.DATE, allowNull: false }, updatedAt: { type: DataTypes.DATE, allowNull: false } });

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('TribeOperations')) {
    await qi.createTable('TribeOperations', {
      ...id(),
      tribeId: ref('Tribes'),
      playerId: ref('Players', { allowNull: true, onDelete: 'SET NULL' }),
      name: { type: DataTypes.STRING(60), allowNull: false },
      color: { type: DataTypes.STRING(7), allowNull: false },
      targetTribeIds: { type: DataTypes.JSON, allowNull: false },
      note: { type: DataTypes.TEXT, allowNull: true },
      ...ts(),
    });
    await qi.addIndex('TribeOperations', ['tribeId']);
  }
  if (!tables.includes('TribeOperationTargets')) {
    await qi.createTable('TribeOperationTargets', {
      ...id(),
      operationId: ref('TribeOperations'),
      villageId: ref('Villages'),
      count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      units: { type: DataTypes.JSON, allowNull: false },
      arrivalAt: { type: DataTypes.DATE, allowNull: true },
      spacing: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      note: { type: DataTypes.STRING(120), allowNull: true },
      ...ts(),
    });
    await qi.addIndex('TribeOperationTargets', ['operationId']);
    await qi.addIndex('TribeOperationTargets', ['villageId']);
  }
  if (!tables.includes('TribeOperationClaims')) {
    await qi.createTable('TribeOperationClaims', {
      ...id(),
      targetId: ref('TribeOperationTargets'),
      playerId: ref('Players'),
      slot: { type: DataTypes.INTEGER, allowNull: false },
      ...ts(),
    });
    await qi.addIndex('TribeOperationClaims', ['targetId', 'slot'], { unique: true });
    await qi.addIndex('TribeOperationClaims', ['playerId']);
  }
}

async function down({ context: qi }) {
  await qi.dropTable('TribeOperationClaims');
  await qi.dropTable('TribeOperationTargets');
  await qi.dropTable('TribeOperations');
}

module.exports = { up, down };
