'use strict';

// Sceaux (les « drapeaux » de Guerre Tribale, module de monde features.seals ; règles et bonus : game/seals.js).
// - Les sceaux appartiennent au compte (table Seals) et servent sur tous les mondes où le module est actif. Un sceau
//   posé sur un village reste au compte : il est simplement indisponible tant qu'il est posé (village d'un monde en
//   cours), et redevient libre si le village est conquis, quitté ou si le monde se termine. On ne perd jamais un sceau.
// - Gains, comme sur GT (type tiré au hasard, niveau fixé par la source), seulement sur les mondes officiels :
//   succès (niveau du palier, 1 à 4), succès quotidien (niveau 3), noble formé (niveau 1 chacun), paliers d'unités
//   ennemies vaincues (niveau 2). Aucun gain sur un serveur privé, ni sceau vendu à la boutique.
// - Un sceau par village, retiré ou déplacé 24 h après sa pose au plus tôt ; fusion de 3 sceaux identiques en un du
//   niveau supérieur (même type) ; échange 1 contre 1 au même niveau avec un membre de sa tribu (mondes officiels).

const { Op } = require('sequelize');
const { sequelize, User, World, Player, Village, Report, Seal, SealEvent, SealTrade } = require('../models');
const seals = require('../game/seals');
const GameError = require('./GameError');

const HOUR = 3600000;
// Unités ennemies vaincues pour chaque sceau (niveau 2) : 100, 150, 225… (× 1,5 à chaque palier), comme la barre de GT.
const KILLS_FIRST = 100;
const KILLS_FACTOR = 1.5;
const killThreshold = (step) => Math.round(KILLS_FIRST * KILLS_FACTOR ** step);

const SOURCES = {
  achievement: 'Succès', daily: 'Succès quotidien', noble: 'Noble formé', kills: 'Unités vaincues',
  merge: 'Fusion', trade: 'Échange', admin: 'Attribution',
};

class SealService {
  /** Le module est-il actif sur ce monde ? */
  static enabled(cfg) {
    return Boolean(cfg && cfg.features && cfg.features.seals);
  }

  /** Peut-on gagner des sceaux sur ce monde (module actif, monde officiel) ? */
  static canEarn(world) {
    return Boolean(world) && !world.isPrivate() && SealService.enabled(world.getConfig());
  }

  // ---------------------------------------------------------------- Inventaire

  /**
   * Sceaux d'un compte : Map « type:niveau » → { type, level, count, placed, available }. `placed` : sceaux posés sur
   * des villages de mondes en cours (où qu'ils soient).
   */
  static async inventory(userId, t) {
    const [rows, placed] = await Promise.all([
      Seal.findAll({ where: { userId, count: { [Op.gt]: 0 } }, transaction: t }),
      SealService.placed(userId, t),
    ]);
    const out = new Map();
    for (const r of rows) out.set(`${r.type}:${r.level}`, { type: r.type, level: r.level, count: r.count, placed: 0, available: r.count });
    for (const v of placed) {
      const k = `${v.sealType}:${v.sealLevel}`;
      const row = out.get(k) || { type: v.sealType, level: v.sealLevel, count: 0, placed: 0, available: 0 };
      row.placed += 1;
      row.available = Math.max(0, row.count - row.placed);
      out.set(k, row);
    }
    return out;
  }

  /** Villages qui portent un sceau du compte, sur les mondes en cours. */
  static async placed(userId, t) {
    const players = await Player.findAll({
      where: { userId }, attributes: ['id'], include: [{ model: World, attributes: ['id'], where: { endedAt: null } }], transaction: t,
    });
    if (!players.length) return [];
    return Village.findAll({
      where: { playerId: players.map((p) => p.id), sealType: { [Op.ne]: null } },
      attributes: ['id', 'name', 'x', 'y', 'worldId', 'playerId', 'sealType', 'sealLevel', 'sealAt'], transaction: t,
    });
  }

  static async available(userId, type, level, t) {
    return (await SealService.inventory(userId, t)).get(`${type}:${level}`)?.available || 0;
  }

  /** Ajoute (ou retire, `delta` négatif) des sceaux au compte. */
  static async add(userId, type, level, delta, t) {
    const [row] = await Seal.findOrCreate({ where: { userId, type, level }, defaults: { count: 0 }, transaction: t, lock: t.LOCK.UPDATE });
    const count = row.count + delta;
    if (count < 0) throw new GameError('Pas assez de sceaux.');
    await row.update({ count }, { transaction: t });
  }

  static async log(userId, worldId, type, level, source, detail, t) {
    await SealEvent.create({ userId, worldId, type, level, source, detail: detail ? String(detail).slice(0, 160) : null }, { transaction: t });
  }

