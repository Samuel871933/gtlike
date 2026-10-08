'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize, User, World, Player, Village, Tribe, Report, MatchRating, MatchGroup, MatchGroupMember, MatchQueue, MatchProposal, Match, MatchPlayer,
} = require('../models');
const GameError = require('./GameError');
const WorldService = require('./WorldService');
const mu = require('../game/matchup');

// Entrée de la file retirée quand plus personne n'a ouvert la page du matchup depuis ce délai (la page se signale
// toutes les quelques secondes) : on ne lance pas de partie pour un joueur parti.
const QUEUE_STALE_MS = 60000;
// Partie trouvée : chaque joueur a ce délai pour l'accepter (comme sur League of Legends), sinon elle est annulée.
const ACCEPT_MS = 15000;
// Partie trouvée refusée ou manquée : plus de recherche pendant ce délai (contre les joueurs absents).
const DODGE_BLOCK_MS = 2 * 60000;
const MAX_GROUP = 5;
// Croissance des barbares des parties en cours : toutes les 20 s.
const BARBARIAN_EVERY_MS = 20000;
let lastBarbarianGrowth = 0;
// Code d'un groupe : sans caractères ambigus (0/O, 1/I).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (n = 6) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

/** Comptes d'une partie trouvée (toutes équipes). */
const proposalUsers = (proposal) => proposal.teams.flat().flatMap((e) => e.userIds);

/**
 * Matchup : parties compétitives courtes (voir game/matchup.js). Les joueurs entrent dans la file seuls ou en groupe ;
 * la boucle de jeu (tick) forme les parties, crée leur monde, puis surveille la conquête et le temps et met l'elo à jour.
 */
class MatchService {
  // ------------------------------------------------------------------------------------------------------ Elo

  /** Elo d'un compte dans un classement (créé à 1000 au premier besoin). */
  static async rating(userId, ladder, t) {
    const [row] = await MatchRating.findOrCreate({ where: { userId, ladder }, defaults: { elo: mu.START_ELO }, transaction: t });
    return row;
  }

  /** Elo et ligue d'un compte dans chaque classement : { duel: {...}, team: {...} }. */
  static async ratingsOf(userId) {
    const rows = userId ? await MatchRating.findAll({ where: { userId } }) : [];
    return Object.fromEntries(Object.keys(mu.LADDERS).map((ladder) => {
      const r = rows.find((x) => x.ladder === ladder);
      const plain = r ? r.get({ plain: true }) : { ladder, elo: mu.START_ELO, games: 0, wins: 0, losses: 0, draws: 0 };
      return [ladder, { ...plain, rank: mu.leagueOf(plain.elo, plain.games) }];
    }));
  }

