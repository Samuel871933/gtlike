'use strict';

const { Op } = require('sequelize');
const { sequelize, World, Player, Village, Tribe, Report } = require('../models');
const { MapPlacer } = require('../game/MapPlacer');
const VillageState = require('../game/VillageState');
const { factionName } = require('../game/factions');

const DAY = 86400000;
const HOUR = 3600000;

/**
 * Conditions de victoire d'un monde (voir WorldConfig.victory). Toutes suivent le même schéma :
 * une tribu (ou un joueur) remplit la condition, doit la tenir un certain temps (sinon la fin de
 * partie est annulée), puis gagne ; le monde passe alors en paix et les inscriptions ferment.
 * Le Grand Siège fait exception : l'influence s'accumule et la victoire est immédiate à l'objectif.
 * Monde à factions (config.factions.active) : les mêmes conditions se calculent par faction au lieu de tribu.
 */
class VictoryService {
  static ageDays(world, now) {
    return (now - new Date(world.createdAt)) / DAY;
  }

  /** Sujet des messages : « Les Nains » (pluriel) pour une faction, sinon le nom de la tribu ou du joueur. */
  static subject(leader) {
    return leader.faction ? { who: `Les ${leader.name}`, plural: true } : { who: leader.name, plural: false };
  }

  /** Camp qui se dispute la victoire : la faction sur un monde à factions, sinon la tribu. */
  static teamScope(cfg) {
    return cfg.factions.active ? 'faction' : 'tribe';
  }

