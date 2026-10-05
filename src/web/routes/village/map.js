'use strict';

// Carte (pages d'un village, montées par ./index.js).

const express = require('express');
const CommandService = require('../../../services/CommandService');
const { Player } = require('../../../models');
const MapService = require('../../../services/MapService');
const ArmyTemplateService = require('../../../services/ArmyTemplateService');
const MarkerService = require('../../../services/MarkerService');
const mapView = require('../../mapView');
const GameError = require('../../../services/GameError');
const registry = require('../../../game/registry');
const { ah, flash } = require('../../middleware');
const { base, me } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Carte

// Tailles en crans de 1/6 de la largeur de la page, jamais plus larges que le conteneur du site : la carte en prend
// `step` sixièmes, la mini-carte `miniStep` ; à droite de la carte, les deux se partagent la page (6/6 à elles deux).
// La mini-carte peut aussi passer sous la carte, ou par-dessus dans un coin. Cases de taille fixe (53 px sur la
// carte, 5 px sur la mini-carte) : leur nombre suit la largeur, calculée par map.js. Mémorisés sur le joueur.
const STEPS = [1, 2, 3, 4, 5, 6];
// Mini-carte à droite de la carte (side), à gauche (left), en dessous (below) ou par-dessus, dans un coin (over).
const MINI_POSITIONS = ['side', 'left', 'below', 'over'];
const beside = (pos) => pos === 'side' || pos === 'left';
const MAP_LAYERS = { influence: true, enemy: true, nobarb: false, grid: false, borders: true, markers: true, moves: true, church: true };
// Largeur utile d'une page (1500 px moins les marges) : estimation des cases pour le premier rendu ; map.js les
// recalcule aussitôt sur la largeur réelle.
const PAGE_W = 1476;
function estimateSizes({ step, miniStep, miniPos }) {
  let col;
  let miniW;
  if (beside(miniPos)) {
    const unit = (PAGE_W - 16) / 6;
    const aside = Math.max(250, unit * miniStep);
    col = Math.min(unit * step, PAGE_W - 16 - aside);
    miniW = aside - 28;
  } else {
    col = (PAGE_W * step) / 6;
    miniW = miniPos === 'over' ? ((col - 22) * miniStep) / 6 : Math.max(250, (PAGE_W * miniStep) / 6) - 28;
  }
  return { displaySize: Math.max(5, Math.round((col - 22) / 53)), miniSize: Math.max(10, Math.round(miniW / 5)) };
}
// À côté de la carte, les deux tailles se partagent la page : 6/6 à elles deux (5/6 chacune au plus) ; l'autre
// réglage que celui modifié (`changed`) est réduit au besoin.
function share(prefs, changed = 'step') {
  if (!beside(prefs.miniPos)) return prefs;
  prefs.step = Math.min(5, prefs.step);
  prefs.miniStep = Math.min(5, prefs.miniStep);
  if (prefs.step + prefs.miniStep > 6) {
    if (changed === 'miniStep') prefs.step = 6 - prefs.miniStep; else prefs.miniStep = 6 - prefs.step;
  }
  return prefs;
}
// Réglages mémorisés ; les anciens (size en cases, mini en cases) sont convertis au plus proche.
function mapPrefs(saved) {
  const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
  const oldStep = saved.size ? Math.min(6, Math.max(1, Math.round(saved.size / 5))) : 4;
  const prefs = {
    step: pick(Number(saved.step), STEPS, oldStep),
    miniStep: pick(Number(saved.miniStep), STEPS, 1),
    miniPos: pick(saved.miniPos, MINI_POSITIONS, 'side'),
  };
  return share(prefs);
}