  // ---------------------------------------------------------------- Gains (mondes officiels)

  /**
   * Donne un sceau de niveau `level` (type au hasard) au compte du joueur, si on peut en gagner sur son monde ; rapport
   * au joueur. Renvoie le sceau gagné, ou null.
   */
  static async grant(playerOrId, level, source, detail, { t, rng = Math.random, now = new Date() } = {}) {
    if (!t) return sequelize.transaction((tx) => SealService.grant(playerOrId, level, source, detail, { t: tx, rng, now }));
    const player = typeof playerOrId === 'object' ? playerOrId : await Player.findByPk(playerOrId, { transaction: t });
    if (!player || !player.userId || player.isBot) return null;
    const world = await World.findByPk(player.worldId, { transaction: t });
    if (!SealService.canEarn(world)) return null;
    const type = seals.TYPES[Math.floor(rng() * seals.TYPES.length)].id;
    await SealService.add(player.userId, type, level, 1, t);
    await SealService.log(player.userId, world.id, type, level, source, detail, t);
    const def = seals.type(type);
    await Report.create({
      playerId: player.id, type: 'world', happenedAt: now, title: `Nouveau sceau : ${def.short} ${level}`,
      data: { perspective: 'world', text: `${SOURCES[source] || 'Gain'}${detail ? ` (${detail})` : ''} : tu reçois un sceau ${def.name.toLowerCase()} de niveau ${level} (${def.effect(seals.value(type, level))}).` },
    }, { transaction: t });
    return { type, level };
  }

  /** Succès débloqué : un sceau du niveau du palier (bois 1 … or 4). */
  static async onAchievement(player, def, tier, opts) {
    return SealService.grant(player, Math.max(1, Math.min(seals.MAX_LEVEL, tier)), 'achievement', def.name, opts);
  }

  /** Succès quotidien : un sceau de niveau 3. */
  static async onDailyAward(playerId, name, opts) {
    return SealService.grant(playerId, 3, 'daily', name, opts);
  }

  /** Nobles formés : un sceau de niveau 1 par noble. */
  static async onNobles(playerId, count, opts) {
    for (let i = 0; i < count; i++) await SealService.grant(playerId, 1, 'noble', null, opts);
  }

  /**
   * Unités ennemies vaincues (stats.unitsKilled, en attaque et en défense) : un sceau de niveau 2 à chaque palier franchi.
   * Le palier atteint est gardé dans stats.sealKillSteps.
   */
  static async onKills(playerId, { t, rng, now } = {}) {
    const player = await Player.findByPk(playerId, { transaction: t, lock: t && t.LOCK.UPDATE });
    if (!player || !player.userId || player.isBot) return 0;
    const world = await World.findByPk(player.worldId, { transaction: t });
    if (!SealService.canEarn(world)) return 0;
    const stats = player.stats || {};
    const killed = stats.unitsKilled || 0;
    let step = stats.sealKillSteps || 0;
    let won = 0;
    while (killed >= SealService.killsNeeded(step)) {
      step += 1;
      won += 1;
      await SealService.grant(player, 2, 'kills', `${SealService.killsNeeded(step - 1).toLocaleString('fr-FR')} unités`, { t, rng, now });
    }
    if (won) await player.update({ stats: { ...stats, sealKillSteps: step } }, { transaction: t });
    return won;
  }

  /** Unités vaincues (cumul) pour le palier `step` (0 : premier sceau). */
  static killsNeeded(step) {
    let total = 0;
    for (let i = 0; i <= step; i++) total += killThreshold(i);
    return total;
  }

  // ---------------------------------------------------------------- Pose sur un village

  /** Le joueur pose le sceau `type`/`level` sur son village (remplace celui qui y est, s'il peut être retiré). */
  static async assign(playerId, villageId, { type, level }, { now = new Date() } = {}) {
    level = Number(level);
    if (!seals.isType(type) || !seals.isLevel(level)) throw new GameError('Sceau inconnu.');
    const VillageService = require('./VillageService');
    return VillageService.withVillage(villageId, async (ctx, t) => {
      const { village, cfg } = ctx;
      SealService.checkVillage(ctx, playerId);
      const player = await Player.findByPk(playerId, { transaction: t });
      if (village.sealType === type && village.sealLevel === level) throw new GameError('Ce sceau est déjà posé sur ce village.');
      if (village.sealType) SealService.checkRemovable(ctx, cfg, now);
      if ((await SealService.available(player.userId, type, level, t)) < 1) throw new GameError('Tu n’as pas de sceau libre de ce type et de ce niveau.');
      village.set({ ...ctx.state.toData(), sealType: type, sealLevel: level, sealAt: now });
      await village.save({ transaction: t });
      return { type, level };
    }, { now });
  }

