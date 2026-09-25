'use strict';

const { Op } = require('sequelize');
const { sequelize, Village, Player, Tribe } = require('../models');

class MapService {
  /** Villages dans un carré de `size` cases centré sur (cx, cy). */
  static async area(worldId, cx, cy, size = 15) {
    const half = Math.floor(size / 2);
    const x0 = cx - half;
    const y0 = cy - half;
    const villages = await Village.findAll({
      where: {
        worldId,
        x: { [Op.between]: [x0, x0 + size - 1] },
        y: { [Op.between]: [y0, y0 + size - 1] },
      },
      attributes: ['id', 'name', 'x', 'y', 'points', 'playerId', 'special'],
      include: [{ model: Player, attributes: ['id', 'name', 'tribeId'], include: [{ model: Tribe, attributes: ['id', 'tag'] }] }],
    });
    const byCoord = new Map(villages.map((v) => [`${v.x}|${v.y}`, v]));
    const rows = [];
    for (let y = y0; y < y0 + size; y++) {
      const row = [];
      for (let x = x0; x < x0 + size; x++) row.push({ x, y, village: byCoord.get(`${x}|${y}`) || null });
      rows.push(row);
    }
    return { x0, y0, size, rows };
  }

  static async ranking(worldId, limit = 100) {
    return Player.findAll({
      where: { worldId }, include: [{ model: Tribe, attributes: ['id', 'tag'] }], order: [['points', 'DESC'], ['id', 'ASC']], limit,
    });
  }

  /** Bornes d'un continent « K54 » : x 400-499, y 500-599. */
  static continentBounds(k) {
    const m = /^K(\d)(\d)$/.exec(String(k || ''));
    if (!m) return null;
    const [cy, cx] = [Number(m[1]) * 100, Number(m[2]) * 100];
    return { x: [cx, cx + 99], y: [cy, cy + 99] };
  }

  /**
   * Classement d'un continent : joueurs (ou tribus) par points de leurs villages dans ce continent.
   * @returns {{ player|tribe, points, villages }[]}
   */
  static async continentRanking(worldId, k, { tribes = false, limit = 100 } = {}) {
    const b = MapService.continentBounds(k);
    if (!b) return [];
    const villages = await Village.findAll({
      where: { worldId, playerId: { [Op.ne]: null }, x: { [Op.between]: b.x }, y: { [Op.between]: b.y } },
      attributes: ['playerId', 'points'],
      include: [{ model: Player, attributes: ['id', 'name', 'userId', 'tribeId'], include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
    });
    const rows = new Map();
    for (const v of villages) {
      const owner = tribes ? v.Player.Tribe : v.Player;
      if (!owner) continue;
      const row = rows.get(owner.id) || { [tribes ? 'tribe' : 'player']: owner, points: 0, villages: 0 };
      row.points += v.points;
      row.villages += 1;
      rows.set(owner.id, row);
    }
    return [...rows.values()].sort((a, b2) => b2.points - a.points).slice(0, limit);
  }

  /** Continents où le monde a des villages, du plus peuplé au moins peuplé. */
  static async continents(worldId) {
    const villages = await Village.findAll({ where: { worldId }, attributes: ['x', 'y'], raw: true });
    const count = new Map();
    for (const v of villages) {
      const k = `K${Math.floor(v.y / 100)}${Math.floor(v.x / 100)}`;
      count.set(k, (count.get(k) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }

  /**
   * Classement des adversaires vaincus : att (ODA), def (ODD), sup (ODS) ou all (total).
   * @returns {{ player, score }[]}
   */
  static async killRanking(worldId, kind = 'all', limit = 100) {
    const expr = {
      att: '"killsAttacker"',
      def: '"killsDefender"',
      sup: '"killsSupporter"',
      all: '("killsAttacker" + "killsDefender" + "killsSupporter")',
    }[kind] || '("killsAttacker" + "killsDefender" + "killsSupporter")';
    const players = await Player.findAll({
      where: { worldId, [Op.and]: [sequelize.literal(`${expr} > 0`)] },
      include: [{ model: Tribe, attributes: ['id', 'tag'] }],
      order: [[sequelize.literal(expr), 'DESC'], ['id', 'ASC']],
      limit,
    });
    const score = (p) => ({ att: p.killsAttacker, def: p.killsDefender, sup: p.killsSupporter }[kind] ?? p.killsAttacker + p.killsDefender + p.killsSupporter);
    return players.map((player) => ({ player, score: score(player) }));
  }

  /** Profil public d'un joueur : tribu, rang, villages. */
  static async playerProfile(worldId, playerId) {
    const player = await Player.findOne({ where: { id: Number(playerId), worldId }, include: [{ model: Tribe }] });
    if (!player) return null;
    const [villages, better] = await Promise.all([
      Village.findAll({ where: { playerId: player.id }, attributes: ['id', 'name', 'x', 'y', 'points'], order: [['points', 'DESC']] }),
      Player.count({ where: { worldId, [Op.or]: [{ points: { [Op.gt]: player.points } }, { points: player.points, id: { [Op.lt]: player.id } }] } }),
    ]);
    return { player, villages, rank: better + 1 };
  }

  // Exports publics au format Guerre Tribale (/map/village.txt, /map/player.txt).

  static async villageDump(worldId) {
    const villages = await Village.findAll({ where: { worldId }, attributes: ['id', 'name', 'x', 'y', 'playerId', 'points'], raw: true });
    return villages.map((v) => [v.id, encodeURIComponent(v.name), v.x, v.y, v.playerId || 0, v.points, 0].join(',')).join('\n');
  }

  static async playerDump(worldId) {
    const players = await MapService.ranking(worldId, 1e9);
    return players.map((p, i) => [p.id, encodeURIComponent(p.name), p.tribeId || 0, p.villageCount, p.points, i + 1].join(',')).join('\n');
  }
}

module.exports = MapService;
