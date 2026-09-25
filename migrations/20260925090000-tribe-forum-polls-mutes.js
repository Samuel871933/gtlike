'use strict';

// Forum de tribu : sous-forums mis en sourdine par joueur, sondages et votes.

const { DataTypes } = require('sequelize');

const ts = () => ({
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
});
const id = () => ({ id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false } });
const ref = (model) => ({ type: DataTypes.INTEGER, allowNull: false, references: { model, key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

async function up({ context: qi }) {
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('TribeForumMutes')) {
    await qi.createTable('TribeForumMutes', { ...id(), ...ts(), playerId: ref('Players'), sectionId: ref('TribeForumSections') });
    await qi.addIndex('TribeForumMutes', ['playerId', 'sectionId'], { unique: true });
  }
  if (!tables.includes('TribeForumPolls')) {
    await qi.createTable('TribeForumPolls', {
      ...id(), options: { type: DataTypes.JSON, allowNull: false }, ...ts(), threadId: { ...ref('TribeForumThreads'), unique: true },
    });
  }
  if (!tables.includes('TribeForumVotes')) {
    await qi.createTable('TribeForumVotes', {
      ...id(), option: { type: DataTypes.INTEGER, allowNull: false }, ...ts(), pollId: ref('TribeForumPolls'), playerId: ref('Players'),
    });
    await qi.addIndex('TribeForumVotes', ['pollId', 'playerId'], { unique: true });
  }
}

async function down({ context: qi }) {
  await qi.dropTable('TribeForumVotes');
  await qi.dropTable('TribeForumPolls');
  await qi.dropTable('TribeForumMutes');
}

module.exports = { up, down };