router.get('/map', ah(async (req, res) => {
  const { village, cfg } = req.ctx;
  const vc = await mapView.viewContext(village, cfg);
  const { player } = vc;
  const saved = player.mapSettings || {};
  const prefs = mapPrefs(saved);
  const { displaySize, miniSize } = estimateSizes(prefs);
  const layers = { ...MAP_LAYERS, ...(saved.layers || {}) };
  const clamp = (v, d) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(cfg.mapSize - 1, Math.max(0, n)) : d;
  };
  const cx = clamp(req.query.x, village.x);
  const cy = clamp(req.query.y, village.y);
  // Case mise en évidence (résultat de recherche, lien vers des coordonnées).
  const sel = req.query.sx != null ? { x: clamp(req.query.sx, cx), y: clamp(req.query.sy, cy) } : null;
  // Recherche (panneau de la carte) : joueur, village, tribu ; des coordonnées recentrent directement la carte.
  const find = ['player', 'village', 'tribe', 'coords'].includes(req.query.find) ? req.query.find : 'player';
  const q = String(req.query.q || '').trim();
  if (find === 'coords' && q) {
    const m = /^\s*(\d+)\D+(\d+)\s*$/.exec(q);
    if (m) return res.redirect(`/village/${village.id}/map?x=${clamp(m[1], cx)}&y=${clamp(m[2], cy)}&sx=${clamp(m[1], cx)}&sy=${clamp(m[2], cy)}`);
  }
  const search = { find, q, results: q && find !== 'coords' ? await MapService.search(village.worldId, find, q) : null };
  // Premiers secteurs (zone affichée et ses abords) et mini-carte, intégrés à la page : pas d'attente au premier affichage.
  const half = Math.floor(displaySize / 2);
  const around = mapView.sectorsCovering(cx - half - 10, cy - half - 10, cx + half + 10, cy + half + 10);
  const miniHalf = Math.floor(miniSize / 2);
  const [templates, sectors, miniVillages, movements] = await Promise.all([
    ArmyTemplateService.list(village.playerId),
    mapView.sectors(vc, around),
    mapView.mini(vc, cx - miniHalf, cy - miniHalf, miniSize),
    CommandService.overview(village.id),
  ]);
  // Modèles favoris : raccourcis d'attaque du menu d'un village (première lettre du nom).
  const farm = templates.filter((t) => t.favorite).sort((a, b) => a.favorite - b.favorite)
    .map((t) => ({ id: t.id, name: t.name, letter: ArmyTemplateService.letter(t) }));
  const attacks = movements.outgoing.filter((c) => c.type === 'attack').map((c) => [c.target.x, c.target.y]);
  // Mondes avec église : zones d'influence de ses églises (calque « Zones de foi ») : [x, y, rayon].
  const churches = (await require('../../../services/FaithService').churches(village.playerId, cfg)).map((c) => [c.x, c.y, c.radius]);
  // Infobulle : durée du trajet de chaque unité (minutes par case) ; menu : éclaireurs proposés pour « Espionner ».
  const paces = registry.unitsFor(cfg).map((u) => ({ id: u.id, name: u.name, minutes: u.minutesPerField(cfg) }));
  const spyCount = Math.min(req.ctx.state.units.spy || 0, 5);
  // Marquage à créer depuis le menu d'un village (?mark=player:12) : formulaire pré-rempli.
  const markMatch = /^(player|tribe|village):(\d+)$/.exec(String(req.query.mark || ''));
  const markForm = markMatch ? { type: markMatch[1], targetId: Number(markMatch[2]), label: String(req.query.label || '') } : null;
  res.render('map', {
    page: 'map', cx, cy, sel, displaySize, miniSize, prefs, steps: STEPS, layers,
    paces, spyCount, search, templates, favorites: vc.favorites, markers: vc.markers, markerColor: MarkerService.DEFAULT_COLOR, markForm,
    mapBoot: { sector: mapView.SECTOR, sectors, farm, mini: miniVillages, attacks, churches, worldSize: cfg.mapSize, attackDots: res.locals.attackDots(), attackIcon: res.locals.icon('attack', 'size-[10px]', 3) },
  });
}));

// Carte : villages d'un secteur de 20 × 20 cases, chargé par le navigateur pendant les déplacements.
router.get('/map/sector', ah(async (req, res) => {
  const sx = Number.parseInt(req.query.sx, 10);
  const sy = Number.parseInt(req.query.sy, 10);
  const max = Math.ceil(req.ctx.cfg.mapSize / mapView.SECTOR);
  if (!(sx >= 0 && sy >= 0 && sx < max && sy < max)) throw new GameError('Secteur hors de la carte.', 404);
  res.json(await mapView.sector(await mapView.viewContext(req.ctx.village, req.ctx.cfg), sx, sy));
}));

