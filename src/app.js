'use strict';

const path = require('path');
const express = require('express');
const compression = require('compression');
const multer = require('multer');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const config = require('./config');
const { sequelize } = require('./models');
const helpers = require('./web/helpers');
const { loadUser, errorHandler } = require('./web/middleware');
const csrf = require('./web/csrf');
const ImageService = require('./services/ImageService');
const GameError = require('./services/GameError');

const avatarParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: ImageService.MAX_BYTES, files: 1, fields: 4 } }).single('image');
function avatarUpload(req, res, next) {
  avatarParser(req, res, (err) => {
    if (!err) return next();
    next(new GameError(err.code === 'LIMIT_FILE_SIZE' ? "L'image est trop lourde (5 Mo au plus)." : "Envoi de l'image impossible."));
  });
}

function createApp() {
  const app = express();
  const sessionStore = new SequelizeStore({ db: sequelize, tableName: 'Sessions' });

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  if (config.isProduction) app.set('trust proxy', 1);

  // Pages, CSS, JS et JSON de la carte compressés (gzip) : les secteurs de la carte sont lus en continu.
  app.use(compression());
  // Images : gardées un jour par le navigateur en production (sinon revalidées à chaque page, des dizaines de
  // requêtes sur la carte). Une image modifiée en profondeur change de nom (-v2, ?v=2…).
  app.use('/img', express.static(path.join(__dirname, '..', 'public', 'img'), { maxAge: config.isProduction ? '1d' : 0 }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/robots.txt', (req, res) => {
    const sitemap = config.siteUrl ? `Sitemap: ${config.siteUrl}/sitemap.xml\n` : '';
    res.type('text/plain').send(`User-agent: *\nAllow: /\n${sitemap}`);
  });
  app.get('/sitemap.xml', (req, res) => {
    if (!config.siteUrl) return res.sendStatus(404);
    const pages = ['/', '/register', '/rules', '/help', '/mentions-legales', '/cgu', '/cgv', '/confidentialite', '/cookies'];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>${config.siteUrl}${page}</loc></url>`).join('')}</urlset>`);
  });
  // Images de profil envoyées par les joueurs (WebP déjà réduits, noms changés à chaque envoi).
  app.use('/uploads/avatars', express.static(ImageService.DIR, { maxAge: '30d', immutable: true }));
  // Terrain de la carte, partagé avec le serveur (src/game/terrain.js).
  app.get('/js/terrain.js', (req, res) => res.sendFile(path.join(__dirname, 'game', 'terrain.js')));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProduction, maxAge: 30 * 86400000 },
  }));

  app.use((req, res, next) => {
    Object.assign(res.locals, helpers, { now: new Date(), ctx: null, page: null, unreadReports: 0, incomingAttacks: 0, myVillages: [], tribeInvites: 0, unreadMessages: 0, player: null, playerRank: null, gameStyle: null, villageDesign: null, gameLayout: null, asSitter: false, happyPopup: null });
    const publicPages = {
      '/': { title: 'Jeu de stratégie et de gestion en ligne', description: 'Adarma est un jeu de stratégie et de gestion gratuit sur navigateur. Développe ton village, produis des ressources, forme ton armée et conquiers des territoires avec ta tribu.', canonical: '/' },
      '/login': { title: 'Jeu de stratégie et de gestion en ligne', description: 'Adarma est un jeu de stratégie et de gestion gratuit sur navigateur. Développe ton village, produis des ressources, forme ton armée et conquiers des territoires avec ta tribu.', canonical: '/' },
      '/register': { title: 'Inscription gratuite au jeu de stratégie', description: 'Crée ton compte Adarma gratuitement. Construis ton village, gère tes ressources, rejoins une tribu et pars à la conquête de mondes persistants.', canonical: '/register' },
      '/rules': { title: 'Règles du jeu de stratégie', description: 'Consulte les règles d’Adarma : comptes, alliances, automatisation et respect des autres joueurs dans ce jeu de stratégie sur navigateur.', canonical: '/rules' },
      '/help': { title: 'Guide du jeu de stratégie et de gestion', description: 'Apprends à développer ton village, gérer les ressources, recruter des troupes, conquérir des territoires et jouer en tribu sur Adarma.', canonical: '/help' },
      '/mentions-legales': { title: 'Mentions légales', description: 'Éditeur, directeur de la publication et hébergeur du jeu de stratégie Adarma.', canonical: '/mentions-legales' },
      '/cgu': { title: 'Conditions générales d’utilisation', description: 'Les conditions d’utilisation du jeu Adarma : compte, règles, sanctions et suppression du compte.', canonical: '/cgu' },
      '/cgv': { title: 'Conditions générales de vente', description: 'Les conditions de vente de la boutique Adarma : packs d’Adartons, articles cosmétiques et premium.', canonical: '/cgv' },
      '/confidentialite': { title: 'Politique de confidentialité', description: 'Les données personnelles traitées par Adarma, leurs durées de conservation et vos droits.', canonical: '/confidentialite' },
      '/cookies': { title: 'Cookies et stockage local', description: 'Les cookies et données de navigateur utilisés par Adarma, tous strictement nécessaires.', canonical: '/cookies' },
    };
    res.locals.seo = req.method === 'GET' && res.locals.ctx === null ? publicPages[req.path] || null : null;
    res.locals.siteUrl = config.siteUrl;
    next();
  });
  app.use(loadUser);
  // Formulaires d'image de profil (multipart) : lus en mémoire avant le contrôle CSRF, qui a besoin de `_csrf`.
  app.post(/^\/village\/\d+\/(profile|tribe)\/avatar$/, avatarUpload);
  app.use(csrf);

  app.use(require('./web/routes/auth'));
  app.use(require('./web/routes/worlds'));
  app.use(require('./web/routes/forum'));
  app.use(require('./web/routes/shop'));
  app.use(require('./web/routes/legal'));
  app.use('/village/:villageId', require('./web/routes/village'));

  app.use((req, res) => res.status(404).render('error', { message: 'Page introuvable.' }));
  app.use(errorHandler);

  app.sessionStore = sessionStore;
  return app;
}

module.exports = createApp;
