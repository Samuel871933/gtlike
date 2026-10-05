'use strict';

// Données de la carte pour le navigateur (public/js/map.js) : villages par secteurs de 20 × 20 cases, chargés
// au fil des déplacements comme sur Guerre Tribale, et points colorés de la mini-carte.
// Le décor (herbe, forêts, collines, lacs) ne transite pas : il est calculé par le navigateur.

const { Op, fn, col } = require('sequelize');
const { Op: SqlOp } = require('sequelize');
const { Player, Village, Tribe, User, LastAttack, Command } = require('../models');
const VillageNoteService = require('../services/VillageNoteService');
const MapOrderService = require('../services/MapOrderService');
const { whenShort } = require('./helpers');
const { villageDesignFor, DEFAULT_VILLAGE_DESIGN } = require('./villageDesigns');
const TribeService = require('../services/TribeService');
const MarkerService = require('../services/MarkerService');
const FavoriteService = require('../services/FavoriteService');
const ShopService = require('../services/ShopService');
const combat = require('../game/combat');
const runes = require('../game/runes');

const SECTOR = 20;

// Six silhouettes de village selon les points.
const villageLevel = (pts) => (pts < 300 ? 1 : pts < 1000 ? 2 : pts < 3000 ? 3 : pts < 6000 ? 4 : pts < 9000 ? 5 : 6);
const num = (n) => Math.floor(n).toLocaleString('fr-FR');

/** Contexte de lecture de la carte pour le village courant : relations, marquages, favoris, morale. */
async function viewContext(village, cfg) {
  const player = await Player.findByPk(village.playerId);
  const [relations, markers, favorites, attacked] = await Promise.all([
    TribeService.relationsOf(player.tribeId),
    MarkerService.list(player.id, village.worldId),
    FavoriteService.list(player.id),
    attackedVillages(player.id),
  ]);
  return {
    village, player, relations, markers, favorites, attacked, cfg,
    colors: MarkerService.colorMaps(markers),
    favIds: new Set(favorites.map((f) => f.villageId)),
    moraleOf: cfg.moral ? (points) => combat.morale(player.points, points, true) : null,
  };
}

/** Villages du joueur visés par des attaques en cours : Map id → nombre d'attaques (icône sur la case de la carte). */
async function attackedVillages(playerId) {
  const own = await Village.findAll({ where: { playerId }, attributes: ['id'], raw: true });
  if (!own.length) return new Map();
  const rows = await Command.findAll({
    where: { type: 'attack', targetVillageId: { [SqlOp.in]: own.map((v) => v.id) } },
    attributes: ['targetVillageId', [Command.sequelize.fn('COUNT', Command.sequelize.col('id')), 'n']],
    group: ['targetVillageId'], raw: true,
  });
  return new Map(rows.map((r) => [r.targetVillageId, Number(r.n)]));
}

function kindOf(vc, v) {
  if (!v.playerId) return 'barb';
  if (v.id === vc.village.id) return 'current';
  if (v.playerId === vc.village.playerId) return 'own';
  const rel = v.Player && v.Player.tribeId ? vc.relations.get(v.Player.tribeId) : null;
  return rel === 'own' ? 'tribe' : rel || 'other';
}

/** Couleur de marquage : celle du village, sinon de son propriétaire, sinon de sa tribu. */
const markOf = (vc, v) => MarkerService.colorOf(vc.colors, v);

/** Un village tel que l'affichent la case, l'infobulle et le menu d'actions. */
function cellOf(vc, v, tribePoints, lastAttacks = new Map(), notes = new Map(), orders = new Map(), rights = new Map()) {
  const kind = kindOf(vc, v);
  const p = v.Player;
  const t = p && p.Tribe;
  return {
    x: v.x, y: v.y, id: v.id, name: v.name, kind, level: villageLevel(v.points), points: num(v.points),
    owner: p ? p.name : 'Barbares', playerId: p ? p.id : '', bot: p && p.isBot ? 1 : '',
    ownerInfo: p ? `${p.isBot ? 'bot · ' : ''}${num(p.points)} points · ${num(p.villageCount)} village${p.villageCount > 1 ? 's' : ''}` : '',
    tribeId: t ? t.id : '', tribe: t ? t.tag : '', tribeName: t ? t.name : '',
    tribeInfo: t && tribePoints.has(t.id) ? `${num(tribePoints.get(t.id))} points` : '',
    special: v.special === 'rune' ? 'Village de rune' : v.special === 'siege' ? 'Quartier du Grand Siège' : '',
    specialKind: v.special || '',
    fav: vc.favIds.has(v.id),
    // Design (skin) choisi par le propriétaire pour ses villages, vu par tous ; les barbares gardent le design par défaut.
    // Seulement s'il le possède sur ce monde (boutique) ; `rights` : droits par compte (ShopService.rightsByUser).
    // Monde à factions : le design de sa faction par défaut (bots compris).
    design: p ? villageDesignFor(p.User, p.User ? rights.get(p.userId) || rights.server || null : null, p.faction).id : DEFAULT_VILLAGE_DESIGN,
    mark: markOf(vc, v),
    // Morale de tes attaques contre ce joueur (rien contre les barbares et tes propres villages).
    morale: vc.moraleOf && p && kind !== 'own' && kind !== 'current' ? `${Math.round((runes.moraleApplies(vc.cfg, v) ? vc.moraleOf(p.points) : 1) * 100)} %` : '',
    // Dernière attaque du joueur sur ce village (gommette et infobulle, comme sur GT) : résultat, butin, date, rapport.
    last: lastOf(lastAttacks.get(v.id)),
    // Notes visibles sur ce village (la tienne, celles que ta tribu partage) : icône sur la case, texte dans l'infobulle.
    note: notes.has(v.id),
    notes: (notes.get(v.id) || []).map((n) => ({ author: n.mine ? '' : n.author, text: n.text.length > 280 ? `${n.text.slice(0, 279)}…` : n.text })),
    orders: orders.get(v.id) || { own: [], tribe: [] },
    // Tes villages visés par des attaques : nombre d'attaques en approche (icône sur la case, comme sur GT).
    incoming: (vc.attacked && vc.attacked.get(v.id)) || 0,
  };
}

