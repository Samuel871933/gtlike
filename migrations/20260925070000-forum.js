'use strict';

// Forum communautaire : sujets par section et messages (les messages d'un compte supprimé restent, sans auteur).

const { DataTypes } = require('sequelize');

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('ForumThreads')) {
    await qi.createTable('ForumThreads', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      section: { type: DataTypes.STRING(24), allowNull: false },
      title: { type: DataTypes.STRING(80), allowNull: false },
      postCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastPostAt: { type: DataTypes.DATE, allowNull: false },
      lastPostId: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
    });
    await qi.addIndex('ForumThreads', ['section', 'lastPostAt']);
  }
  if (!tables.includes('ForumPosts')) {
    await qi.createTable('ForumPosts', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: false },
      editedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      threadId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'ForumThreads', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
    });
    await qi.addIndex('ForumPosts', ['threadId', 'createdAt']);
    await qi.addIndex('ForumPosts', ['userId', 'createdAt']);
  }
}

async function down({ context: qi }) {
  await qi.dropTable('ForumPosts');
  await qi.dropTable('ForumThreads');
}

module.exports = { up, down };
