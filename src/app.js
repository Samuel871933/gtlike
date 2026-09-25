'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const config = require('./config');
const { sequelize } = require('./models');
const helpers = require('./web/helpers');
const { loadUser, errorHandler } = require('./web/middleware');
const csrf = require('./web/csrf');

function createApp() {
  const app = express();
  const sessionStore = new SequelizeStore({ db: sequelize, tableName: 'Sessions' });

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProduction, maxAge: 30 * 86400000 },
  }));

  app.use((req, res, next) => {
    Object.assign(res.locals, helpers, { now: new Date(), ctx: null, page: null, unreadReports: 0, incomingAttacks: 0, myVillages: [], tribeInvites: 0, unreadMessages: 0, player: null, playerRank: null, gameStyle: null, asSitter: false });
    next();
  });
  app.use(loadUser);
  app.use(csrf);

  app.use(require('./web/routes/auth'));
  app.use(require('./web/routes/worlds'));
  app.use('/village/:villageId', require('./web/routes/village'));

  app.use((req, res) => res.status(404).render('error', { message: 'Page introuvable.' }));
  app.use(errorHandler);

  app.sessionStore = sessionStore;
  return app;
}

module.exports = createApp;
