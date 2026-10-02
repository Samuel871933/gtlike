'use strict';

// Forum communautaire : sujets, réponses, anti-flood, droits d'édition et suppression de compte.

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, ForumThread, ForumPost } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const ForumService = require('../src/services/ForumService');
const AccountService = require('../src/services/AccountService');

const T0 = new Date('2026-09-25T10:00:00Z');
const at = (s) => new Date(T0.getTime() + s * 1000);
const u = {};

test.before(async () => {
  await sequelize.sync({ force: true });
  for (const name of ['Alice', 'Bob']) u[name] = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
});

test.after(() => sequelize.close());

test('ouvrir un sujet puis y répondre met à jour la section', async () => {
  await assert.rejects(ForumService.createThread(u.Alice.id, 'inconnue', { title: 'Titre', body: 'x' }, T0), /Section introuvable/);
  await assert.rejects(ForumService.createThread(u.Alice.id, 'general', { title: 'ab', body: 'x' }, T0), /au moins 3/);
  await assert.rejects(ForumService.createThread(u.Alice.id, 'general', { title: 'Titre', body: '   ' }, T0), /vide/);
  const thread = await ForumService.createThread(u.Alice.id, 'general', { title: '  Bonjour   à tous ', body: 'Premier message' }, T0);
  assert.equal(thread.title, 'Bonjour à tous');

  await assert.rejects(ForumService.reply(u.Alice.id, thread.id, { body: 'trop vite' }, at(5)), /Patiente/);
  await ForumService.reply(u.Bob.id, thread.id, { body: 'Salut Alice' }, at(5));
  const data = await ForumService.thread(thread.id);
  assert.equal(data.thread.postCount, 2);
  assert.deepEqual(data.posts.map((p) => p.author.username), ['Alice', 'Bob']);

  const general = (await ForumService.sections()).find((s) => s.id === 'general');
  assert.equal(general.threads, 1);
  assert.equal(general.last.lastPost.author.username, 'Bob');
});

test('chacun ne modifie ou supprime que ses messages ; le premier message part avec le sujet, sans réponse seulement', async () => {
  const thread = await ForumService.createThread(u.Bob.id, 'bugs', { title: 'Un bug', body: 'Description' }, at(100));
  const [first] = (await ForumService.thread(thread.id)).posts;
  await assert.rejects(ForumService.edit(u.Alice.id, first.id, { body: 'piraté' }, at(101)), /propres messages/);
  await ForumService.edit(u.Bob.id, first.id, { body: 'Description corrigée' }, at(101));
  assert.ok((await ForumPost.findByPk(first.id)).editedAt);

  const reply = await ForumService.reply(u.Alice.id, thread.id, { body: 'Moi aussi' }, at(120));
  await assert.rejects(ForumService.remove(u.Bob.id, first.id), /a des réponses/);
  const removed = await ForumService.remove(u.Alice.id, reply.id);
  assert.equal(removed.threadDeleted, false);
  assert.equal((await ForumThread.findByPk(thread.id)).postCount, 1);
  assert.equal((await ForumService.remove(u.Bob.id, first.id)).threadDeleted, true);
  assert.equal(await ForumThread.count({ where: { id: thread.id } }), 0);
});

test('pagination : la dernière page est accessible directement', async () => {
  const thread = await ForumService.createThread(u.Alice.id, 'strategy', { title: 'Long sujet', body: '1' }, at(1000));
  for (let i = 0; i < 24; i += 1) await ForumService.reply(i % 2 ? u.Alice.id : u.Bob.id, thread.id, { body: `r${i}` }, at(1100 + i * 20));
  const last = await ForumService.thread(thread.id, 'last');
  assert.equal(last.pages, 2);
  assert.equal(last.page, 2);
  assert.equal(last.posts.length, 5);
});

test('un compte supprimé laisse ses messages, sans auteur', async () => {
  const before = await ForumPost.count({ where: { userId: u.Bob.id } });
  assert.ok(before > 0);
  await AccountService.deleteAccount(u.Bob.id, 'motdepasse');
  assert.equal(await ForumPost.count({ where: { userId: null } }), before);
  const data = await ForumService.thread((await ForumThread.findOne({ where: { title: 'Bonjour à tous' } })).id);
  assert.equal(data.posts[1].author, null);
});
