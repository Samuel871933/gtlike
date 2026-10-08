'use strict';

// Classements et fin du monde (pages d'un village, montées par ./index.js).

const express = require('express');
const { ah } = require('../../middleware');
const { base, me, currentPlayer } = require('./shared');

const router = express.Router({ mergeParams: true });

// ------------------------------------------------------------ Classements et fin du monde (dans l'interface du jeu)

router.get('/ranking', ah(async (req, res) => {
  const { rankingLocals } = require('../worlds');
  const viewer = currentPlayer(res);
  res.render('ranking', { page: 'ranking', ...(await rankingLocals(req.ctx.world, req.query, { playerId: viewer.id, tribeId: viewer.tribeId, faction: viewer.faction })) });
}));

// Ancienne adresse de la fin du monde : elle est maintenant dans les classements.
router.get('/victory', (req, res) => res.redirect(`${base(req)}/ranking?type=victory`));

module.exports = router;