  /**
   * Classement d'un ladder : comptes placés (au moins PLACEMENT_GAMES parties), elo décroissant, une page de `limit`
   * lignes à partir de `offset` ; `total` : nombre de comptes classés.
   */
  static async leaderboard(ladder, { offset = 0, limit = 50 } = {}) {
    const where = { ladder, games: { [Op.gte]: mu.PLACEMENT_GAMES } };
    const [rows, total] = await Promise.all([
      MatchRating.findAll({
        where, include: [{ model: User, attributes: ['id', 'username'] }],
        order: [['elo', 'DESC'], ['games', 'DESC'], ['id', 'ASC']], offset, limit,
      }),
      MatchRating.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r, i) => ({
        position: offset + i + 1, user: r.User, elo: r.elo, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, rank: mu.leagueOf(r.elo, r.games),
      })),
    };
  }

  /** Comptes classés dans chaque ligue d'un ladder : Map(id de ligue → nombre). */
  static async leagueCounts(ladder) {
    const counts = new Map();
    for (const [i, league] of mu.LEAGUES.entries()) {
      const next = mu.LEAGUES[i + 1];
      const elo = next ? { [Op.gte]: league.min, [Op.lt]: next.min } : { [Op.gte]: league.min };
      counts.set(league.id, await MatchRating.count({ where: { ladder, games: { [Op.gte]: mu.PLACEMENT_GAMES }, elo } }));
    }
    return counts;
  }

  /** Place d'un compte dans un ladder (1 = premier), ou null s'il n'est pas encore classé (placement). */
  static async positionOf(userId, ladder) {
    const mine = await MatchRating.findOne({ where: { userId, ladder } });
    if (!mine || mine.games < mu.PLACEMENT_GAMES) return null;
    // Même ordre que le classement : elo, puis parties jouées, puis ancienneté.
    const ahead = await MatchRating.count({
      where: {
        ladder, games: { [Op.gte]: mu.PLACEMENT_GAMES },
        [Op.or]: [
          { elo: { [Op.gt]: mine.elo } },
          { elo: mine.elo, games: { [Op.gt]: mine.games } },
          { elo: mine.elo, games: mine.games, id: { [Op.lt]: mine.id } },
        ],
      },
    });
    return ahead + 1;
  }

  // ---------------------------------------------------------------------------------------------------- Groupes

  /** Groupe du compte avec ses membres (comptes) ou null. */
  static async groupOf(userId, t) {
    const member = await MatchGroupMember.findOne({ where: { userId }, transaction: t });
    if (!member) return null;
    return MatchGroup.findByPk(member.groupId, {
      include: [{ model: MatchGroupMember, as: 'members', include: [{ model: User, attributes: ['id', 'username'] }] }],
      order: [[{ model: MatchGroupMember, as: 'members' }, 'id', 'ASC']],
      transaction: t,
    });
  }

  static async createGroup(user) {
    return sequelize.transaction(async (t) => {
      if (await MatchGroupMember.findOne({ where: { userId: user.id }, transaction: t })) throw new GameError('Tu es déjà dans un groupe.');
      await MatchService.assertIdle(user.id, t);
      let code = newCode();
      while (await MatchGroup.findOne({ where: { code }, transaction: t })) code = newCode();
      const group = await MatchGroup.create({ leaderUserId: user.id, code }, { transaction: t });
      await MatchGroupMember.create({ groupId: group.id, userId: user.id }, { transaction: t });
      return group;
    });
  }

  static async joinGroup(user, code) {
    return sequelize.transaction(async (t) => {
      const group = await MatchGroup.findOne({ where: { code: String(code || '').trim().toUpperCase() }, transaction: t, lock: t.LOCK.UPDATE });
      if (!group) throw new GameError('Aucun groupe avec ce code.');
      if (await MatchGroupMember.findOne({ where: { userId: user.id }, transaction: t })) throw new GameError('Quitte d’abord ton groupe actuel.');
      await MatchService.assertIdle(user.id, t);
      if ((await MatchGroupMember.count({ where: { groupId: group.id }, transaction: t })) >= MAX_GROUP) throw new GameError(`Ce groupe est complet (${MAX_GROUP} joueurs).`);
      // La composition change : la recherche en cours du groupe s'arrête.
      await MatchService.dropEntriesOf([group.leaderUserId], t);
      await MatchGroupMember.create({ groupId: group.id, userId: user.id }, { transaction: t });
      return group;
    });
  }

  /** Quitter son groupe ; le chef qui part dissout le groupe. */
  static async leaveGroup(user) {
    return sequelize.transaction(async (t) => {
      const member = await MatchGroupMember.findOne({ where: { userId: user.id }, transaction: t });
      if (!member) throw new GameError('Tu n’es dans aucun groupe.');
      const group = await MatchGroup.findByPk(member.groupId, { transaction: t });
      await MatchService.dropEntriesOf([group.leaderUserId, user.id], t);
      if (group.leaderUserId === user.id) {
        await MatchGroupMember.destroy({ where: { groupId: group.id }, transaction: t });
        await group.destroy({ transaction: t });
      } else {
        await member.destroy({ transaction: t });
      }
    });
  }

  // ----------------------------------------------------------------------------------------------------- File

  /** Entrée de la file qui contient ce compte (la file est courte : lue en entier). */
  static async entryOf(userId, t) {
    const entries = await MatchQueue.findAll({ transaction: t });
    return entries.find((e) => e.userIds.includes(userId)) || null;
  }

  static async dropEntriesOf(userIds, t) {
    const entries = await MatchQueue.findAll({ transaction: t });
    const ids = entries.filter((e) => e.userIds.some((u) => userIds.includes(u))).map((e) => e.id);
    if (ids.length) await MatchQueue.destroy({ where: { id: ids }, transaction: t });
  }

  /** Partie en cours du compte (MatchPlayer avec sa partie et son monde) ou null. */
  static async runningOf(userId, t) {
    return MatchPlayer.findOne({
      where: { userId },
      include: [{ model: Match, where: { status: 'running' }, include: [{ model: World, attributes: ['id', 'slug', 'name', 'access', 'endedAt'] }] }],
      transaction: t,
    });
  }

  /** Partie trouvée en attente d'acceptation qui concerne ce compte (il y en a peu : lues en entier), ou null. */
  static async proposalOf(userId, t) {
    const proposals = await MatchProposal.findAll({ transaction: t });
    return proposals.find((p) => proposalUsers(p).includes(userId)) || null;
  }

  /** Ni dans la file, ni devant une partie à accepter, ni en partie : sinon erreur. */
  static async assertIdle(userId, t) {
    if (await MatchService.runningOf(userId, t)) throw new GameError('Tu as une partie en cours : termine-la d’abord.');
    if (await MatchService.entryOf(userId, t)) throw new GameError('Tu es déjà dans la file d’attente.');
    if (await MatchService.proposalOf(userId, t)) throw new GameError('Une partie t’attend : accepte-la ou refuse-la.');
  }

  /** Entrer dans la file pour un format, seul ou avec son groupe (le chef seulement). */
  static async enqueue(user, format, now = new Date()) {
    if (!mu.isFormat(format)) throw new GameError('Format inconnu.');
    return sequelize.transaction(async (t) => {
      const group = await MatchService.groupOf(user.id, t);
      if (group && group.leaderUserId !== user.id) throw new GameError('Seul le chef du groupe lance la recherche.');
      const userIds = group ? group.members.map((m) => m.userId) : [user.id];
      if (userIds.length > mu.FORMATS[format]) throw new GameError(`Ton groupe compte ${userIds.length} joueurs : choisis un format d’au moins ${userIds.length}v${userIds.length}.`);
      for (const id of userIds) await MatchService.assertIdle(id, t);
      // Refus ou absence récents (soi ou un membre du groupe) : file bloquée quelques minutes.
      const blocked = await User.findOne({ where: { id: userIds, matchBlockedUntil: { [Op.gt]: now } }, transaction: t });
      if (blocked) {
        const left = Math.ceil((blocked.matchBlockedUntil - now) / 1000);
        const who = blocked.id === user.id ? 'Tu as' : `${blocked.username} a`;
        throw new GameError(`${who} refusé ou manqué une partie trouvée : recherche possible dans ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s.`);
      }
      // Matchmaking sur le MMR caché (voir game/matchup.js), pas sur l'elo visible.
      const ladder = mu.ladderOf(format);
      const elos = [];
      for (const id of userIds) elos.push((await MatchService.rating(id, ladder, t)).mmr);
      return MatchQueue.create({
        format, userIds, size: userIds.length, rating: Math.round(mu.average(elos)), queuedAt: now, seenAt: now,
      }, { transaction: t });
    });
  }

  /** Quitter la file (n'importe quel membre du groupe arrête la recherche du groupe) ; devant une partie trouvée : la refuser. */
  static async cancel(user, now = new Date()) {
    if (await MatchService.proposalOf(user.id)) return MatchService.decline(user, now);
    await sequelize.transaction((t) => MatchService.dropEntriesOf([user.id], t));
  }

  /**
   * État du matchup pour un compte (la page le relit toutes les quelques secondes, ce qui garde son entrée dans la
   * file) : { queue, match, group }.
   */
  static async status(userId, now = new Date()) {
    const [entry, found, group, proposal] = await Promise.all([
      MatchService.entryOf(userId), MatchService.runningOf(userId), MatchService.groupOf(userId), MatchService.proposalOf(userId),
    ]);
    // Partie dont le temps est écoulé (ou conquise) : terminée ici, sans attendre la boucle de jeu.
    const running = found && !(await MatchService.endedFor(found.Match.World, now)) ? found : null;
    if (entry) await entry.update({ seenAt: now }, { silent: true });
    return {
      queue: entry ? { format: entry.format, queuedAt: entry.queuedAt, size: entry.size, rating: entry.rating } : null,
      // Partie trouvée à accepter : échéance, son propre choix, nombre de joueurs qui ont accepté.
      proposal: proposal ? {
        id: proposal.id, format: proposal.format, expiresAt: proposal.expiresAt, durationMs: ACCEPT_MS, accepted: proposal.accepted.includes(userId),
        acceptedCount: proposal.accepted.length, total: proposalUsers(proposal).length,
      } : null,
      match: running ? {
        id: running.Match.id, format: running.Match.format, endsAt: running.Match.endsAt, team: running.team,
        slug: running.Match.World.slug, url: `/worlds/${encodeURIComponent(running.Match.World.slug)}/play`,
      } : null,
      group: group ? {
        code: group.code, leaderUserId: group.leaderUserId,
        members: group.members.map((m) => ({ id: m.userId, username: m.User ? m.User.username : '?' })),
      } : null,
    };
  }

  // ---------------------------------------------------------------------------------------------- Matchmaking

  /**
   * Forme toutes les parties possibles (après avoir retiré les entrées sans nouvelles) : chacune devient une partie
   * trouvée, à accepter par tous ses joueurs (accept). Renvoie les propositions créées.
   */
  static async matchmake(now = new Date()) {
    await MatchQueue.destroy({ where: { seenAt: { [Op.lt]: new Date(now - QUEUE_STALE_MS) } } });
    const created = [];
    for (const format of Object.keys(mu.FORMATS)) {
      for (;;) {
        const entries = await MatchQueue.findAll({ where: { format }, order: [['queuedAt', 'ASC'], ['id', 'ASC']] });
        const found = mu.formMatch(entries, mu.FORMATS[format], now);
        if (!found) break;
        const proposal = await MatchService.propose(format, found.teams, now).catch((err) => {
          // Entrée retirée entre-temps (annulation) : on retentera au prochain tour.
          if (err instanceof GameError) return null;
          throw err;
        });
        if (!proposal) break;
        created.push(proposal);
      }
    }
    return created;
  }

  /** Partie trouvée : les entrées quittent la file et attendent l'acceptation de chacun pendant ACCEPT_MS. */
  static async propose(format, teams, now = new Date()) {
    return sequelize.transaction(async (t) => {
      const entryIds = teams.flat().map((e) => e.id);
      if ((await MatchQueue.destroy({ where: { id: entryIds }, transaction: t })) !== entryIds.length) {
        throw new GameError('File modifiée pendant la création de la partie.');
      }
      const plain = teams.map((team) => team.map((e) => ({ userIds: e.userIds, size: e.size, rating: e.rating, queuedAt: e.queuedAt })));
      return MatchProposal.create({ format, teams: plain, accepted: [], expiresAt: new Date(now.getTime() + ACCEPT_MS) }, { transaction: t });
    });
  }

  /** Accepter la partie trouvée ; quand tous ont accepté, la partie est créée (renvoie alors la partie). */
  static async accept(user, now = new Date()) {
    return sequelize.transaction(async (t) => {
      const found = await MatchService.proposalOf(user.id, t);
      if (!found) throw new GameError('Aucune partie à accepter.');
      const proposal = await MatchProposal.findByPk(found.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!proposal) throw new GameError('Cette partie a été annulée.');
      if (now > proposal.expiresAt) throw new GameError('Trop tard : la partie a été annulée.');
      if (!proposal.accepted.includes(user.id)) await proposal.update({ accepted: [...proposal.accepted, user.id] }, { transaction: t });
      if (proposal.accepted.length < proposalUsers(proposal).length) return null;
      await proposal.destroy({ transaction: t });
      return MatchService.createMatch(proposal.format, proposal.teams, now, t);
    });
  }

  /** Refuser la partie trouvée : elle est annulée tout de suite (les autres retournent dans la file). */
  static async decline(user, now = new Date()) {
    const proposal = await MatchService.proposalOf(user.id);
    if (!proposal) throw new GameError('Aucune partie à refuser.');
    await MatchService.cancelProposal(proposal.id, now, { declined: user.id });
  }

  /**
   * Partie trouvée annulée. Refus (`declined`) : tous les autres retournent dans la file à leur place d'origine, le
   * groupe de celui qui refuse en sort. Délai écoulé : seuls les groupes dont tous ont accepté y retournent. Ceux qui
   * ont refusé ou n'ont pas répondu ne peuvent plus chercher pendant DODGE_BLOCK_MS.
   */
  static async cancelProposal(proposalId, now = new Date(), { declined = null } = {}) {
    await sequelize.transaction(async (t) => {
      const proposal = await MatchProposal.findByPk(proposalId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!proposal) return;
      const blamed = declined ? [declined] : proposalUsers(proposal).filter((u) => !proposal.accepted.includes(u));
      if (blamed.length) await User.update({ matchBlockedUntil: new Date(now.getTime() + DODGE_BLOCK_MS) }, { where: { id: blamed }, transaction: t });
      for (const entry of proposal.teams.flat()) {
        if (entry.userIds.some((u) => blamed.includes(u))) continue;
        await MatchQueue.create({
          format: proposal.format, userIds: entry.userIds, size: entry.size, rating: entry.rating, queuedAt: entry.queuedAt, seenAt: now,
        }, { transaction: t });
      }
      await proposal.destroy({ transaction: t });
    });
  }

  /** Parties trouvées dont le délai d'acceptation est écoulé : annulées. */
  static async expireProposals(now = new Date()) {
    for (const p of await MatchProposal.findAll({ where: { expiresAt: { [Op.lt]: now } } })) await MatchService.cancelProposal(p.id, now);
  }

  /**
   * Crée la partie : son monde, une tribu par équipe, le village de départ de chaque joueur et ses barbares.
   * `teams` : deux listes d'entrées ({ userIds }) ; dans la transaction `tx` si elle est donnée.
   */
  static async createMatch(format, teams, now = new Date(), tx = null) {
    const run = (fn) => (tx ? fn(tx) : sequelize.transaction(fn));
    return run(async (t) => {
      let slug = `m${newCode(7).toLowerCase()}`;
      while (await World.findOne({ where: { slug }, transaction: t })) slug = `m${newCode(7).toLowerCase()}`;
      const world = await World.create({
        slug, name: `Matchup ${format} · ${slug.slice(1).toUpperCase()}`, isOpen: false, access: 'match', config: mu.worldConfig(),
      }, { transaction: t });
      const match = await Match.create({
        worldId: world.id, format, ladder: mu.ladderOf(format), startedAt: now, endsAt: new Date(now.getTime() + mu.MATCH_MINUTES * 60000),
      }, { transaction: t });

      // Joueurs (et tribu de chaque équipe), puis leurs villages dans un ordre au hasard.
      const seats = [];
      for (const [i, entries] of teams.entries()) {
        const meta = mu.TEAMS[i];
        const tribe = await Tribe.create({ worldId: world.id, name: meta.name, tag: meta.tag }, { transaction: t });
        const userIds = entries.flatMap((e) => e.userIds);
        const users = await User.findAll({ where: { id: userIds }, transaction: t });
        for (const [slot, userId] of userIds.entries()) {
          const user = users.find((u) => u.id === userId);
          const player = await Player.create({
            userId, worldId: world.id, name: user.username, tribeId: tribe.id, tribeRole: slot === 0 ? 'duke' : 'member', tribeJoinedAt: now,
          }, { transaction: t });
          seats.push(player);
          const rating = await MatchService.rating(userId, match.ladder, t);
          await MatchPlayer.create({ matchId: match.id, userId, playerId: player.id, team: meta.n, eloBefore: rating.elo }, { transaction: t });
        }
      }
      // Placement du mode normal (au hasard autour du centre, barbares autour de chaque joueur), avec un écart minimal
      // entre joueurs pour qu'aucun ne soit écrasé dès les premières minutes.
      for (let i = seats.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seats[i], seats[j]] = [seats[j], seats[i]];
      }
      for (const player of seats) {
        await WorldService.settle(world, player, { now, rng: Math.random, minPlayerDistance: mu.MIN_PLAYER_DISTANCE }, t);
      }
      return match;
    });
  }

  // ------------------------------------------------------------------------------------------- Fin de partie

  /** Parties en cours : conquête (une équipe n'a plus de village), abandon de toute une équipe, ou fin du temps. */
  static async checkRunning(now = new Date()) {
    const ended = [];
    for (const match of await Match.findAll({ where: { status: 'running' }, include: [{ model: MatchPlayer, as: 'players' }] })) {
      const outcome = await MatchService.outcome(match, now);
      if (outcome) ended.push(await MatchService.finish(match.id, outcome, now));
    }
    return ended.filter(Boolean);
  }

  /** Issue d'une partie à cet instant : { winnerTeam (null : égalité), reason, scores } ou null (elle continue). */
  static async outcome(match, now) {
    const byTeam = (n) => match.players.filter((p) => p.team === n);
    const [one, two] = [byTeam(1), byTeam(2)];
    const villages = async (team) => Village.count({ where: { playerId: team.map((p) => p.playerId) } });
    const [v1, v2] = [await villages(one), await villages(two)];
    if (!v1 || !v2) return { winnerTeam: v1 ? 1 : v2 ? 2 : null, reason: 'conquest' };
    const gaveUp = (team) => team.every((p) => p.forfeitedAt);
    if (gaveUp(one) || gaveUp(two)) return { winnerTeam: gaveUp(one) ? 2 : 1, reason: 'forfeit' };
    if (now >= match.endsAt) {
      const scores = await MatchService.scores(match);
      return { winnerTeam: scores[0] === scores[1] ? null : scores[0] > scores[1] ? 1 : 2, reason: 'time', scores };
    }
    return null;
  }

  /** Score de chaque équipe : [équipe 1, équipe 2] (voir game/matchup.teamScore). */
  static async scores(match, t) {
    const players = await Player.findAll({ where: { id: match.players.map((p) => p.playerId) }, transaction: t });
    return [1, 2].map((n) => mu.teamScore(players.filter((p) => match.players.some((mp) => mp.playerId === p.id && mp.team === n))));
  }

  /**
   * Termine la partie : monde en paix (plus d'attaque), vainqueur, elo de chaque joueur mis à jour (équipe contre elo
   * moyen de l'autre équipe), rapport à tous les joueurs. Sans effet si elle est déjà terminée.
   */
  static async finish(matchId, { winnerTeam, reason, scores = null }, now = new Date()) {
    return sequelize.transaction(async (t) => {
      const match = await Match.findByPk(matchId, { include: [{ model: MatchPlayer, as: 'players' }], transaction: t, lock: t.LOCK.UPDATE });
      if (!match || match.status !== 'running') return null;
      const finalScores = scores || await MatchService.scores(match, t);
      const world = await World.findByPk(match.worldId, { transaction: t });
      const tribes = await Tribe.findAll({ where: { worldId: world.id }, order: [['id', 'ASC']], transaction: t });
      const winner = winnerTeam ? mu.TEAMS[winnerTeam - 1] : null;
      world.set({
        endedAt: now, isOpen: false, winnerTribeId: winnerTeam ? tribes[winnerTeam - 1]?.id || null : null,
        victoryState: { ...world.victoryState, winnerName: winner ? winner.name : 'Égalité', match: { reason, scores: finalScores } },
      });
      await world.save({ transaction: t });

      // Elo : niveau des deux équipes, ampleur de la victoire et part de chacun dans son équipe (game/matchup.eloChanges).
      const ingame = await Player.findAll({ where: { id: match.players.map((p) => p.playerId) }, transaction: t });
      const ratings = [];
      for (const mp of match.players) ratings.push(mp.userId ? await MatchService.rating(mp.userId, match.ladder, t) : null);
      const days = (r) => (r && r.lastPlayedAt ? (now - new Date(r.lastPlayedAt)) / 86400000 : 0);
      const changes = mu.ratingChanges(match.players.map((mp, i) => {
        const p = ingame.find((x) => x.id === mp.playerId);
        const r = ratings[i];
        return {
          team: mp.team, elo: r ? r.elo : mp.eloBefore, mmr: r ? r.mmr : mu.START_ELO, rd: mu.effectiveRd(r ? r.rd : mu.RD_START, days(r)),
          games: r ? r.games : 0, forfeited: Boolean(mp.forfeitedAt), contribution: mu.teamScore(p ? [p] : []),
        };
      }), { winnerTeam, reason, scores: finalScores });
      for (const [i, mp] of match.players.entries()) {
        const rating = ratings[i];
        if (!rating) continue;
        const result = winnerTeam === null ? 0.5 : mp.team === winnerTeam ? 1 : 0;
        const { elo, mmr, rd, placement } = changes[i];
        await rating.update({
          elo, mmr, rd, lastPlayedAt: now, games: rating.games + 1,
          wins: rating.wins + (result === 1 ? 1 : 0), losses: rating.losses + (result === 0 ? 1 : 0), draws: rating.draws + (result === 0.5 ? 1 : 0),
        }, { transaction: t });
        await mp.update({ eloAfter: elo, placement }, { transaction: t });
      }
      await match.update({ status: 'ended', endedAt: now, winnerTeam, reason, scores: finalScores }, { transaction: t });

      const why = { conquest: 'par conquête', forfeit: 'par abandon', time: 'aux points' }[reason];
      const title = winner ? `Les ${winner.short.toLowerCase()} gagnent la partie ${why}` : 'Partie terminée sur une égalité';
      await Report.bulkCreate(match.players.map((p) => ({
        playerId: p.playerId, type: 'world', title, happenedAt: now,
        data: { perspective: 'world', text: `Score : ${finalScores[0]} – ${finalScores[1]}. Le monde est en paix : retrouve ton nouvel elo sur la page du matchup.` },
      })), { transaction: t });
      return match;
    });
  }

  /** Abandon d'un joueur ; quand toute son équipe a abandonné, l'autre équipe gagne (au prochain tour de boucle). */
  static async forfeit(user, now = new Date()) {
    const mp = await MatchService.runningOf(user.id);
    if (!mp) throw new GameError('Aucune partie en cours.');
    await mp.update({ forfeitedAt: now });
    const match = await Match.findByPk(mp.matchId, { include: [{ model: MatchPlayer, as: 'players' }] });
    const outcome = await MatchService.outcome(match, now);
    if (outcome) await MatchService.finish(match.id, outcome, now);
    return mp;
  }

  /**
   * Partie terminée d'un monde du matchup (null si elle continue) : le temps écoulé ou la conquête la terminent ici
   * aussitôt, sans attendre la boucle de jeu. Les pages du jeu renvoient alors à l'écran de fin de partie.
   */
  static async endedFor(world, now = new Date()) {
    if (!world || world.access !== 'match') return null;
    let match = await Match.findOne({ where: { worldId: world.id }, include: [{ model: MatchPlayer, as: 'players' }] });
    if (!match) return null;
    if (match.status === 'running') {
      const outcome = await MatchService.outcome(match, now);
      if (!outcome) return null;
      match = await MatchService.finish(match.id, outcome, now) || await Match.findByPk(match.id);
    }
    return match.status === 'ended' ? match : null;
  }

  /** Écran de fin de partie : la partie, ses équipes et chaque joueur (points, villages, adversaires vaincus, elo). */
  static async results(matchId) {
    const match = await Match.findByPk(matchId, { include: [{ model: MatchPlayer, as: 'players', include: [{ model: User, attributes: ['id', 'username'] }] }] });
    if (!match) return null;
    const players = await Player.findAll({ where: { id: match.players.map((p) => p.playerId) } });
    const rows = match.players.map((mp) => {
      const p = players.find((x) => x.id === mp.playerId);
      return {
        team: mp.team, userId: mp.userId, name: p ? p.name : (mp.User ? mp.User.username : '?'), points: p ? p.points : 0, villages: p ? p.villageCount : 0,
        kills: p ? p.killsAttacker + p.killsDefender + p.killsSupporter : 0, eloBefore: mp.eloBefore, eloAfter: mp.eloAfter, placement: mp.placement, forfeited: Boolean(mp.forfeitedAt),
      };
    });
    return { match, teams: [1, 2].map((n) => ({ ...mu.TEAMS[n - 1], rows: rows.filter((r) => r.team === n).sort((a, b) => b.points - a.points) })) };
  }

  /** Partie d'un monde (barre de partie en jeu) : partie, joueurs, scores en direct ; null hors matchup. */
  static async forWorld(world) {
    if (!world || !world.isMatch()) return null;
    const match = await Match.findOne({ where: { worldId: world.id }, include: [{ model: MatchPlayer, as: 'players' }] });
    if (!match) return null;
    return { match, scores: match.scores || await MatchService.scores(match) };
  }

  /** Dernières parties terminées d'un compte, avec son équipe et sa variation d'elo. */
  static async history(userId, limit = 10) {
    const rows = await MatchPlayer.findAll({
      where: { userId },
      include: [{ model: Match, where: { status: 'ended' }, include: [{ model: World, attributes: ['slug'] }] }],
      order: [[Match, 'endedAt', 'DESC']], limit,
    });
    return rows.map((mp) => ({
      id: mp.Match.id, format: mp.Match.format, endedAt: mp.Match.endedAt, reason: mp.Match.reason, scores: mp.Match.scores, team: mp.team,
      result: mp.Match.winnerTeam === null ? 'draw' : mp.Match.winnerTeam === mp.team ? 'win' : 'loss',
      delta: mp.eloAfter === null ? 0 : mp.eloAfter - mp.eloBefore, placement: mp.placement, slug: mp.Match.World ? mp.Match.World.slug : null,
    }));
  }

  /**
   * Barbares des parties en cours, relus toutes les BARBARIAN_EVERY_MS (au lieu de 10 minutes ailleurs) : ils grandissent
   * presque aussi vite que les joueurs, la carte doit suivre.
   */
  static async growBarbarians(now = new Date()) {
    if (now - lastBarbarianGrowth < BARBARIAN_EVERY_MS) return;
    lastBarbarianGrowth = now.getTime();
    const VillageService = require('./VillageService');
    const running = await Match.findAll({ where: { status: 'running' }, include: [World] });
    for (const match of running) if (match.World) await VillageService.growBarbarians(match.World, now);
  }

  /** Tour de la boucle de jeu : parties trouvées expirées, formation des parties, fin des parties en cours, barbares. */
  static async tick(now = new Date()) {
    await MatchService.expireProposals(now);
    await MatchService.matchmake(now);
    await MatchService.checkRunning(now);
    await MatchService.growBarbarians(now);
  }
}

MatchService.QUEUE_STALE_MS = QUEUE_STALE_MS;
MatchService.ACCEPT_MS = ACCEPT_MS;
MatchService.DODGE_BLOCK_MS = DODGE_BLOCK_MS;
MatchService.MAX_GROUP = MAX_GROUP;

module.exports = MatchService;
