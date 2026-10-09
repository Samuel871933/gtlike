'use strict';

// Pages d'un village (/village/:villageId/…) : connexion exigée, village chargé et vérifié par loadVillage, puis une
// série de routeurs par thème. L'ordre compte peu (pas d'adresses partagées entre thèmes).

const express = require('express');
const { requireAuth, loadVillage } = require('../../middleware');
const GameError = require('../../../services/GameError');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, loadVillage);
// Matchup : pages sans objet dans une partie classée (premium, classement du monde, pages publiques de tribu, quitter
// le monde ou la tribu) : introuvables. L'assistant de pillage (premium) l'est aussi, mais pas l'envoi d'un modèle
// (/farm/send), qui sert aussi aux raccourcis d'attaque de la carte.
const NOT_IN_MATCH = /^\/(manager|farm($|\/settings|\/\d+\/forget)|ranking|invite$|account\/leave-world|tribes\/|tribe\/(leave|invite|members|relations|rights|create|description|avatar|announcement))/;
router.use((req, res, next) => (res.locals.inMatch && NOT_IN_MATCH.test(req.path) ? next(new GameError('Indisponible pendant une partie du matchup.', 404)) : next()));
for (const area of ['overview', 'buildings', 'place', 'incomings', 'market', 'tribe', 'social', 'account', 'reports', 'ranking', 'map', 'farm', 'seals', 'manager', 'rewards']) {
  router.use(require(`./${area}`));
}

// Pages propres à un mode de jeu (src/modes) : /village/:id/<mode>/…, seulement sur un monde de ce mode.
for (const [id, modeRouter] of require('../../../modes').routers()) {
  router.use(`/${id}`, (req, res, next) => (req.ctx.cfg.mode === id ? next() : next(new GameError('Page introuvable.', 404))), modeRouter);
}

module.exports = router;
