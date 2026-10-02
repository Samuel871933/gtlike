'use strict';

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize } = require('../src/models');
const { createMigrator } = require('../src/migrator');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');

const qi = sequelize.getQueryInterface();

test.after(() => sequelize.close());

test('les migrations créent exactement le schéma des modèles', async () => {
  await qi.dropAllTables();
  await createMigrator().up();

  for (const model of Object.values(sequelize.models)) {
    const table = model.getTableName();
    const columns = Object.keys(await qi.describeTable(table)).sort();
    const expected = Object.values(model.getAttributes()).map((a) => a.field).sort();
    assert.deepEqual(columns, expected, `colonnes de ${table}`);

    const indexes = (await qi.showIndex(table)).map((i) => i.fields.map((f) => f.attribute).join(',')).sort();
    for (const index of model.options.indexes || []) {
      assert.ok(indexes.includes(index.fields.join(',')), `index ${table}(${index.fields})`);
    }
  }

  // Le jeu fonctionne sur la base migrée.
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  const user = await AuthService.register({ username: 'Alice', email: 'a@example.com', password: 'motdepasse' });
  const { village } = await WorldService.join(user, 'w1');
  assert.ok(village.id);
  assert.equal((await createMigrator().pending()).length, 0);

  // Sur la base migrée, un joueur qui a écrit peut être supprimé : ses messages restent, sans auteur.
  const bobUser = await AuthService.register({ username: 'Bob', email: 'b@example.com', password: 'motdepasse' });
  await WorldService.join(bobUser, 'w1');
  const MessageService = require('../src/services/MessageService');
  const AccountService = require('../src/services/AccountService');
  const { Player, ConversationMessage } = require('../src/models');
  const alice = await Player.findOne({ where: { name: 'Alice' } });
  await MessageService.start(alice.id, { to: 'Bob', subject: 'x', body: 'y' });
  await AccountService.deleteAccount(user.id, 'motdepasse');
  const [msg] = await ConversationMessage.findAll();
  assert.equal(msg.playerId, null);
});

test('une base créée avant les migrations (par sync) est reprise sans erreur', async () => {
  await qi.dropAllTables();
  await sequelize.sync();
  const done = await createMigrator().up();
  assert.ok(done.length >= 1, 'la migration initiale est enregistrée');
  assert.equal((await createMigrator().pending()).length, 0);
});

test('une ancienne base à laquelle il manque des colonnes est complétée', async () => {
  await qi.dropAllTables();
  await sequelize.sync();
  await qi.removeColumn('Players', 'tribeRights');
  await qi.removeColumn('Villages', 'grownAt');
  await createMigrator().up();
  assert.ok((await qi.describeTable('Players')).tribeRights);
  assert.ok((await qi.describeTable('Villages')).grownAt);
});

test('suppression du mur : les messages passent dans un sujet verrouillé de la Taverne', async () => {
  await qi.dropAllTables();
  const migrator = createMigrator();
  await migrator.up({ to: '20260929010000-tribe-events.js' });
  // Données en SQL brut : le schéma est celui d'avant les migrations suivantes (les modèles, eux, sont à jour).
  const world = await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  const now = new Date();
  await qi.bulkInsert('Users', [{ username: 'Alice', email: 'a@example.com', passwordHash: 'x', createdAt: now, updatedAt: now }]);
  const [[user]] = await sequelize.query('SELECT id FROM "Users" WHERE username = \'Alice\'');
  await qi.bulkInsert('Players', [{ name: 'Alice', worldId: world.id, userId: user.id, createdAt: now, updatedAt: now }]);
  const [[player]] = await sequelize.query('SELECT id FROM "Players" WHERE name = \'Alice\'');
  await qi.bulkInsert('Tribes', [{ name: 'Les Loups', tag: 'LUP', description: '', worldId: world.id, createdAt: now, updatedAt: now }]);
  const [[tribe]] = await sequelize.query('SELECT id FROM "Tribes" WHERE tag = \'LUP\'');
  await require('../src/services/TribeForumService').createDefaults(tribe.id);
  for (const [i, body] of ['Premier message', 'Second message'].entries()) {
    await qi.bulkInsert('TribeMessages', [{ body, tribeId: tribe.id, playerId: player.id, createdAt: new Date(now.getTime() + i * 1000), updatedAt: now }]);
  }

  await migrator.up();
  assert.ok(!(await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName)).includes('TribeMessages'));
  const { TribeForumThread, TribeForumPost } = require('../src/models');
  const thread = await TribeForumThread.findOne({ where: { title: 'Ancien mur de la tribu' }, include: [{ association: 'section' }] });
  assert.equal(thread.section.name, 'Taverne');
  assert.equal(thread.locked, true);
  assert.equal(thread.postCount, 2);
  const posts = await TribeForumPost.findAll({ where: { threadId: thread.id }, order: [['createdAt', 'ASC']] });
  assert.deepEqual(posts.map((p) => p.body), ['Premier message', 'Second message']);
  assert.equal(thread.lastPostId, posts[1].id);
});