  /** Villages de joueurs par tribu, par faction ou par joueur (`scope`) : { id, name, villages, points }. */
  static async holdings(worldId, { scope = 'tribe', where = {}, t } = {}) {
    const villages = await Village.findAll({
      where: { worldId, playerId: { [Op.ne]: null }, ...where },
      attributes: ['points'],
      include: [{ model: Player, attributes: ['id', 'name', 'tribeId', 'faction', 'isBot'], include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
      transaction: t,
    });
    const rows = new Map();
    for (const v of villages) {
      const owner = scope === 'tribe' ? v.Player.Tribe
        : scope === 'faction' ? (v.Player.faction ? { id: v.Player.faction, name: factionName(v.Player.faction), faction: v.Player.faction } : null)
          : v.Player;
      if (!owner) continue;
      const row = rows.get(owner.id) || {
        id: owner.id, name: owner.tag ? `[${owner.tag}] ${owner.name}` : owner.name, tag: owner.tag || null, label: owner.name,
        faction: owner.faction || null, villages: 0, points: 0,
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
    const team = VictoryService.teamScope(cfg);
    if (v.type === 'dominance') {
      const { rows, total } = await VictoryService.holdings(world.id, { scope: team, t });
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
      const { rows } = await VictoryService.holdings(world.id, { scope: pv.scope === 'player' ? 'player' : team, t });
      const list = rows.map((r) => ({ ...r, ok: r.points >= pv.points && r.villages >= pv.villages })).sort((a, b) => b.points - a.points);
      const leader = list.find((r) => r.ok) || list[0] || null;
      return { type: 'pointsVillages', age, list, leader, met: Boolean(leader && leader.ok), warning: Boolean(leader && leader.ok), holdMs: pv.holdHours * HOUR };
    }
    if (v.type === 'runes') {
      const r = await VictoryService.runeStandings(world, team, t);
      const leader = r.list[0] || null;
      const met = Boolean(leader && r.continents.length && leader.filled === r.continents.length);
      return {
        type: 'runes', age, ...r, leader, spawned: Boolean(state.spawned), met, warning: met, holdMs: v.runes.holdDays * DAY,
      };
    }
    if (v.type === 'siege') {
      const sg = v.siege;
      const { rows } = await VictoryService.holdings(world.id, { scope: team, where: { special: 'siege' }, t });
      const influence = state.influence || {};
      // Clés de l'influence : ids de tribu (nombres) ou de faction (textes), écrits en texte par JSON.
      const keyOf = (id) => (team === 'faction' ? id : Number(id));
      const startedAt = state.spawnedAt ? new Date(state.spawnedAt) : null;
      const weeks = startedAt ? Math.floor((now - startedAt) / (sg.reductionEveryDays * DAY)) : 0;
      const reduction = Math.min(sg.maxReductionPercent, weeks * sg.reductionPercent) / 100;
      const required = Math.round(sg.requiredInfluence * (1 - reduction));
      const list = rows.map((r) => ({ ...r, influence: Math.floor(influence[r.id] || 0) }));
      for (const [id, value] of Object.entries(influence)) {
        if (!list.some((r) => r.id === keyOf(id))) list.push({ id: keyOf(id), name: state.names?.[id] || (team === 'faction' ? factionName(id) : `Tribu ${id}`), faction: team === 'faction' ? id : null, villages: 0, influence: Math.floor(value) });
      }
      list.sort((a, b) => b.influence - a.influence);
      const leader = list[0] || null;
      return { type: 'siege', age, list, required, reduction, spawned: Boolean(state.spawned), leader, met: Boolean(leader && leader.influence >= required), holdMs: 0 };
    }
    return { type: 'none', age, list: [] };
  }

  /**
   * Guerres runiques : villages de runes par continent et par camp (tribu ou faction). Un camp « remplit » un continent
   * quand il y tient au moins `winPercent` % de ses villages de runes ; il gagne en remplissant tous les continents.
   * Renvoie { continents: [{ k, total, need }], list: [{ id, name, villages, percent, filled, byContinent }], total, held }.
   */
  static async runeStandings(world, team, t) {
    const cfg = world.getConfig();
    const villages = await Village.findAll({
      where: { worldId: world.id, special: 'rune' },
      attributes: ['x', 'y', 'playerId'],
      include: [{ model: Player, attributes: ['id', 'name', 'tribeId', 'faction'], include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
      transaction: t,
    });
    const keyOf = (v) => `K${Math.floor(v.y / 100)}${Math.floor(v.x / 100)}`;
    const keys = [...new Set([...((world.victoryState || {}).continents || []), ...villages.map(keyOf)])].sort();
    const totals = new Map(keys.map((k) => [k, 0]));
    const rows = new Map();
    let held = 0;
    for (const v of villages) {
      const k = keyOf(v);
      totals.set(k, totals.get(k) + 1);
      const p = v.Player;
      if (!p) continue;
      held += 1;
      const owner = team === 'faction'
        ? (p.faction ? { id: p.faction, name: factionName(p.faction), faction: p.faction } : null)
        : p.Tribe;
      if (!owner) continue;
      const row = rows.get(owner.id) || {
        id: owner.id, name: owner.tag ? `[${owner.tag}] ${owner.name}` : owner.name, tag: owner.tag || null, label: owner.name,
        faction: owner.faction || null, villages: 0, byContinent: {},
      };
      row.villages += 1;
      row.byContinent[k] = (row.byContinent[k] || 0) + 1;
      rows.set(owner.id, row);
    }
    const total = villages.length;
    const need = (k) => Math.ceil((cfg.victory.runes.winPercent / 100) * totals.get(k));
    const list = [...rows.values()].map((r) => ({
      ...r,
      percent: total ? (100 * r.villages) / total : 0,
      filled: keys.filter((k) => totals.get(k) > 0 && (r.byContinent[k] || 0) >= need(k)).length,
    })).sort((a, b) => b.filled - a.filled || b.villages - a.villages);
    const continents = keys.map((k) => ({ k, total: totals.get(k), need: need(k) }));
    return { continents, list, total, held };
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

  /**
   * Continents qui reçoivent des villages de runes : ceux qui ont au moins `runes.minPlayerVillages` villages de
   * joueurs (au moins le plus peuplé, pour qu'un petit monde ait quand même ses runes).
   */
  static async runeContinents(world, t) {
    const cfg = world.getConfig();
    const villages = await Village.findAll({ where: { worldId: world.id, playerId: { [Op.ne]: null } }, attributes: ['x', 'y'], raw: true, transaction: t });
    const counts = new Map();
    for (const v of villages) {
      const k = `K${Math.floor(v.y / 100)}${Math.floor(v.x / 100)}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const eligible = ranked.filter(([, n]) => n >= cfg.victory.runes.minPlayerVillages).map(([k]) => k);
    return (eligible.length ? eligible : ranked.slice(0, 1).map(([k]) => k)).sort();
  }

  static async freeSpotsIn(world, bounds, count, t, rng = Math.random, { spacing = 0 } = {}) {
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
      // Écart minimal entre les villages tirés, abandonné en fin de recherche si la zone est trop encombrée.
      const gap = i < count * 30 ? spacing : 0;
      if (placer.isFree(x, y, 0) && !spots.some((s) => Math.hypot(s.x - x, s.y - y) < gap)) {
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
      const continents = await VictoryService.runeContinents(world, t);
      // Villages répartis dans le continent : écart minimal entre eux (10 cases pour 25 villages).
      const spacing = Math.max(2, Math.floor(50 / Math.sqrt(Math.max(1, v.runes.villagesPerContinent))));
      for (const k of continents) {
        const spots = await VictoryService.freeSpotsIn(world, MapService.continentBounds(k), v.runes.villagesPerContinent, t, rng, { spacing });
        await VictoryService.spawnSpecial(world, { special: 'rune', name: 'Village de rune', count: v.runes.villagesPerContinent, spots, garrison: v.runes.garrison, now }, t);
      }
      Object.assign(state, { spawned: true, spawnedAt: now.toISOString(), continents });
      const penalty = Math.round((1 - v.runes.defenseFactor) * 100);
      await VictoryService.broadcast(world, 'Les villages de rune sont apparus', {
        text: `Des villages de rune gardés par des troupes barbares sont apparus (${v.runes.villagesPerContinent} par continent : ${continents.join(', ')}). `
          + `Détenez ${v.runes.winPercent} % des villages de rune de chaque continent pendant ${v.runes.holdDays} jours pour gagner le monde.`
          + (penalty > 0 ? ` Un village de rune conquis se défend avec ${penalty} % de force en moins.` : ''),
      }, now, t);
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
        const { rows } = await VictoryService.holdings(world.id, { scope: VictoryService.teamScope(cfg), where: { special: 'siege' }, t });
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
      const { who, plural } = leader ? VictoryService.subject(leader) : { who: '', plural: false };

      if (s.warning && leader && state.warnedFor !== leader.id) {
        state = { ...state, warnedFor: leader.id };
        await VictoryService.broadcast(world, `${who} ${plural ? 'approchent' : 'approche'} de la victoire`, { text: VictoryService.describe(s, cfg) }, now, t);
      }

      if (s.met && leader) {
        if (s.holdMs === 0) return VictoryService.declare(world, cfg, leader, now, t, state);
        if (state.holderId !== leader.id) {
          const until = new Date(now.getTime() + s.holdMs);
          state = { ...state, holderId: leader.id, holderName: label, since: now.toISOString(), until: until.toISOString() };
          await VictoryService.broadcast(world, `Fin de partie enclenchée : ${label}`, {
            text: plural
              ? `${who} remplissent la condition de victoire. S'ils la tiennent jusqu'au ${until.toLocaleString('fr-FR')}, ils gagnent le monde.`
              : `${who} remplit la condition de victoire. S'il la tient jusqu'au ${until.toLocaleString('fr-FR')}, il gagne le monde.`,
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

  /**
   * Victoire : le monde passe en paix, les inscriptions ferment, les gagnants reçoivent leur succès (tous les joueurs
   * de la tribu, ou de la faction sur un monde à factions).
   */
  static async declare(world, cfg, leader, now, t, state) {
    const byPlayer = cfg.victory.type === 'pointsVillages' && cfg.victory.pointsVillages.scope === 'player';
    const byFaction = !byPlayer && VictoryService.teamScope(cfg) === 'faction';
    world.set({
      endedAt: now, isOpen: false, victoryState: { ...state, winnerName: leader.name },
      winnerTribeId: byPlayer || byFaction ? null : leader.id, winnerPlayerId: byPlayer ? leader.id : null,
      winnerFaction: byFaction ? leader.id : null,
    });
    await world.save({ transaction: t });
    const winners = byPlayer
      ? [{ id: leader.id }]
      : await Player.findAll({ where: { worldId: world.id, ...(byFaction ? { faction: leader.id } : { tribeId: leader.id }) }, attributes: ['id'], raw: true, transaction: t });
    const AchievementService = require('./AchievementService');
    for (const w of winners) {
      await AchievementService.addStats(w.id, { worldWinner: 1 }, t);
      await AchievementService.evaluate(w.id, { now, t });
    }
    const { who, plural } = VictoryService.subject(leader);
    await VictoryService.broadcast(world, `${who} ${plural ? 'ont' : 'a'} gagné le monde !`, {
      text: 'Le monde est maintenant en paix : plus aucune attaque ne peut être lancée et les inscriptions sont fermées.',
    }, now, t);
    return leader;
  }

  static describe(s, cfg) {
    const v = cfg.victory;
    const { who, plural } = VictoryService.subject(s.leader);
    const holds = `${who} ${plural ? 'détiennent' : 'détient'}`;
    if (s.type === 'dominance') {
      return `${holds} ${s.leader.percent.toFixed(1)} % des villages de joueurs (victoire à ${v.dominance.endgamePercent} %, monde d'au moins ${v.dominance.minWorldAgeDays} jours, à tenir ${v.dominance.holdDays} jours).`;
    }
    if (s.type === 'runes') return `${holds} ${v.runes.winPercent} % des villages de rune dans ${s.leader.filled} continent${s.leader.filled > 1 ? 's' : ''} sur ${s.continents.length}.`;
    if (s.type === 'pointsVillages') return `${who} ${plural ? 'ont' : 'a'} atteint ${s.leader.points} points et ${s.leader.villages} villages.`;
    return '';
  }

  static async checkAll(now = new Date()) {
    for (const world of await World.findAll({ where: { endedAt: null }, attributes: ['id'] })) await VictoryService.check(world.id, now);
  }
}

module.exports = VictoryService;