  /** Retire le sceau du village (24 h après sa pose au plus tôt). */
  static async remove(playerId, villageId, { now = new Date() } = {}) {
    const VillageService = require('./VillageService');
    return VillageService.withVillage(villageId, async (ctx, t) => {
      SealService.checkVillage(ctx, playerId);
      if (!ctx.village.sealType) throw new GameError('Aucun sceau sur ce village.');
      SealService.checkRemovable(ctx, ctx.cfg, now);
      ctx.village.set({ ...ctx.state.toData(), sealType: null, sealLevel: null, sealAt: null });
      await ctx.village.save({ transaction: t });
    }, { now });
  }

  static checkVillage(ctx, playerId) {
    if (!SealService.enabled(ctx.cfg)) throw new GameError('Les sceaux ne sont pas actifs sur ce monde.');
    if (ctx.village.playerId !== playerId) throw new GameError('Ce village ne t’appartient pas.', 403);
  }

  /** Un sceau se retire 24 h (seals.lockHours) après sa pose ; celui de population, pas si la ferme déborderait. */
  static checkRemovable(ctx, cfg, now) {
    const until = SealService.lockedUntil(ctx.village, cfg);
    if (until && until > now) throw new GameError(`Ce sceau ne peut être retiré ou remplacé qu’à partir du ${until.toLocaleString('fr-FR')}.`);
    if (ctx.village.sealType === 'population') {
      const base = require('../game/formulas').farmCapacity(ctx.state.level('farm'));
      if (ctx.popUsed() > base) throw new GameError('La population du village dépasse la ferme sans ce sceau : il ne peut pas être retiré.');
    }
  }

  /** Date à partir de laquelle le sceau du village peut être retiré (null s'il n'y en a pas). */
  static lockedUntil(village, cfg) {
    if (!village.sealType || !village.sealAt) return null;
    return new Date(new Date(village.sealAt).getTime() + cfg.seals.lockHours * HOUR);
  }

  /** Sceaux qui quittent un village (conquête, abandon) : ils redeviennent libres pour leur propriétaire. */
  static async clearVillages(villageIds, t) {
    if (!villageIds.length) return;
    await Village.update({ sealType: null, sealLevel: null, sealAt: null }, { where: { id: villageIds, sealType: { [Op.ne]: null } }, transaction: t });
  }

  // ---------------------------------------------------------------- Fusion

  /** Fusionne 3 sceaux libres de même type et niveau en un sceau du niveau suivant. */
  static async merge(userId, { type, level }) {
    level = Number(level);
    if (!seals.isType(type) || !seals.isLevel(level)) throw new GameError('Sceau inconnu.');
    if (level >= seals.MAX_LEVEL) throw new GameError(`Un sceau de niveau ${seals.MAX_LEVEL} ne peut plus être fusionné.`);
    return sequelize.transaction(async (t) => {
      await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
      if ((await SealService.available(userId, type, level, t)) < 3) throw new GameError('Il faut 3 sceaux libres de ce type et de ce niveau.');
      await SealService.add(userId, type, level, -3, t);
      await SealService.add(userId, type, level + 1, 1, t);
      await SealService.log(userId, null, type, level + 1, 'merge', `3 × niveau ${level}`, t);
      return { type, level: level + 1 };
    });
  }

  // ---------------------------------------------------------------- Échanges en tribu