function lastOf(a) {
  if (!a) return null;
  return { result: a.result, haul: a.haul, at: whenShort(a.happenedAt), reportId: a.reportId };
}

/** Villages d'un secteur (sx, sy : numéros de secteur, 20 cases de côté). */
async function sector(vc, sx, sy) {
  return (await sectors(vc, [[sx, sy]]))[0];
}

/**
 * Villages de plusieurs secteurs [[sx, sy], …] en une seule série de requêtes (le rectangle qui les englobe),
 * puis répartis par secteur : la carte demande en général un bloc de secteurs voisins d'un coup.
 */
async function sectors(vc, list) {
  if (!list.length) return [];
  const sxs = list.map(([sx]) => sx);
  const sys = list.map(([, sy]) => sy);
  const x0 = Math.min(...sxs) * SECTOR;
  const y0 = Math.min(...sys) * SECTOR;
  const x1 = (Math.max(...sxs) + 1) * SECTOR - 1;
  const y1 = (Math.max(...sys) + 1) * SECTOR - 1;
  const wanted = new Set(list.map(([sx, sy]) => `${sx}|${sy}`));
  const all = await Village.findAll({
    where: { worldId: vc.village.worldId, x: { [Op.between]: [x0, x1] }, y: { [Op.between]: [y0, y1] } },
    attributes: ['id', 'name', 'x', 'y', 'points', 'playerId', 'special'],
    include: [{
      model: Player,
      attributes: ['id', 'name', 'userId', 'tribeId', 'points', 'villageCount', 'isBot', 'faction'],
      include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }, { model: User, attributes: ['villageDesign'] }],
    }],
  });
  const sectorOf = (v) => `${Math.floor(v.x / SECTOR)}|${Math.floor(v.y / SECTOR)}`;
  const villages = all.filter((v) => wanted.has(sectorOf(v)));
  const rights = await ShopService.rightsByUser(villages.map((v) => v.Player && v.Player.userId), vc.village.worldId);
  // Points des tribus présentes (infobulle) : somme des points de leurs membres.
  const tribeIds = [...new Set(villages.map((v) => v.Player && v.Player.tribeId).filter(Boolean))];
  const tribePoints = new Map();
  if (tribeIds.length) {
    const sums = await Player.findAll({ where: { tribeId: tribeIds }, attributes: ['tribeId', [fn('SUM', col('points')), 'total']], group: ['tribeId'], raw: true });
    for (const r of sums) tribePoints.set(r.tribeId, Number(r.total));
  }
  const attacks = villages.length
    ? await LastAttack.findAll({ where: { playerId: vc.player.id, villageId: villages.map((v) => v.id) }, attributes: ['villageId', 'result', 'haul', 'happenedAt', 'reportId'] })
    : [];
  const lastAttacks = new Map(attacks.map((a) => [a.villageId, a]));
  const notes = await VillageNoteService.visible(vc.player, villages.map((v) => v.id));
  const orders = await MapOrderService.visible(vc.player, villages.map((v) => v.id));
  const bySector = new Map(list.map(([sx, sy]) => [`${sx}|${sy}`, { sx, sy, cells: [] }]));
  for (const v of villages) bySector.get(sectorOf(v)).cells.push(cellOf(vc, v, tribePoints, lastAttacks, notes, orders, rights));
  return [...bySector.values()];
}

/** Secteurs couvrant un rectangle de cases (bornes incluses). */
function sectorsCovering(x0, y0, x1, y1) {
  const out = [];
  for (let sy = Math.floor(y0 / SECTOR); sy <= Math.floor(y1 / SECTOR); sy++) {
    for (let sx = Math.floor(x0 / SECTOR); sx <= Math.floor(x1 / SECTOR); sx++) out.push([sx, sy]);
  }
  return out;
}

/** Mini-carte : [x, y, relation, couleur de marquage ?] pour chaque village du carré (public/js/minimap.js). */
async function mini(vc, x0, y0, size) {
  const villages = await Village.findAll({
    where: { worldId: vc.village.worldId, x: { [Op.between]: [x0, x0 + size - 1] }, y: { [Op.between]: [y0, y0 + size - 1] } },
    attributes: ['id', 'x', 'y', 'playerId'],
    include: [{ model: Player, attributes: ['tribeId'] }],
  });
  return villages.map((v) => point(vc, v));
}

/** Point de mini-carte : le marquage à part, pour que ses calques (marquages, barbares) s'appliquent. */
function point(vc, v) {
  const mark = markOf(vc, v);
  return mark ? [v.x, v.y, kindOf(vc, v), mark] : [v.x, v.y, kindOf(vc, v)];
}

module.exports = { SECTOR, point, viewContext, kindOf, markOf, sector, sectors, sectorsCovering, mini, villageLevel };