// Carte : plusieurs secteurs d'un coup (?s=sx.sy,sx.sy…, 16 au plus) — une seule série de requêtes pour le bloc
// de secteurs qui entre dans la vue.
router.get('/map/sectors', ah(async (req, res) => {
  const max = Math.ceil(req.ctx.cfg.mapSize / mapView.SECTOR);
  const list = String(req.query.s || '').split(',').slice(0, 16).map((p) => p.split('.').map((n) => Number.parseInt(n, 10)))
    .filter(([sx, sy]) => sx >= 0 && sy >= 0 && sx < max && sy < max);
  res.json(await mapView.sectors(await mapView.viewContext(req.ctx.village, req.ctx.cfg), list));
}));

// Mini-carte recentrée : points colorés des villages du carré.
router.get('/map/mini', ah(async (req, res) => {
  // Côté en cases : il suit la largeur de la mini-carte (5 px par case).
  const size = Math.min(300, Math.max(10, Number.parseInt(req.query.size, 10) || 50));
  const x0 = Number.parseInt(req.query.x0, 10) || 0;
  const y0 = Number.parseInt(req.query.y0, 10) || 0;
  res.json(await mapView.mini(await mapView.viewContext(req.ctx.village, req.ctx.cfg), x0, y0, size));
}));

// Tailles de la carte et de la mini-carte, position de la mini-carte : appliquées en direct par map.js, puis
// mémorisées ici.
router.post('/map/settings', ah(async (req, res) => {
  const player = await Player.findByPk(me(req));
  const saved = player.mapSettings || {};
  const prefs = mapPrefs(saved);
  if (STEPS.includes(Number(req.body.step))) prefs.step = Number(req.body.step);
  if (STEPS.includes(Number(req.body.miniStep))) prefs.miniStep = Number(req.body.miniStep);
  if (MINI_POSITIONS.includes(req.body.miniPos)) prefs.miniPos = req.body.miniPos;
  share(prefs, req.body.miniStep && !req.body.step ? 'miniStep' : 'step');
  const { size, mini, mapZoomV2, mapMiniZoomV2, ...rest } = saved;
  await player.update({ mapSettings: { ...rest, ...prefs } });
  if (req.get('accept') === 'application/json') return res.json(prefs);
  res.redirect(`${base(req)}/map`);
}));

// Carte du monde (fenêtre ouverte par map.js) : un point par village (relation, marquage), comme la mini-carte.
router.get('/map/world', ah(async (req, res) => {
  const vc = await mapView.viewContext(req.ctx.village, req.ctx.cfg);
  const villages = await MapService.worldMap(req.ctx.village.worldId);
  res.json({ size: req.ctx.cfg.mapSize, villages: villages.map((v) => mapView.point(vc, v)) });
}));

// Calques de la carte : interrupteur mémorisé sur le joueur (appel de game.js).
router.post('/map/layers', ah(async (req, res) => {
  const layer = String(req.body.layer || '');
  if (!Object.prototype.hasOwnProperty.call(MAP_LAYERS, layer)) throw new GameError('Calque inconnu.', 404);
  const player = await Player.findByPk(me(req));
  const saved = player.mapSettings || {};
  await player.update({ mapSettings: { ...saved, layers: { ...(saved.layers || {}), [layer]: req.body.on === '1' } } });
  res.json({ ok: true });
}));

// Marquages de la carte : ajout (ou changement de couleur) et suppression.
router.post('/map/markers', ah(async (req, res) => {
  await MarkerService.set(me(req), req.ctx.village.worldId, {
    type: req.body.type, targetId: req.body.targetId, target: req.body.target, color: req.body.color,
  });
  // Le nouveau marquage doit se voir : le calque Marquages est réactivé s'il était masqué.
  const player = await Player.findByPk(me(req));
  const saved = player.mapSettings || {};
  if (saved.layers && saved.layers.markers === false) {
    await player.update({ mapSettings: { ...saved, layers: { ...saved.layers, markers: true } } });
  }
  flash(req, 'success', 'Marquage enregistré.');
  res.redirect(`${base(req)}/map#marquages`);
}));

router.post('/map/markers/:markerId/delete', ah(async (req, res) => {
  await MarkerService.remove(me(req), req.params.markerId);
  flash(req, 'success', 'Marquage supprimé.');
  res.redirect(`${base(req)}/map#marquages`);
}));

module.exports = router;