  /** Échanges ouverts sur ce monde : reçus et envoyés par le compte. */
  static async trades(userId, worldId) {
    const rows = await SealTrade.findAll({ where: { worldId, [Op.or]: [{ fromUserId: userId }, { toUserId: userId }] }, order: [['createdAt', 'DESC']] });
    const ids = [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId]))];
    const players = ids.length ? await Player.findAll({ where: { worldId, userId: ids }, attributes: ['id', 'name', 'userId'] }) : [];
    const byUser = new Map(players.map((p) => [p.userId, p]));
    return rows.map((r) => ({ trade: r, from: byUser.get(r.fromUserId) || null, to: byUser.get(r.toUserId) || null, incoming: r.toUserId === userId }));
  }

  static tradeContext(world) {
    if (!SealService.canEarn(world)) throw new GameError('Les échanges de sceaux se font sur les mondes officiels où les sceaux sont actifs.');
  }

  /** Propose à un membre de sa tribu : mon sceau `giveType` contre son sceau `wantType`, au même niveau. */
  static async propose(playerId, { to, giveType, wantType, level }) {
    level = Number(level);
    if (!seals.isType(giveType) || !seals.isType(wantType) || !seals.isLevel(level)) throw new GameError('Sceau inconnu.');
    return sequelize.transaction(async (t) => {
      const me = await Player.findByPk(playerId, { transaction: t });
      const world = await World.findByPk(me.worldId, { transaction: t });
      SealService.tradeContext(world);
      const other = await Player.findOne({ where: { worldId: world.id, id: Number(to) }, transaction: t });
      if (!other || other.id === me.id || !other.userId) throw new GameError('Choisis un membre de ta tribu.');
      if (!me.tribeId || other.tribeId !== me.tribeId) throw new GameError('On n’échange des sceaux qu’avec un membre de sa tribu.');
      if ((await SealService.available(me.userId, giveType, level, t)) < 1) throw new GameError('Tu n’as pas de sceau libre de ce type et de ce niveau.');
      const open = await SealTrade.count({ where: { worldId: world.id, fromUserId: me.userId }, transaction: t });
      if (open >= 10) throw new GameError('Tu as déjà 10 propositions d’échange en attente.');
      return SealTrade.create({ worldId: world.id, fromUserId: me.userId, toUserId: other.userId, giveType, wantType, level }, { transaction: t });
    });
  }

  /** Le destinataire accepte : les deux sceaux changent de compte (s'ils sont toujours libres). */
  static async accept(playerId, tradeId) {
    return sequelize.transaction(async (t) => {
      const me = await Player.findByPk(playerId, { transaction: t });
      const trade = await SealTrade.findOne({ where: { id: Number(tradeId), toUserId: me.userId, worldId: me.worldId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!trade) throw new GameError('Échange introuvable.', 404);
      const world = await World.findByPk(me.worldId, { transaction: t });
      SealService.tradeContext(world);
      const from = await Player.findOne({ where: { worldId: world.id, userId: trade.fromUserId }, transaction: t });
      if (!from || !me.tribeId || from.tribeId !== me.tribeId) throw new GameError('Vous n’êtes plus dans la même tribu : l’échange est impossible.');
      await User.findAll({ where: { id: [trade.fromUserId, trade.toUserId] }, order: [['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE });
      if ((await SealService.available(trade.fromUserId, trade.giveType, trade.level, t)) < 1) throw new GameError(`${from.name} n’a plus ce sceau de libre.`);
      if ((await SealService.available(me.userId, trade.wantType, trade.level, t)) < 1) throw new GameError('Tu n’as pas de sceau libre de ce type et de ce niveau.');
      await SealService.add(trade.fromUserId, trade.giveType, trade.level, -1, t);
      await SealService.add(me.userId, trade.giveType, trade.level, 1, t);
      await SealService.add(me.userId, trade.wantType, trade.level, -1, t);
      await SealService.add(trade.fromUserId, trade.wantType, trade.level, 1, t);
      await SealService.log(me.userId, world.id, trade.giveType, trade.level, 'trade', `avec ${from.name}`, t);
      await SealService.log(trade.fromUserId, world.id, trade.wantType, trade.level, 'trade', `avec ${me.name}`, t);
      await trade.destroy({ transaction: t });
    });
  }

  /** Refus (destinataire) ou retrait (auteur) d'une proposition. */
  static async cancel(playerId, tradeId) {
    const me = await Player.findByPk(playerId);
    const n = await SealTrade.destroy({ where: { id: Number(tradeId), worldId: me.worldId, [Op.or]: [{ fromUserId: me.userId }, { toUserId: me.userId }] } });
    if (!n) throw new GameError('Échange introuvable.', 404);
  }

  // ---------------------------------------------------------------- Page des sceaux

  /** Historique récent du compte. */
  static async history(userId, limit = 15) {
    return SealEvent.findAll({ where: { userId }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit });
  }

  /** Progression vers les prochains sceaux : unités vaincues et succès le plus proche. */
  static async progress(player) {
    const stats = player.stats || {};
    const step = stats.sealKillSteps || 0;
    const kills = { value: stats.unitsKilled || 0, from: step ? SealService.killsNeeded(step - 1) : 0, goal: SealService.killsNeeded(step) };
    const AchievementService = require('./AchievementService');
    const overview = await AchievementService.overview(player.id);
    let achievement = null;
    for (const a of overview) {
      const goal = a.def.tiers[a.tier];
      if (goal === undefined || a.def.rank || !(a.value >= 0)) continue;
      const ratio = a.value / goal;
      if (!achievement || ratio > achievement.ratio) achievement = { def: a.def, tier: a.tier + 1, value: a.value, goal, ratio };
    }
    return { kills, achievement };
  }
}

SealService.SOURCES = SOURCES;

module.exports = SealService;
