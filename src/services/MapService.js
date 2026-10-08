'use strict';

const { Op } = require('sequelize');
const { sequelize, Village, Player, Tribe } = require('../models');

class MapService {
  /** Tous les villages du monde, pour la carte globale en canevas. */
  static async worldMap(worldId) {
    return Village.findAll({
      where: { worldId },
      attributes: ['id', 'name', 'x', 'y', 'points', 'playerId', 'special'],
      include: [{ model: Player, attributes: ['id', 'name', 'tribeId', 'points', 'isBot'], include: [{ model: Tribe, attributes: ['id', 'tag'] }] }],
      order: [['id', 'ASC']],
    });
  }

  static async ranking(worldId, limit = 100) {
    return Player.findAll({
      where: { worldId }, include: [{ model: Tribe, attributes: ['id', 'tag', 'avatar'] }], order: [['points', 'DESC'], ['id', 'ASC']], limit,
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
      include: [{ model: Player, attributes: ['id', 'name', 'userId', 'tribeId', 'isBot', 'avatar'], include: [{ model: Tribe, attributes: ['id', 'tag', 'name', 'avatar'] }] }],
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
  static killExpr(kind) {
    return {
      att: '"killsAttacker"',
      def: '"killsDefender"',
      sup: '"killsSupporter"',
      all: '("killsAttacker" + "killsDefender" + "killsSupporter")',
    }[kind] || '("killsAttacker" + "killsDefender" + "killsSupporter")';
  }

  /** Adversaires vaincus par tribu (« Adversaires battus (tribu) » de GT) : somme des points de ses membres. */
  static async tribeKillRanking(worldId, kind = 'all', limit = 100) {
    const expr = MapService.killExpr(kind);
    const rows = await Player.findAll({
      where: { worldId, tribeId: { [Op.ne]: null } },
      attributes: ['tribeId', [sequelize.fn('SUM', sequelize.literal(expr)), 'score'], [sequelize.fn('COUNT', sequelize.col('id')), 'members']],
      group: ['tribeId'],
      raw: true,
    });
    const scored = rows.map((r) => ({ tribeId: r.tribeId, score: Number(r.score) || 0, members: Number(r.members) })).filter((r) => r.score > 0);
    const tribes = await Tribe.findAll({ where: { id: { [Op.in]: scored.map((r) => r.tribeId) } }, attributes: ['id', 'tag', 'name', 'avatar'] });
    const byId = new Map(tribes.map((t) => [t.id, t]));
    return scored
      .filter((r) => byId.has(r.tribeId))
      .sort((a, b) => b.score - a.score || a.tribeId - b.tribeId)
      .slice(0, limit)
      .map((r) => ({ tribe: byId.get(r.tribeId), score: r.score, members: r.members }));
  }

  static async killRanking(worldId, kind = 'all', limit = 100) {
    const expr = MapService.killExpr(kind);
    const players = await Player.findAll({
      where: { worldId, [Op.and]: [sequelize.literal(`${expr} > 0`)] },
      include: [{ model: Tribe, attributes: ['id', 'tag', 'avatar'] }],
      order: [[sequelize.literal(expr), 'DESC'], ['id', 'ASC']],
      limit,
    });
    const score = (p) => ({ att: p.killsAttacker, def: p.killsDefender, sup: p.killsSupporter }[kind] ?? p.killsAttacker + p.killsDefender + p.killsSupporter);
    return players.map((player) => ({ player, score: score(player) }));
  }

  /** Profil public d'un joueur : tribu, rang, villages. */
  /**
   * Recherche de la carte : joueurs, villages ou tribus dont le nom (ou le tag) contient le texte, sans tenir compte
   * de la casse. Renvoie au plus 12 résultats, chacun avec des coordonnées où centrer la carte.
   */
  static async search(worldId, type, text) {
    const q = String(text || '').trim().toLowerCase().slice(0, 32);
    if (q.length < 2) return [];
    const like = (col) => sequelize.where(sequelize.fn('lower', sequelize.col(col)), { [Op.like]: `%${q.replace(/[%_\\]/g, '')}%` });
    if (type === 'village') {
      const rows = await Village.findAll({ where: { worldId, [Op.and]: [like('Village.name')] }, include: [{ model: Player, attributes: ['name'] }], order: [['points', 'DESC']], limit: 12 });
      return rows.map((v) => ({ label: v.name, sub: `${v.Player ? v.Player.name : 'Barbares'} · ${v.points} pts`, x: v.x, y: v.y, villageId: v.id }));
    }
    if (type === 'tribe') {
      const rows = await Tribe.findAll({ where: { worldId, [Op.or]: [like('Tribe.name'), like('Tribe.tag')] }, order: [['name', 'ASC']], limit: 12 });
      // Membres et meilleur village de chaque tribu trouvée : lus pour toutes d'un coup.
      const members = rows.length ? await Player.findAll({ where: { tribeId: rows.map((t) => t.id) }, attributes: ['id', 'tribeId', 'points'], raw: true }) : [];
      const best = await MapService.bestVillages(members.map((m) => m.id));
      return rows.map((t) => {
        const own = members.filter((m) => m.tribeId === t.id);
        const top = own.map((m) => best.get(m.id)).filter(Boolean).sort((a, b) => b.points - a.points || a.id - b.id)[0];
        const pts = own.reduce((n, m) => n + m.points, 0);
        return { label: `[${t.tag}] ${t.name}`, sub: `${own.length} membre(s) · ${pts} pts`, x: top ? top.x : null, y: top ? top.y : null, tribeId: t.id };
      });
    }
    const rows = await Player.findAll({ where: { worldId, [Op.and]: [like('Player.name')] }, order: [['points', 'DESC']], limit: 12 });
    const best = await MapService.bestVillages(rows.map((p) => p.id));
    return rows.map((p) => {
      const v = best.get(p.id);
      return { label: p.name, sub: `${p.points} pts · ${p.villageCount || 0} village(s)`, x: v ? v.x : null, y: v ? v.y : null, playerId: p.id };
    });
  }

  /** Village le plus peuplé (en points) de chaque joueur : Map playerId → { id, x, y, points }. */
  static async bestVillages(playerIds) {
    const out = new Map();
    if (!playerIds.length) return out;
    const rows = await Village.findAll({ where: { playerId: { [Op.in]: playerIds } }, attributes: ['id', 'playerId', 'x', 'y', 'points'], order: [['points', 'DESC'], ['id', 'ASC']], raw: true });
    for (const v of rows) if (!out.has(v.playerId)) out.set(v.playerId, v);
    return out;
  }

  static async playerProfile(worldId, playerId) {
    const player = await Player.findOne({ where: { id: Number(playerId), worldId }, include: [{ model: Tribe }] });
    if (!player) return null;
    const [villages, better] = await Promise.all([
      Village.findAll({ where: { playerId: player.id }, attributes: ['id', 'name', 'x', 'y', 'points'] }),
      Player.count({ where: { worldId, [Op.or]: [{ points: { [Op.gt]: player.points } }, { points: player.points, id: { [Op.lt]: player.id } }] } }),
    ]);
    // Ordre alphabétique, avec les numéros dans l'ordre naturel (« 2 » avant « 10 »), comme sur Guerre Tribale.
    villages.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
    // Rang aux adversaires vaincus (total ODA + ODD + ODS), seulement si le joueur en a.
    const kills = player.killsAttacker + player.killsDefender + player.killsSupporter;
    const killsRank = kills > 0
      ? 1 + await Player.count({ where: { worldId, [Op.and]: [sequelize.literal(`("killsAttacker" + "killsDefender" + "killsSupporter") > ${Number(kills)}`)] } })
      : null;
    return { player, villages, rank: better + 1, killsRank, miniMap: await MapService.playerMiniMap(worldId, player, villages) };
  }

  /**
   * Mini-carte du profil : un bandeau trois fois plus large que haut (au moins 20 cases de haut) qui englobe
   * les villages du joueur, avec tous les villages qui s'y trouvent. Même format que les autres mini-cartes
   * (public/js/minimap.js) : [x, y, kind], kind : current (ce joueur, mis en avant), tribe (sa tribu), other, barb.
   */
  static async playerMiniMap(worldId, player, villages) {
    if (!villages.length) return null;
    const xs = villages.map((v) => v.x);
    const ys = villages.map((v) => v.y);
    const height = Math.min(100, Math.max(20, Math.max(...ys) - Math.min(...ys) + 7, Math.ceil((Math.max(...xs) - Math.min(...xs) + 7) / 3)));
    const width = height * 3;
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
    const x0 = cx - Math.floor(width / 2);
    const y0 = cy - Math.floor(height / 2);
    const rows = await Village.findAll({
      where: { worldId, x: { [Op.between]: [x0, x0 + width - 1] }, y: { [Op.between]: [y0, y0 + height - 1] } },
      attributes: ['x', 'y', 'playerId'],
      include: [{ model: Player, attributes: ['tribeId'] }],
    });
    const kindOf = (v) => {
      if (!v.playerId) return 'barb';
      if (v.playerId === player.id) return 'current';
      return player.tribeId && v.Player && v.Player.tribeId === player.tribeId ? 'tribe' : 'other';
    };
    return { x0, y0, width, height, cx, cy, villages: rows.map((v) => [v.x, v.y, kindOf(v)]) };
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
