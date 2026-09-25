'use strict';

const crypto = require('crypto');

/**
 * Protection CSRF par jeton de session : chaque formulaire POST envoie `_csrf`,
 * comparé en temps constant au jeton stocké dans la session.
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('base64url');
  res.locals.csrfToken = req.session.csrfToken;
  if (req.method !== 'POST') return next();

  const sent = Buffer.from(String(req.body?._csrf || ''));
  const expected = Buffer.from(req.session.csrfToken);
  if (sent.length === expected.length && crypto.timingSafeEqual(sent, expected)) return next();
  res.status(403).render('error', { message: 'Formulaire expiré ou invalide. Rechargez la page et réessayez.' });
}

module.exports = csrf;
