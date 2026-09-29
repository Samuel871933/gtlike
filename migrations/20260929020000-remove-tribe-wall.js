'use strict';

// Suppression du mur des tribus (comme sur GT : annonces internes sur l'aperçu, discussions au forum).
// Les messages existants ne sont pas perdus : chaque tribu les retrouve dans un sujet verrouillé
// « Ancien mur de la tribu » de son sous-forum Taverne (ou du premier sous-forum).

const { DataTypes } = require('sequelize');

const TITLE = 'Ancien mur de la tribu';

async function up({ context: qi }) {
  const { sequelize } = qi;
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('TribeMessages')) return;

  const [messages] = await sequelize.query('SELECT id, body, "createdAt", "tribeId", "playerId" FROM "TribeMessages" ORDER BY "createdAt" ASC, id ASC');
  const byTribe = new Map();
  for (const m of messages) byTribe.set(m.tribeId, [...(byTribe.get(m.tribeId) || []), m]);

  for (const [tribeId, list] of byTribe) {
    const [sections] = await sequelize.query(
      'SELECT id, name FROM "TribeForumSections" WHERE "tribeId" = :tribeId ORDER BY position ASC, id ASC',
      { replacements: { tribeId } },
    );
    const section = sections.find((s) => s.name === 'Taverne') || sections[0];
    if (!section) continue;
    const first = list[0];
    const last = list[list.length - 1];
    const now = new Date();
    await qi.bulkInsert('TribeForumThreads', [{
      title: TITLE, pinned: false, locked: true, postCount: list.length, lastPostAt: new Date(last.createdAt), lastPostId: null,
      createdAt: new Date(first.createdAt), updatedAt: now, sectionId: section.id, playerId: first.playerId,
    }]);
    const [[thread]] = await sequelize.query(
      'SELECT id FROM "TribeForumThreads" WHERE "sectionId" = :sectionId AND title = :title ORDER BY id DESC LIMIT 1',
      { replacements: { sectionId: section.id, title: TITLE } },
    );
    await qi.bulkInsert('TribeForumPosts', list.map((m) => ({
      body: m.body, editedAt: null, createdAt: new Date(m.createdAt), updatedAt: now, threadId: thread.id, playerId: m.playerId,
    })));
    const [[lastPost]] = await sequelize.query(
      'SELECT id FROM "TribeForumPosts" WHERE "threadId" = :threadId ORDER BY "createdAt" DESC, id DESC LIMIT 1',
      { replacements: { threadId: thread.id } },
    );
    await sequelize.query('UPDATE "TribeForumThreads" SET "lastPostId" = :postId WHERE id = :threadId', { replacements: { postId: lastPost.id, threadId: thread.id } });
  }
  await qi.dropTable('TribeMessages');
}

async function down({ context: qi }) {
  await qi.createTable('TribeMessages', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
    tribeId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Tribes', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    playerId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Players', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
  });
  await qi.addIndex('TribeMessages', ['tribeId', 'createdAt']);
}

module.exports = { up, down };
