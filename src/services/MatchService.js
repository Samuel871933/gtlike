'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize, User, World, Player, Village, Tribe, Report, MatchRating, MatchGroup, MatchGroupMember, MatchQueue, Match, MatchPlayer,
} = require('../models');
const GameError = require('./GameError');
const WorldService = require('./WorldService');
const mu = require('../game/matchup');

// Entrée de la file retirée quand plus personne n'a ouvert la page du matchup depuis ce délai (la page se signale
// toutes les quelques secondes) : on ne lance pas de partie pour un joueur parti.
const QUEUE_STALE_MS = 60000;
const MAX_GROUP = 5;
// Code d'un groupe : sans caractères ambigus (0/O, 1/I).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (n = 6) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

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
      include: [{ model: Match, where: { status: 'running' }, include: [{ model: World, attributes: ['id', 'slug', 'name'] }] }],
      transaction: t,
    });
  }

  /** Ni dans la file, ni en partie : sinon erreur. */
  static async assertIdle(userId, t) {
    if (await MatchService.runningOf(userId, t)) throw new GameError('Tu as une partie en cours : termine-la d’abord.');
    if (await MatchService.entryOf(userId, t)) throw new GameError('Tu es déjà dans la file d’attente.');
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
      const ladder = mu.ladderOf(format);
      const elos = [];
      for (const id of userIds) elos.push((await MatchService.rating(id, ladder, t)).elo);
      return MatchQueue.create({
        format, userIds, size: userIds.length, rating: Math.round(mu.average(elos)), queuedAt: now, seenAt: now,
      }, { transaction: t });
    });
  }

  /** Quitter la file (n'importe quel membre du groupe arrête la recherche du groupe). */
  static async cancel(user) {
    await sequelize.transaction((t) => MatchService.dropEntriesOf([user.id], t));
  }

  /**
   * État du matchup pour un compte (la page le relit toutes les quelques secondes, ce qui garde son entrée dans la
   * file) : { queue, match, group }.
   */
  static async status(userId, now = new Date()) {
    const [entry, running, group] = await Promise.all([
      MatchService.entryOf(userId), MatchService.runningOf(userId), MatchService.groupOf(userId),
    ]);
    if (entry) await entry.update({ seenAt: now }, { silent: true });
    return {
      queue: entry ? { format: entry.format, queuedAt: entry.queuedAt, size: entry.size, rating: entry.rating } : null,
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

  /** Forme toutes les parties possibles (après avoir retiré les entrées sans nouvelles) ; renvoie les parties créées. */
  static async matchmake(now = new Date()) {
    await MatchQueue.destroy({ where: { seenAt: { [Op.lt]: new Date(now - QUEUE_STALE_MS) } } });
    const created = [];
    for (const format of Object.keys(mu.FORMATS)) {
      for (;;) {
        const entries = await MatchQueue.findAll({ where: { format }, order: [['queuedAt', 'ASC'], ['id', 'ASC']] });
        const found = mu.formMatch(entries, mu.FORMATS[format], now);
        if (!found) break;
        const match = await MatchService.createMatch(format, found.teams, now).catch((err) => {
          // Entrée retirée entre-temps (annulation) : on retentera au prochain tour.
          if (err instanceof GameError) return null;
          throw err;
        });
        if (!match) break;
        created.push(match);
      }
    }
    return created;
  }

  /**
   * Crée la partie : son monde (petite carte très rapide), une tribu par équipe, le village de départ (et son armée)
   * de chaque joueur face à l'équipe adverse, des barbares entre les deux lignes. Les entrées de la file sont retirées.
   */
  static async createMatch(format, teams, now = new Date()) {
    const teamSize = mu.FORMATS[format];
    return sequelize.transaction(async (t) => {
      const entryIds = teams.flat().map((e) => e.id);
      if ((await MatchQueue.destroy({ where: { id: entryIds }, transaction: t })) !== entryIds.length) {
        throw new GameError('File modifiée pendant la création de la partie.');
      }
      let slug = `m${newCode(7).toLowerCase()}`;
      while (await World.findOne({ where: { slug }, transaction: t })) slug = `m${newCode(7).toLowerCase()}`;
      const world = await World.create({
        slug, name: `Matchup ${format} · ${slug.slice(1).toUpperCase()}`, isOpen: false, access: 'match', config: mu.worldConfig(),
      }, { transaction: t });
      const match = await Match.create({
        worldId: world.id, format, ladder: mu.ladderOf(format), startedAt: now, endsAt: new Date(now.getTime() + mu.MATCH_MINUTES * 60000),
      }, { transaction: t });

      const cfg = world.getConfig();
      const { spots, barbs } = mu.layout(teamSize, cfg.center);
      for (const [i, entries] of teams.entries()) {
        const meta = mu.TEAMS[i];
        const tribe = await Tribe.create({ worldId: world.id, name: meta.name, tag: meta.tag }, { transaction: t });
        const userIds = entries.flatMap((e) => e.userIds);
        const users = await User.findAll({ where: { id: userIds }, transaction: t });
        const teamSpots = spots.filter((s) => s.team === meta.n);
        for (const [slot, userId] of userIds.entries()) {
          const user = users.find((u) => u.id === userId);
          const player = await Player.create({
            userId, worldId: world.id, name: user.username, tribeId: tribe.id, tribeRole: slot === 0 ? 'duke' : 'member', tribeJoinedAt: now,
          }, { transaction: t });
          const village = await WorldService.createVillage(world, {
            ...teamSpots[slot], player, name: `Village de ${user.username}`, isFirst: true, buildings: cfg.startBuildings, units: { ...mu.START_UNITS }, now,
          }, t);
          await player.update({ points: village.points, villageCount: 1 }, { transaction: t });
          const rating = await MatchService.rating(userId, match.ladder, t);
          await MatchPlayer.create({ matchId: match.id, userId, playerId: player.id, team: meta.n, eloBefore: rating.elo }, { transaction: t });
        }
      }
      const barbBuildings = { main: 5, farm: 10, storage: 12, wood: 10, stone: 10, iron: 10, wall: 3 };
      for (const spot of barbs) {
        await WorldService.createVillage(world, { ...spot, player: null, name: 'Village barbare', buildings: barbBuildings, now }, t);
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

      const avg = (n) => mu.average(match.players.filter((p) => p.team === n).map((p) => p.eloBefore));
      for (const mp of match.players) {
        if (!mp.userId) continue;
        const result = winnerTeam === null ? 0.5 : mp.team === winnerTeam ? 1 : 0;
        const rating = await MatchService.rating(mp.userId, match.ladder, t);
        const delta = mu.eloDelta(avg(mp.team), avg(3 - mp.team), result, rating.games);
        const elo = Math.max(0, rating.elo + delta);
        await rating.update({
          elo, games: rating.games + 1,
          wins: rating.wins + (result === 1 ? 1 : 0), losses: rating.losses + (result === 0 ? 1 : 0), draws: rating.draws + (result === 0.5 ? 1 : 0),
        }, { transaction: t });
        await mp.update({ eloAfter: elo }, { transaction: t });
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
      format: mp.Match.format, endedAt: mp.Match.endedAt, reason: mp.Match.reason, scores: mp.Match.scores, team: mp.team,
      result: mp.Match.winnerTeam === null ? 'draw' : mp.Match.winnerTeam === mp.team ? 'win' : 'loss',
      delta: mp.eloAfter === null ? 0 : mp.eloAfter - mp.eloBefore, slug: mp.Match.World ? mp.Match.World.slug : null,
    }));
  }

  /** Tour de la boucle de jeu : formation des parties, puis fin des parties en cours. */
  static async tick(now = new Date()) {
    await MatchService.matchmake(now);
    await MatchService.checkRunning(now);
  }
}

MatchService.QUEUE_STALE_MS = QUEUE_STALE_MS;
MatchService.MAX_GROUP = MAX_GROUP;

module.exports = MatchService;
