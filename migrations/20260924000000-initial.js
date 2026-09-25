'use strict';

// Schéma initial (généré depuis les modèles le 2026-09-24, puis figé).
// Ne jamais modifier cette migration : ajouter une nouvelle migration pour tout changement.
// Bases créées avant les migrations (par sequelize.sync) : les tables présentes sont gardées
// et seules leurs colonnes manquantes sont ajoutées.

const { DataTypes } = require('sequelize');

const TABLES = [
  {
    table: 'Users',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      username: { type: DataTypes.STRING(24), allowNull: false, unique: true },
      email: { type: DataTypes.STRING, allowNull: false, unique: true },
      passwordHash: { type: DataTypes.STRING, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    indexes: [],
  },
  {
    table: 'Worlds',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      slug: { type: DataTypes.STRING(16), allowNull: false, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      isOpen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      config: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    indexes: [],
  },
  {
    table: 'Tribes',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: DataTypes.STRING(32), allowNull: false },
      tag: { type: DataTypes.STRING(6), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['worldId', 'tag'], unique: true },
      { fields: ['worldId', 'name'], unique: true },
    ],
  },
  {
    table: 'Players',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: DataTypes.STRING(24), allowNull: false },
      points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      villageCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      coins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      tribeRole: { type: DataTypes.STRING(8), allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      tribeId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Tribes', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['userId', 'worldId'], unique: true },
    ],
  },
  {
    table: 'Villages',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: DataTypes.STRING(32), allowNull: false },
      x: { type: DataTypes.INTEGER, allowNull: false },
      y: { type: DataTypes.INTEGER, allowNull: false },
      isFirst: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      buildings: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      units: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      wood: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
      stone: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
      iron: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
      resourcesAt: { type: DataTypes.DATE, allowNull: false },
      points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      loyalty: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 100 },
      grownAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      playerId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Players', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['worldId', 'x', 'y'], unique: true },
      { fields: ['playerId'] },
    ],
  },
  {
    table: 'BuildOrders',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      building: { type: DataTypes.STRING(16), allowNull: false },
      level: { type: DataTypes.INTEGER, allowNull: false },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      wood: { type: DataTypes.INTEGER, allowNull: false },
      stone: { type: DataTypes.INTEGER, allowNull: false },
      iron: { type: DataTypes.INTEGER, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      villageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['villageId'] },
      { fields: ['endsAt'] },
    ],
  },
  {
    table: 'RecruitOrders',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      building: { type: DataTypes.STRING(16), allowNull: false },
      unit: { type: DataTypes.STRING(16), allowNull: false },
      count: { type: DataTypes.INTEGER, allowNull: false },
      done: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      unitDurationMs: { type: DataTypes.INTEGER, allowNull: false },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      nextAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      villageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['villageId'] },
      { fields: ['nextAt'] },
    ],
  },
  {
    table: 'Commands',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      type: { type: DataTypes.STRING(8), allowNull: false },
      units: { type: DataTypes.JSON, allowNull: false },
      loot: { type: DataTypes.JSON, allowNull: true },
      catapultTarget: { type: DataTypes.STRING(16), allowNull: true },
      cancelled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      arrivesAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      originVillageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
      targetVillageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['arrivesAt'] },
      { fields: ['originVillageId'] },
      { fields: ['targetVillageId'] },
    ],
  },
  {
    table: 'SupportStacks',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      units: { type: DataTypes.JSON, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      villageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
      originVillageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['villageId', 'originVillageId'], unique: true },
      { fields: ['originVillageId'] },
    ],
  },
  {
    table: 'Reports',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      type: { type: DataTypes.STRING(16), allowNull: false },
      title: { type: DataTypes.STRING, allowNull: false },
      data: { type: DataTypes.JSON, allowNull: false },
      isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      happenedAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['playerId', 'happenedAt'] },
    ],
  },
  {
    table: 'Transports',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      type: { type: DataTypes.STRING(8), allowNull: false },
      resources: { type: DataTypes.JSON, allowNull: false },
      merchants: { type: DataTypes.INTEGER, allowNull: false },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      arrivesAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      originVillageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
      targetVillageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['arrivesAt'] },
      { fields: ['originVillageId'] },
      { fields: ['targetVillageId'] },
    ],
  },
  {
    table: 'MarketOffers',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      sellResource: { type: DataTypes.STRING(8), allowNull: false },
      sellAmount: { type: DataTypes.INTEGER, allowNull: false },
      buyResource: { type: DataTypes.STRING(8), allowNull: false },
      buyAmount: { type: DataTypes.INTEGER, allowNull: false },
      count: { type: DataTypes.INTEGER, allowNull: false },
      merchantsPerOffer: { type: DataTypes.INTEGER, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      villageId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Villages', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['worldId'] },
      { fields: ['villageId'] },
    ],
  },
  {
    table: 'TribeInvites',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      tribeId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Tribes', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['tribeId', 'playerId'], unique: true },
    ],
  },
  {
    table: 'TribeRelations',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      type: { type: DataTypes.STRING(8), allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      tribeId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Tribes', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      otherTribeId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Tribes', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['tribeId', 'otherTribeId'], unique: true },
    ],
  },
  {
    table: 'TribeMessages',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      tribeId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Tribes', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['tribeId', 'createdAt'] },
    ],
  },
  {
    table: 'Conversations',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      subject: { type: DataTypes.STRING(100), allowNull: false },
      lastMessageAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['worldId'] },
    ],
  },
  {
    table: 'ConversationParticipants',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      lastReadAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      conversationId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['conversationId', 'playerId'], unique: true },
      { fields: ['playerId'] },
    ],
  },
  {
    table: 'ConversationMessages',
    columns: {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      conversationId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'NO ACTION', onUpdate: 'CASCADE' },
    },
    indexes: [
      { fields: ['conversationId', 'createdAt'] },
    ],
  },
];

async function up({ context: qi }) {
  const existing = new Set((await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName)));
  for (const { table, columns, indexes } of TABLES) {
    if (existing.has(table)) {
      const present = await qi.describeTable(table);
      for (const [name, def] of Object.entries(columns)) {
        if (present[name]) continue;
        // SQLite refuse d'ajouter une colonne NOT NULL sans valeur par défaut.
        const { references, onDelete, onUpdate, ...plain } = def;
        await qi.addColumn(table, name, { ...plain, allowNull: def.allowNull || def.defaultValue === undefined });
      }
      continue;
    }
    await qi.createTable(table, columns);
    for (const index of indexes) await qi.addIndex(table, index.fields, { unique: Boolean(index.unique) });
  }
}

async function down({ context: qi }) {
  for (const { table } of [...TABLES].reverse()) await qi.dropTable(table);
}

module.exports = { up, down };
