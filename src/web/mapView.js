'use strict';

// Données de la carte pour le navigateur (public/js/map.js) : villages par secteurs de 20 × 20 cases, chargés
// au fil des déplacements comme sur Guerre Tribale, et points colorés de la mini-carte.
// Le décor (herbe, forêts, collines, lacs) ne transite pas : il est calculé par le navigateur.

const { Op, fn, col } = require('sequelize');
const { Player, Village, Tribe } = require('../models');
const TribeService = require('../services/TribeService');
const MarkerService = require('../services/MarkerService');
const FavoriteService = require('../services/FavoriteService');
const combat = require('../game/combat');

const SECTOR = 20;

// Relation d'un village vu par le joueur : libellé de l'infobulle.
const REL_LABEL = {
  current: 'Ce village', own: 'Ton village', tribe: 'Ta tribu', ally: 'Allié', nap: 'PNA', enemy: 'Ennemi', other: 'Joueur', barb: 'Barbare',
};

// Six silhouettes de village selon les points.
const villageLevel = (pts) => (pts < 300 ? 1 : pts < 1000 ? 2 : pts < 3000 ? 3 : pts < 6000 ? 4 : pts < 9000 ? 5 : 6);
const num = (n) => Math.floor(n).toLocaleString('fr-FR');

/** Contexte de lecture de la carte pour le village courant : relations, marquages, favoris, morale. */
async function viewContext(village, cfg) {
  const player = await Player.findByPk(village.playerId);
  const [relations, markers, favorites] = await Promise.all([
    TribeService.relationsOf(player.tribeId),
    MarkerService.list(player.id, village.worldId),
    FavoriteService.list(player.id),
  ]);
  return {
    village, player, relations, markers, favorites,
    colors: MarkerService.colorMaps(markers),
    favIds: new Set(favorites.map((f) => f.villageId)),
    moraleOf: cfg.moral ? (points) => combat.morale(player.points, points, true) : null,
  };
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
function cellOf(vc, v, tribePoints) {
  const kind = kindOf(vc, v);
  const p = v.Player;
  const t = p && p.Tribe;
  return {
    x: v.x, y: v.y, id: v.id, name: v.name, kind, rel: REL_LABEL[kind], level: villageLevel(v.points), points: num(v.points),
    owner: p ? p.name : 'Barbares', playerId: p ? p.id : '',
    ownerInfo: p ? `${num(p.points)} points · ${num(p.villageCount)} village${p.villageCount > 1 ? 's' : ''}` : '',
    tribeId: t ? t.id : '', tribe: t ? t.tag : '', tribeName: t ? t.name : '',
    tribeInfo: t && tribePoints.has(t.id) ? `${num(tribePoints.get(t.id))} points` : '',
    special: v.special === 'rune' ? 'Village de rune' : v.special === 'siege' ? 'Quartier du Grand Siège' : '',
    fav: vc.favIds.has(v.id),
    mark: markOf(vc, v),
    // Morale de tes attaques contre ce joueur (rien contre les barbares et tes propres villages).
    morale: vc.moraleOf && p && kind !== 'own' && kind !== 'current' ? `${Math.round(vc.moraleOf(p.points) * 100)} %` : '',
  };
}

/** Villages d'un secteur (sx, sy : numéros de secteur, 20 cases de côté). */
async function sector(vc, sx, sy) {
  const x0 = sx * SECTOR;
  const y0 = sy * SECTOR;
  const villages = await Village.findAll({
    where: { worldId: vc.village.worldId, x: { [Op.between]: [x0, x0 + SECTOR - 1] }, y: { [Op.between]: [y0, y0 + SECTOR - 1] } },
    attributes: ['id', 'name', 'x', 'y', 'points', 'playerId', 'special'],
    include: [{ model: Player, attributes: ['id', 'name', 'tribeId', 'points', 'villageCount'], include: [{ model: Tribe, attributes: ['id', 'tag', 'name'] }] }],
  });
  // Points des tribus présentes (infobulle) : somme des points de leurs membres.
  const tribeIds = [...new Set(villages.map((v) => v.Player && v.Player.tribeId).filter(Boolean))];
  const tribePoints = new Map();
  if (tribeIds.length) {
    const sums = await Player.findAll({ where: { tribeId: tribeIds }, attributes: ['tribeId', [fn('SUM', col('points')), 'total']], group: ['tribeId'], raw: true });
    for (const r of sums) tribePoints.set(r.tribeId, Number(r.total));
  }
  return { sx, sy, cells: villages.map((v) => cellOf(vc, v, tribePoints)) };
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

module.exports = { SECTOR, point, viewContext, kindOf, markOf, sector, sectorsCovering, mini, villageLevel };
