'use strict';

// Forum de tribu : réservé aux membres, sous-forums gérés par les modérateurs (duc, baron, droit de modérateur), non-lus, verrouillage, dissolution.

process.env.SQLITE_STORAGE = ':memory:';
process.env.DB_DIALECT = 'sqlite';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Player, TribeForumSection, TribeForumThread, TribeForumPost, TribeForumPoll, TribeForumShare } = require('../src/models');
const AuthService = require('../src/services/AuthService');
const WorldService = require('../src/services/WorldService');
const TribeService = require('../src/services/TribeService');
const TribeForumService = require('../src/services/TribeForumService');
const AccountService = require('../src/services/AccountService');

const T0 = new Date('2026-09-25T10:00:00Z');
const at = (s) => new Date(T0.getTime() + s * 1000);
const u = {};
const p = {};

test.before(async () => {
  await sequelize.sync({ force: true });
  await WorldService.createWorld({ slug: 'w1', name: 'Monde 1', config: {} });
  for (const name of ['Chef', 'Membre', 'Autre']) {
    u[name] = await AuthService.register({ username: name, email: `${name}@example.com`, password: 'motdepasse' });
    ({ player: p[name] } = await WorldService.join(u[name], 'w1'));
  }
  await TribeService.create(p.Chef.id, { name: 'Les Loups', tag: 'LUP' });
  await TribeService.invite(p.Chef.id, 'Membre');
  const [inv] = await TribeService.invitesFor(p.Membre.id);
  await TribeService.acceptInvite(p.Membre.id, inv.id);
});

test.after(() => sequelize.close());

let general;
let thread;

const DEFAULTS = ['Annonces', 'Attaque', 'Défense', 'Taverne', 'Vacances', 'Suggestions'];
const names = async (playerId) => (await TribeForumService.overview(playerId)).sections.map((s) => s.section.name);

test('une nouvelle tribu a ses sous-forums par défaut ; seuls les modérateurs les gèrent', async () => {
  const { sections, manager } = await TribeForumService.overview(p.Membre.id);
  assert.equal(manager, false);
  assert.deepEqual(sections.map((s) => s.section.name), DEFAULTS);
  general = sections.find((s) => s.section.name === 'Taverne').section;
  await assert.rejects(TribeForumService.createSection(p.Membre.id, 'Secret'), /modérateur du forum/);
  const ops = await TribeForumService.createSection(p.Chef.id, 'Opérations');
  await TribeForumService.moveSection(p.Chef.id, ops.id, -1);
  assert.deepEqual(await names(p.Chef.id), [...DEFAULTS.slice(0, 5), 'Opérations', 'Suggestions']);
  await TribeForumService.renameSection(p.Chef.id, ops.id, 'Attaques');
  await TribeForumService.deleteSection(p.Chef.id, ops.id);
  assert.deepEqual(await names(p.Chef.id), DEFAULTS);
});

test('une tribu fondée avant le forum reçoit les sous-forums par défaut à la première visite', async () => {
  const old = await AuthService.register({ username: 'Ancien', email: 'ancien@example.com', password: 'motdepasse' });
  ({ player: p.Ancien } = await WorldService.join(old, 'w1'));
  const tribe = await TribeService.create(p.Ancien.id, { name: 'Les Anciens', tag: 'ANC' });
  await TribeForumSection.destroy({ where: { tribeId: tribe.id } });
  assert.deepEqual(await names(p.Ancien.id), DEFAULTS);
});

test('le dernier sous-forum ne peut pas être supprimé', async () => {
  const sections = (await TribeForumService.overview(p.Ancien.id)).sections.map((x) => x.section);
  for (const s of sections.slice(1)) await TribeForumService.deleteSection(p.Ancien.id, s.id);
  await assert.rejects(TribeForumService.deleteSection(p.Ancien.id, sections[0].id), /au moins un sous-forum/);
});

test("un joueur hors de la tribu n'y a pas accès", async () => {
  await assert.rejects(TribeForumService.overview(p.Autre.id), /aucune tribu/);
  await TribeService.create(p.Autre.id, { name: 'Les Ours', tag: 'OURS' });
  await assert.rejects(TribeForumService.section(p.Autre.id, general.id), /introuvable/);
});

test('sujet, réponse et non-lus', async () => {
  thread = await TribeForumService.createThread(p.Membre.id, general.id, { title: 'Défense de K55', body: 'Qui peut soutenir ?' }, T0);
  assert.equal(await TribeForumService.unreadCount(p.Membre.id), 0, "l'auteur a lu son propre sujet");
  assert.equal(await TribeForumService.unreadCount(p.Chef.id), 1);
  await TribeForumService.thread(p.Chef.id, thread.id, 1, at(10));
  assert.equal(await TribeForumService.unreadCount(p.Chef.id), 0);
  await TribeForumService.reply(p.Chef.id, thread.id, { body: 'J’envoie 500 lanciers.' }, at(20));
  assert.equal(await TribeForumService.unreadCount(p.Membre.id), 1, 'la réponse rend le sujet non lu');
  await assert.rejects(TribeForumService.reply(p.Chef.id, thread.id, { body: 'encore' }, at(25)), /Patiente/);
});

