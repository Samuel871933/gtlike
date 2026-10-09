'use strict';

// Pages du mode Zeppelin, montées sous /village/:villageId/zeppelin (seulement sur un monde en mode Zeppelin, voir
// src/modes/index.js). Réponses JSON pour la carte, redirection avec message pour les formulaires.

const express = require('express');
const { ah, flash } = require('../../web/middleware');
const { base } = require('../../web/routes/village/shared');
const GameError = require('../../services/GameError');
const FlightService = require('./FlightService');

const router = express.Router({ mergeParams: true });
const wantsJson = (req) => (req.get('accept') || '').includes('application/json');

// Vols en cours du monde (carte : positions interpolées entre départ et arrivée).
router.get('/flights', ah(async (req, res) => {
  res.json({ now: Date.now(), flights: await FlightService.flightsFor(req.ctx.village.worldId) });
}));

// Aperçu d'un vol vers (x, y) : durée et arrivée, ou la raison du refus.
router.get('/plan', ah(async (req, res) => {
  try {
    const p = await FlightService.plan(req.ctx, { x: req.query.x, y: req.query.y });
    res.json({ seconds: p.seconds, arrivesAt: p.arrivesAt.getTime() });
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    res.json({ error: err.message });
  }
}));

router.post('/move', ah(async (req, res) => {
  try {
    const p = await FlightService.launch(req.ctx.village.id, { x: req.body.x, y: req.body.y });
    if (wantsJson(req)) return res.json({ ok: true, seconds: p.seconds, arrivesAt: p.arrivesAt.getTime() });
    flash(req, 'success', `Le vaisseau décolle vers ${p.to.x}|${p.to.y}.`);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    if (wantsJson(req)) return res.status(400).json({ error: err.message });
    flash(req, 'error', err.message);
  }
  return res.redirect(`${base(req)}/map?x=${Number(req.body.x) || ''}&y=${Number(req.body.y) || ''}`);
}));

module.exports = router;
