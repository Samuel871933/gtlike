'use strict';

const express = require('express');

const router = express.Router();

// Pages légales, publiques (sans connexion) : adresse → vue de src/views/legal.
const LEGAL_PAGES = {
  '/mentions-legales': 'mentions-legales',
  '/cgu': 'cgu',
  '/cgv': 'cgv',
  '/confidentialite': 'confidentialite',
  '/cookies': 'cookies',
};

for (const [path, view] of Object.entries(LEGAL_PAGES)) {
  router.get(path, (req, res) => res.render(`legal/${view}`, { lobbyPage: 'legal', legalPage: path }));
}

module.exports = router;
module.exports.LEGAL_PAGES = LEGAL_PAGES;
