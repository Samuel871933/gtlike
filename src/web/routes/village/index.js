'use strict';

// Pages d'un village (/village/:villageId/…) : connexion exigée, village chargé et vérifié par loadVillage, puis une
// série de routeurs par thème. L'ordre compte peu (pas d'adresses partagées entre thèmes).

const express = require('express');
const { requireAuth, loadVillage } = require('../../middleware');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, loadVillage);
for (const area of ['overview', 'buildings', 'place', 'incomings', 'market', 'tribe', 'social', 'account', 'reports', 'ranking', 'map', 'farm']) {
  router.use(require(`./${area}`));
}

module.exports = router;
