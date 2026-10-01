'use strict';

const { Op } = require('sequelize');
const { sequelize, World, Player, Village, Tribe, Report } = require('../models');
const { MapPlacer } = require('../game/MapPlacer');
const VillageState = require('../game/VillageState');

const DAY = 86400000;
const HOUR = 3600000;

/**
 * Conditions de victoire d'un monde (voir WorldConfig.victory). Toutes suivent le même schéma :
 * une tribu (ou un joueur) remplit la condition, doit la tenir un certain temps (sinon la fin de
 * partie est annulée), puis gagne ; le monde passe alors en paix et les inscriptions ferment.
 * Le Grand Siège fait exception : l'influence s'accumule et la victoire est immédiate à l'objectif.
 */
class VictoryService {
  static ageDays(world, now) {
    return (now - new Date(world.createdAt)) / DAY;
  }

  /** Villages de joueurs par tribu (ou par joueur) : { id, name, villages, points }. */
  static async holdings(worldId, { scope = 'tribe', where = {}, t } = {}) {
    const villages = await Village.findAll({
      where: { worldId, playerId: { [Op.ne]: null }, ...where },
      attributes: ['points'],
      include: [{ model: Player, attributes: ['id', 'name', 'tribeId', 'isBot'], include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
      transaction: t,
    });
    const rows = new Map();
    for (const v of villages) {
      const owner = scope === 'tribe' ? v.Player.Tribe : v.Player;
      if (!owner) continue;
      const row = rows.get(owner.id) || {
        id: owner.id, name: owner.tag ? `[${owner.tag}] ${owner.name}` : owner.name, tag: owner.tag || null, label: owner.name, villages: 0, points: 0,
      };
      row.villages += 1;
      row.points += v.points;
      rows.set(owner.id, row);
    }
    return { rows: [...rows.values()].sort((a, b) => b.villages - a.villages || b.points - a.points), total: villages.length };
  }

  /** État courant de la condition du monde, pour l'affichage et pour `check`. */
  static async standings(world, now = new Date(), t) {
    const cfg = world.getConfig();
    const v = cfg.victory;
    const age = VictoryService.ageDays(world, now);
    const state = world.victoryState || {};
    if (v.type === 'dominance') {
      const { rows, total } = await VictoryService.holdings(world.id, { t });
      const list = rows.map((r) => ({ ...r, percent: total ? (100 * r.villages) / total : 0 }));
      const leader = list[0] || null;
      return {
        type: 'dominance', age, list, total, leader,
        warning: Boolean(leader && leader.percent >= v.dominance.warningPercent && age >= v.dominance.warningWorldAgeDays),
        met: Boolean(leader && leader.percent >= v.dominance.endgamePercent && age >= v.dominance.minWorldAgeDays),
        holdMs: v.dominance.holdDays * DAY,
      };
    }
    if (v.type === 'pointsVillages') {
      const pv = v.pointsVillages;
      const { rows } = await VictoryService.holdings(world.id, { scope: pv.scope, t });
      const list = rows.map((r) => ({ ...r, ok: r.points >= pv.points && r.villages >= pv.villages })).sort((a, b) => b.points - a.points);
      const leader = list.find((r) => r.ok) || list[0] || null;
      return { type: 'pointsVillages', age, list, leader, met: Boolean(leader && leader.ok), warning: Boolean(leader && leader.ok), holdMs: pv.holdHours * HOUR };
    }
    if (v.type === 'runes') {
      const { rows, total } = await VictoryService.holdings(world.id, { where: { special: 'rune' }, t });
      const runeTotal = await Village.count({ where: { worldId: world.id, special: 'rune' }, transaction: t });
      const list = rows.map((r) => ({ ...r, percent: runeTotal ? (100 * r.villages) / runeTotal : 0 }));
      const leader = list[0] || null;
      return {
        type: 'runes', age, list, total: runeTotal, held: total, leader, spawned: Boolean(state.spawned),
        met: Boolean(leader && leader.percent >= v.runes.winPercent), warning: Boolean(leader && leader.percent >= v.runes.winPercent),
        holdMs: v.runes.holdDays * DAY,
      };
    }
    if (v.type === 'siege') {
      const sg = v.siege;
      const { rows } = await VictoryService.holdings(world.id, { where: { special: 'siege' }, t });
      const influence = state.influence || {};
      const startedAt = state.spawnedAt ? new Date(state.spawnedAt) : null;
      const weeks = startedAt ? Math.floor((now - startedAt) / (sg.reductionEveryDays * DAY)) : 0;
      const reduction = Math.min(sg.maxReductionPercent, weeks * sg.reductionPercent) / 100;
      const required = Math.round(sg.requiredInfluence * (1 - reduction));
      const list = rows.map((r) => ({ ...r, influence: Math.floor(influence[r.id] || 0) }));
      for (const [id, value] of Object.entries(influence)) {
        if (!list.some((r) => r.id === Number(id))) list.push({ id: Number(id), name: state.names?.[id] || `Tribu ${id}`, villages: 0, influence: Math.floor(value) });
      }
      list.sort((a, b) => b.influence - a.influence);
      const leader = list[0] || null;
      return { type: 'siege', age, list, required, reduction, spawned: Boolean(state.spawned), leader, met: Boolean(leader && leader.influence >= required), holdMs: 0 };
    }
    return { type: 'none', age, list: [] };
  }

  static async broadcast(world, title, data, now, t) {
    const players = await Player.findAll({ where: { worldId: world.id }, attributes: ['id'], raw: true, transaction: t });
    if (!players.length) return;
    await Report.bulkCreate(players.map((p) => ({ playerId: p.id, type: 'world', title, data: { perspective: 'world', ...data }, happenedAt: now })), { transaction: t });
  }

  /** Crée des villages barbares spéciaux garnis de troupes. */
  static async spawnSpecial(world, { special, name, count, spots, garrison, now }, t) {
    const cfg = world.getConfig();
    for (const { x, y } of spots.slice(0, count)) {
      const buildings = { main: 10, farm: 20, storage: 15, wall: 10, wood: 10, stone: 10, iron: 10 };
      const state = new VillageState({ buildings, units: { ...garrison }, ...cfg.startResources, resourcesAt: now }, cfg);
      await Village.create({ worldId: world.id, playerId: null, name, x, y, special, ...state.toData(), points: state.points(), grownAt: now }, { transaction: t });
    }
  }

  static async freeSpotsIn(world, bounds, count, t, rng = Math.random) {
    // Seulement la zone cherchée (et une case autour), pas toute la carte.
    const coords = await Village.findAll({
      where: { worldId: world.id, x: { [Op.between]: [bounds.x[0] - 1, bounds.x[1] + 1] }, y: { [Op.between]: [bounds.y[0] - 1, bounds.y[1] + 1] } },
      attributes: ['x', 'y'],
      raw: true,
      transaction: t,
    });
    const placer = new MapPlacer(world.getConfig(), new Set(coords.map((c) => MapPlacer.key(c.x, c.y))), rng);
    const spots = [];
    for (let i = 0; i < count * 50 && spots.length < count; i++) {
      const x = bounds.x[0] + Math.floor(rng() * (bounds.x[1] - bounds.x[0] + 1));
      const y = bounds.y[0] + Math.floor(rng() * (bounds.y[1] - bounds.y[0] + 1));
      if (placer.isFree(x, y, 0)) {
        placer.take(x, y);
        spots.push({ x, y });
      }
    }
    return spots;
  }

  /** Apparition des villages de rune (par continent peuplé) ou des quartiers du Grand Siège (au centre). */
  static async spawnIfDue(world, now, t, rng) {
    const cfg = world.getConfig();
    const v = cfg.victory;
    const state = { ...world.victoryState };
    if (state.spawned) return state;
    const age = VictoryService.ageDays(world, now);
    if (v.type === 'runes' && age >= v.runes.spawnAfterDays) {
      const MapService = require('./MapService');
      for (const k of await MapService.continents(world.id)) {
        const bounds = MapService.continentBounds(k);
        const spots = await VictoryService.freeSpotsIn(world, bounds, v.runes.villagesPerContinent, t, rng);
        await VictoryService.spawnSpecial(world, { special: 'rune', name: 'Village de rune', count: v.runes.villagesPerContinent, spots, garrison: v.runes.garrison, now }, t);
      }
      Object.assign(state, { spawned: true, spawnedAt: now.toISOString() });
      await VictoryService.broadcast(world, 'Les villages de rune sont apparus', { text: `Détenez ${v.runes.winPercent} % des villages de rune pendant ${v.runes.holdDays} jours pour gagner le monde.` }, now, t);
    }
    if (v.type === 'siege' && age >= v.siege.startAfterDays) {
      const c = cfg.center;
      const spots = await VictoryService.freeSpotsIn(world, { x: [c - 6, c + 6], y: [c - 6, c + 6] }, v.siege.villages, t, rng);
      await VictoryService.spawnSpecial(world, { special: 'siege', name: 'Quartier du Grand Siège', count: v.siege.villages, spots, garrison: v.siege.garrison, now }, t);
      Object.assign(state, { spawned: true, spawnedAt: now.toISOString(), lastAt: now.toISOString(), influence: {} });
      await VictoryService.broadcast(world, 'Le Grand Siège commence', { text: `Les quartiers de la cité sont apparus au centre de la carte. Chaque quartier tenu rapporte ${v.siege.influencePerVillagePerDay} points d'influence par jour à sa tribu.` }, now, t);
    }
    return state;
  }

  /** Vérifie la condition de victoire d'un monde et fait avancer la fin de partie. */
  static async check(worldId, now = new Date(), { rng = Math.random } = {}) {
    return sequelize.transaction(async (t) => {
      const world = await World.findByPk(worldId, { transaction: t, lock: t.LOCK.UPDATE });
      const cfg = world.getConfig();
      if (world.endedAt || cfg.victory.type === 'none') return null;
      let state = await VictoryService.spawnIfDue(world, now, t, rng);
      world.victoryState = state;

      if (cfg.victory.type === 'siege' && state.spawned) {
        // Influence accumulée par les tribus qui tiennent des quartiers depuis la dernière vérification.
        const { rows } = await VictoryService.holdings(world.id, { where: { special: 'siege' }, t });
        const days = (now - new Date(state.lastAt || now)) / DAY;
        const influence = { ...(state.influence || {}) };
        const names = { ...(state.names || {}) };
        for (const r of rows) {
          influence[r.id] = (influence[r.id] || 0) + r.villages * cfg.victory.siege.influencePerVillagePerDay * days;
          names[r.id] = r.name;
        }
        state = { ...state, influence, names, lastAt: now.toISOString() };
        world.victoryState = state;
      }

      const s = await VictoryService.standings(world, now, t);
      const leader = s.leader;
      const label = leader ? leader.name : '';

      if (s.warning && leader && state.warnedFor !== leader.id) {
        state = { ...state, warnedFor: leader.id };
        await VictoryService.broadcast(world, `${label} approche de la victoire`, { text: VictoryService.describe(s, cfg) }, now, t);
      }

      if (s.met && leader) {
        if (s.holdMs === 0) return VictoryService.declare(world, cfg, leader, now, t, state);
        if (state.holderId !== leader.id) {
          const until = new Date(now.getTime() + s.holdMs);
          state = { ...state, holderId: leader.id, holderName: label, since: now.toISOString(), until: until.toISOString() };
          await VictoryService.broadcast(world, `Fin de partie enclenchée : ${label}`, {
            text: `${label} remplit la condition de victoire. S'il la tient jusqu'au ${until.toLocaleString('fr-FR')}, il gagne le monde.`,
          }, now, t);
        } else if (now >= new Date(state.until)) {
          return VictoryService.declare(world, cfg, leader, now, t, state);
        }
      } else if (state.holderId) {
        await VictoryService.broadcast(world, `Fin de partie annulée : ${state.holderName}`, { text: "La condition de victoire n'est plus remplie." }, now, t);
        state = { ...state, holderId: null, holderName: null, since: null, until: null };
      }
      world.victoryState = state;
      world.changed('victoryState', true);
      await world.save({ transaction: t });
      return null;
    });
  }

  /** Victoire : le monde passe en paix, les inscriptions ferment, les gagnants reçoivent leur succès. */
  static async declare(world, cfg, leader, now, t, state) {
    const byPlayer = cfg.victory.type === 'pointsVillages' && cfg.victory.pointsVillages.scope === 'player';
    world.set({
      endedAt: now, isOpen: false, victoryState: { ...state, winnerName: leader.name },
      winnerTribeId: byPlayer ? null : leader.id, winnerPlayerId: byPlayer ? leader.id : null,
    });
    await world.save({ transaction: t });
    const winners = byPlayer
      ? [{ id: leader.id }]
      : await Player.findAll({ where: { worldId: world.id, tribeId: leader.id }, attributes: ['id'], raw: true, transaction: t });
    const AchievementService = require('./AchievementService');
    for (const w of winners) {
      await AchievementService.addStats(w.id, { worldWinner: 1 }, t);
      await AchievementService.evaluate(w.id, { now, t });
    }
    await VictoryService.broadcast(world, `${leader.name} a gagné le monde !`, {
      text: 'Le monde est maintenant en paix : plus aucune attaque ne peut être lancée et les inscriptions sont fermées.',
    }, now, t);
    return leader;
  }

  static describe(s, cfg) {
    const v = cfg.victory;
    if (s.type === 'dominance') {
      return `${s.leader.name} détient ${s.leader.percent.toFixed(1)} % des villages de joueurs (victoire à ${v.dominance.endgamePercent} %, monde d'au moins ${v.dominance.minWorldAgeDays} jours, à tenir ${v.dominance.holdDays} jours).`;
    }
    if (s.type === 'runes') return `${s.leader.name} détient ${s.leader.percent.toFixed(1)} % des villages de rune (victoire à ${v.runes.winPercent} %).`;
    if (s.type === 'pointsVillages') return `${s.leader.name} a atteint ${s.leader.points} points et ${s.leader.villages} villages.`;
    return '';
  }

  static async checkAll(now = new Date()) {
    for (const world of await World.findAll({ where: { endedAt: null }, attributes: ['id'] })) await VictoryService.check(world.id, now);
  }
}

module.exports = VictoryService;
