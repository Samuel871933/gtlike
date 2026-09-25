'use strict';

// Forum interne des tribus : sous-forums, sujets, messages et lectures (marqueur « Nouveau »).

const { DataTypes } = require('sequelize');

const ts = () => ({
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
});
const id = () => ({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false } });
const ref = (model, allowNull, onDelete) => ({ type: DataTypes.INTEGER, allowNull, references: { model, key: 'id' }, onDelete, onUpdate: 'CASCADE' });

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('TribeForumSections')) {
    await qi.createTable('TribeForumSections', {
      ...id(),
      name: { type: DataTypes.STRING(40), allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ...ts(),
      tribeId: ref('Tribes', false, 'CASCADE'),
    });
    await qi.addIndex('TribeForumSections', ['tribeId', 'position']);
  }
  if (!tables.includes('TribeForumThreads')) {
    await qi.createTable('TribeForumThreads', {
      ...id(),
      title: { type: DataTypes.STRING(80), allowNull: false },
      pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      postCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastPostAt: { type: DataTypes.DATE, allowNull: false },
      lastPostId: { type: DataTypes.INTEGER, allowNull: true },
      ...ts(),
      sectionId: ref('TribeForumSections', false, 'CASCADE'),
      playerId: ref('Players', true, 'SET NULL'),
    });
    await qi.addIndex('TribeForumThreads', ['sectionId', 'lastPostAt']);
  }
  if (!tables.includes('TribeForumPosts')) {
    await qi.createTable('TribeForumPosts', {
      ...id(),
      body: { type: DataTypes.TEXT, allowNull: false },
      editedAt: { type: DataTypes.DATE, allowNull: true },
      ...ts(),
      threadId: ref('TribeForumThreads', false, 'CASCADE'),
      playerId: ref('Players', true, 'SET NULL'),
    });
    await qi.addIndex('TribeForumPosts', ['threadId', 'createdAt']);
    await qi.addIndex('TribeForumPosts', ['playerId', 'createdAt']);
  }
  if (!tables.includes('TribeForumReads')) {
    await qi.createTable('TribeForumReads', {
      ...id(),
      readAt: { type: DataTypes.DATE, allowNull: false },
      ...ts(),
      threadId: ref('TribeForumThreads', false, 'CASCADE'),
      playerId: ref('Players', false, 'CASCADE'),
    });
    await qi.addIndex('TribeForumReads', ['playerId', 'threadId'], { unique: true });
  }
}

async function down({ context: qi }) {
  await qi.dropTable('TribeForumReads');
  await qi.dropTable('TribeForumPosts');
  await qi.dropTable('TribeForumThreads');
  await qi.dropTable('TribeForumSections');
}

module.exports = { up, down };
