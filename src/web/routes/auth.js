'use strict';

const express = require('express');
const AuthService = require('../../services/AuthService');
const AccountService = require('../../services/AccountService');
const GameError = require('../../services/GameError');
const { ah, requireAuth } = require('../middleware');

const router = express.Router();

/** Nouvel identifiant de session à la connexion (évite la fixation de session). */
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      resolve();
    });
  });
}

router.get('/', (req, res) => res.redirect(req.user ? '/worlds' : '/login'));

router.get('/register', (req, res) => res.render('register', { form: {}, error: null }));

router.post('/register', ah(async (req, res) => {
  try {
    const user = await AuthService.register(req.body);
    await startSession(req, user);
    res.redirect('/worlds');
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    res.status(400).render('register', { form: req.body, error: err.message });
  }
}));

router.get('/login', (req, res) => res.render('login', {
  form: {}, error: null, notice: req.query.deleted ? 'Votre compte a été supprimé.' : null,
}));

router.post('/login', ah(async (req, res) => {
  try {
    const user = await AuthService.login(req.body);
    await startSession(req, user);
    res.redirect('/worlds');
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    res.status(401).render('login', { form: { login: req.body.login }, error: err.message, notice: null });
  }
}));

router.get('/account', requireAuth, (req, res) => res.render('account-global', { error: null }));

router.post('/account/delete', requireAuth, ah(async (req, res) => {
  try {
    await AccountService.deleteAccount(req.user.id, req.body.password);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    return res.status(err.status).render('account-global', { error: err.message });
  }
  req.session.destroy(() => res.redirect('/login?deleted=1'));
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
