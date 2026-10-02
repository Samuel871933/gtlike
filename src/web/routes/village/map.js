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

// Tailles proposées (comme sur Guerre Tribale) et calques de la carte, mémorisés sur le joueur (mapSettings).
const MAP_SIZES = [4, 5, 7, 9, 11, 13, 15, 20, 30];
const MINI_SIZES = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
const MAP_LAYERS = { influence: true, enemy: true, nobarb: false, grid: false, borders: true, markers: true, moves: true, church: true };

router.get('/map', ah(async (req, res) => {
  const { village, cfg } = req.ctx;
  const vc = await mapView.viewContext(village, cfg);
  const { player } = vc;
  const saved = player.mapSettings || {};
  // Taille choisie dans « Taille de la carte » : appliquée puis mémorisée ; sinon celle mémorisée.
  const pick = (value, list, fallback) => (list.includes(Number(value)) ? Number(value) : fallback);
  // Les anciennes grandes tailles enregistrées donnaient une vue initiale trop éloignée. On les ramène
  // une fois à 15 × 15 ; l'utilisateur peut toujours sélectionner explicitement 20 ou 30 ensuite.
  const savedSize = pick(saved.size, MAP_SIZES, 13);
  const normalizedSavedSize = saved.mapZoomV2 ? savedSize : Math.min(savedSize, 15);
  const displaySize = pick(req.query.size, MAP_SIZES, normalizedSavedSize);
  const savedMiniSize = pick(saved.mini, MINI_SIZES, 50);
  const normalizedMiniSize = saved.mapMiniZoomV2 ? savedMiniSize : Math.min(savedMiniSize, 50);
  const miniSize = pick(req.query.mini, MINI_SIZES, normalizedMiniSize);
  if (displaySize !== saved.size || miniSize !== saved.mini || !saved.mapZoomV2 || !saved.mapMiniZoomV2) {
    await player.update({ mapSettings: { ...saved, size: displaySize, mini: miniSize, mapZoomV2: true, mapMiniZoomV2: true } });
  }
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
    page: 'map', cx, cy, sel, displaySize, miniSize, mapSizes: MAP_SIZES, miniSizes: MINI_SIZES, layers,
    paces, spyCount, search, templates, favorites: vc.favorites, markers: vc.markers, markerColor: MarkerService.DEFAULT_COLOR, markForm,
    mapBoot: { sector: mapView.SECTOR, sectors, mini: miniVillages, attacks, churches, worldSize: cfg.mapSize, attackDots: res.locals.attackDots() },
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
  const size = MINI_SIZES.includes(Number(req.query.size)) ? Number(req.query.size) : 50;
  const x0 = Number.parseInt(req.query.x0, 10) || 0;
  const y0 = Number.parseInt(req.query.y0, 10) || 0;
  res.json(await mapView.mini(await mapView.viewContext(req.ctx.village, req.ctx.cfg), x0, y0, size));
}));

// Tailles de la carte et de la mini-carte : appliquées en direct par map.js, puis mémorisées ici.
router.post('/map/settings', ah(async (req, res) => {
  const player = await Player.findByPk(me(req));
  const saved = player.mapSettings || {};
  const size = MAP_SIZES.includes(Number(req.body.size)) ? Number(req.body.size) : saved.size;
  const mini = MINI_SIZES.includes(Number(req.body.mini)) ? Number(req.body.mini) : saved.mini;
  await player.update({ mapSettings: { ...saved, size, mini } });
  if (req.get('accept') === 'application/json') return res.json({ size, mini });
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
