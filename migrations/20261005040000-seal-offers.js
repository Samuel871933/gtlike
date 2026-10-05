'use strict';

// Échanges de sceaux comme sur Guerre Tribale : une offre est visible de toute la tribu (SealOffers : sceau proposé,
// sceau demandé du même niveau, nombre), au lieu d'une proposition adressée à un seul membre (SealTrades, retirée).

const { DataTypes } = require('sequelize');

const ref = (model, onDelete = 'CASCADE') => ({ type: DataTypes.INTEGER, allowNull: false, references: { model, key: 'id' }, onDelete, onUpdate: 'CASCADE' });

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('SealOffers')) {
    await qi.createTable('SealOffers', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      worldId: ref('Worlds'),
      tribeId: ref('Tribes'),
      userId: ref('Users'),
      giveType: { type: DataTypes.STRING(12), allowNull: false },
      wantType: { type: DataTypes.STRING(12), allowNull: false },
      level: { type: DataTypes.INTEGER, allowNull: false },
      count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('SealOffers', ['tribeId']);
    await qi.addIndex('SealOffers', ['userId']);
  }
  if (tables.includes('SealTrades')) await qi.dropTable('SealTrades');
}

async function down({ context: qi }) {
  await qi.dropTable('SealOffers');
  const user = ref('Users');
  await qi.createTable('SealTrades', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    worldId: ref('Worlds'), fromUserId: user, toUserId: user,
    giveType: { type: DataTypes.STRING(12), allowNull: false },
    wantType: { type: DataTypes.STRING(12), allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex('SealTrades', ['toUserId']);
  await qi.addIndex('SealTrades', ['fromUserId']);
}

module.exports = { up, down };