test('verrouillage, épinglage et droits de suppression', async () => {
  await assert.rejects(TribeForumService.setFlag(p.Membre.id, thread.id, 'locked', true), /modérateur du forum/);
  await TribeForumService.setFlag(p.Chef.id, thread.id, 'locked', true);
  await assert.rejects(TribeForumService.reply(p.Membre.id, thread.id, { body: 'Et moi ?' }, at(100)), /verrouillé/);
  await TribeForumService.reply(p.Chef.id, thread.id, { body: 'Les chefs peuvent encore répondre.' }, at(100));

  const { posts, firstPostId } = await TribeForumService.thread(p.Membre.id, thread.id);
  const chefPost = posts.find((x) => x.playerId === p.Chef.id);
  await assert.rejects(TribeForumService.edit(p.Membre.id, chefPost.id, { body: 'x' }), /propres messages/);
  await assert.rejects(TribeForumService.remove(p.Membre.id, chefPost.id), /propres messages/);
  await assert.rejects(TribeForumService.remove(p.Membre.id, firstPostId), /a des réponses/);
  const { threadDeleted } = await TribeForumService.remove(p.Chef.id, chefPost.id);
  assert.equal(threadDeleted, false, 'un chef supprime le message de son choix');
});

test('nouveaux messages, sourdine et marquer comme lu', async () => {
  const taverne = general;
  const vacances = (await TribeForumService.overview(p.Chef.id)).sections.find((x) => x.section.name === 'Vacances').section;
  const a = await TribeForumService.createThread(p.Chef.id, vacances.id, { title: 'Absences', body: 'Vos dates ?' }, at(200));
  const recent = await TribeForumService.recent(p.Membre.id);
  assert.ok(recent.threads.some((x) => x.thread.id === a.id));
  const before = await TribeForumService.unreadCount(p.Membre.id);
  assert.equal(await TribeForumService.toggleMute(p.Membre.id, vacances.id), true);
  assert.equal(await TribeForumService.unreadCount(p.Membre.id), before - 1, 'un forum en sourdine ne compte plus');
  assert.ok(!(await TribeForumService.recent(p.Membre.id)).threads.some((x) => x.thread.id === a.id));
  assert.ok((await TribeForumService.recent(p.Membre.id, { excludeMuted: false })).threads.some((x) => x.thread.id === a.id));
  assert.equal(await TribeForumService.toggleMute(p.Membre.id, vacances.id), false);
  await TribeForumService.markRead(p.Membre.id, taverne.id, at(300));
  await TribeForumService.markRead(p.Membre.id, null, at(300));
  assert.equal(await TribeForumService.unreadCount(p.Membre.id), 0);
});

test('recherche et sondage (un vote par membre, modifiable)', async () => {
  const found = await TribeForumService.search(p.Membre.id, 'SOUTENIR');
  assert.ok(found.some((x) => x.id === thread.id), 'trouvé par le texte des messages');
  assert.ok((await TribeForumService.search(p.Membre.id, 'ABSENCES')).length >= 1, 'trouvé par le titre, sans la casse');
  await assert.rejects(TribeForumService.createThread(p.Chef.id, general.id, { title: 'Sondage', body: 'x', options: 'Oui\nOui' }, at(400)), /au moins 2/);
  const poll = await TribeForumService.createThread(p.Chef.id, general.id, { title: 'On attaque ?', body: 'Votez', options: 'Oui\n Non \n' }, at(400));
  await TribeForumService.vote(p.Membre.id, poll.id, 0);
  await TribeForumService.vote(p.Membre.id, poll.id, 1);
  await TribeForumService.vote(p.Chef.id, poll.id, 1);
  await assert.rejects(TribeForumService.vote(p.Chef.id, poll.id, 5), /Choisis une réponse/);
  const data = await TribeForumService.thread(p.Membre.id, poll.id);
  assert.deepEqual(data.poll.options, ['Oui', 'Non']);
  assert.deepEqual(data.poll.counts, [0, 2]);
  assert.equal(data.poll.mine, 1);
});

test('forum caché : réservé au droit Forum caché (ducs et barons compris)', async () => {
  const annonces = (await TribeForumService.overview(p.Chef.id)).sections.find((s) => s.section.name === 'Annonces').section;
  await assert.rejects(TribeForumService.setHidden(p.Membre.id, annonces.id, true), /modérateur du forum/);
  await TribeForumService.setHidden(p.Chef.id, annonces.id, true);
  const secret = await TribeForumService.createThread(p.Chef.id, annonces.id, { title: 'Plan secret', body: 'Chut' }, at(5000));
  assert.ok(!(await names(p.Membre.id)).includes('Annonces'));
  await assert.rejects(TribeForumService.section(p.Membre.id, annonces.id), /introuvable/);
  await assert.rejects(TribeForumService.thread(p.Membre.id, secret.id), /introuvable/);
  assert.ok(!(await TribeForumService.recent(p.Membre.id)).threads.some((r) => r.thread.id === secret.id));
  assert.equal((await TribeForumService.search(p.Membre.id, 'secret')).length, 0);

  await TribeService.setRights(p.Chef.id, p.Membre.id, { title: 'member', rights: ['hiddenForum'] });
  assert.ok((await names(p.Membre.id)).includes('Annonces'));
  assert.equal((await TribeForumService.thread(p.Membre.id, secret.id)).section.isHidden, true);
  await TribeService.setRights(p.Chef.id, p.Membre.id, { title: 'member', rights: [] });
  await TribeForumService.setHidden(p.Chef.id, annonces.id, false);
  assert.ok((await names(p.Membre.id)).includes('Annonces'));

  // La tribu garde au moins un sous-forum visible de tous.
  const [last] = (await TribeForumService.overview(p.Ancien.id)).sections;
  await assert.rejects(TribeForumService.setHidden(p.Ancien.id, last.section.id, true), /visible de tous/);
});

test('forum partagé : proposé par tag, accepté dans les réglages de l’autre tribu, modéré par la tribu propriétaire', async () => {
  const ours = (await Player.findByPk(p.Autre.id)).tribeId;
  await assert.rejects(TribeForumService.share(p.Chef.id, general.id, 'XXX'), /Aucune tribu/);
  await assert.rejects(TribeForumService.share(p.Chef.id, general.id, 'LUP'), /déjà à ta tribu/);
  const share = await TribeForumService.share(p.Chef.id, general.id, 'OURS');
  await assert.rejects(TribeForumService.share(p.Chef.id, general.id, 'OURS'), /déjà une demande/);
  assert.equal(await TribeForumService.pendingShares(ours), 1);
  const before = await TribeForumService.overview(p.Autre.id);
  assert.equal(before.received.length, 1);
  assert.equal(before.received[0].section.Tribe.tag, 'LUP');
  await assert.rejects(TribeForumService.section(p.Autre.id, general.id), /introuvable/, 'pas avant acceptation');
  await assert.rejects(TribeForumService.answerShare(p.Chef.id, share.id, true), /introuvable/, 'seule la tribu invitée répond');

  await TribeForumService.answerShare(p.Autre.id, share.id, true);
  assert.equal(await TribeForumService.pendingShares(ours), 0);
  const view = await TribeForumService.section(p.Autre.id, general.id);
  assert.equal(view.section.owner.tag, 'LUP');
  assert.equal(view.manager, false, 'les chefs invités ne modèrent pas');
  const guest = await TribeForumService.createThread(p.Autre.id, general.id, { title: 'Bonjour voisins', body: 'Salut LUP' }, at(6000));
  assert.ok((await TribeForumService.recent(p.Chef.id)).threads.some((r) => r.thread.id === guest.id));
  await assert.rejects(TribeForumService.setFlag(p.Autre.id, guest.id, 'pinned', true), /autre tribu/);
  await assert.rejects(TribeForumService.renameSection(p.Autre.id, general.id, 'À nous'), /autre tribu/);
  await TribeForumService.setFlag(p.Chef.id, guest.id, 'locked', true);
  await assert.rejects(TribeForumService.reply(p.Autre.id, guest.id, { body: 'Encore' }, at(6100)), /verrouillé/);

  // La tribu invitée peut en faire un forum caché chez elle, sans effet chez la tribu propriétaire.
  await TribeForumService.setShareHidden(p.Autre.id, share.id, true);
  assert.equal((await TribeForumService.section(p.Autre.id, general.id)).section.isHidden, true);
  assert.equal((await TribeForumService.section(p.Membre.id, general.id)).section.isHidden, false);

  await TribeForumService.leaveShare(p.Autre.id, share.id);
  await assert.rejects(TribeForumService.thread(p.Autre.id, guest.id), /introuvable/);
  const again = await TribeForumService.share(p.Chef.id, general.id, 'OURS');
  await TribeForumService.answerShare(p.Autre.id, again.id, false);
  assert.equal((await TribeForumService.overview(p.Chef.id)).sections.find((s) => s.section.id === general.id).shares.length, 0);
});

test("un joueur qui quitte le monde laisse ses messages ; la dissolution efface le forum", async () => {
  await AccountService.leaveWorld(u.Membre.id, p.Membre.id, 'motdepasse');
  assert.ok(await TribeForumPost.count({ where: { playerId: null } }) >= 1);
  const { posts } = await TribeForumService.thread(p.Chef.id, thread.id);
  assert.equal(posts[0].author, null);

  const chef = await Player.findByPk(p.Chef.id);
  await TribeService.leave(chef.id);
  assert.equal(await TribeForumSection.count({ where: { tribeId: general.tribeId } }), 0);
  assert.equal(await TribeForumThread.count({ where: { id: thread.id } }), 0);
  assert.equal(await TribeForumPoll.count(), 0, 'les sondages partent avec le forum');
  assert.equal(await TribeForumShare.count(), 0, 'les partages partent avec le forum');
});
