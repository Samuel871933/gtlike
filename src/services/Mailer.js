'use strict';

/*
  Envoi des e-mails du jeu (réinitialisation du mot de passe, notifications d'attaque du gestionnaire de compte).

  Transport : SMTP dès que SMTP_HOST est configuré (voir .env.example : SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
  SMTP_PASS, MAIL_FROM), sinon le message est seulement écrit dans les logs du serveur (développement). Les tests
  n'envoient jamais rien : les derniers messages restent lisibles dans outbox().

  sendTemplate : le gabarit commun (views/mail/layout.ejs) en HTML, avec sa version texte ; les images (logo, en-tête
  dédiés aux e-mails) sont jointes au message (cid), elles s'affichent sans site public.
*/

const path = require('path');
const ejs = require('ejs');
const config = require('../config');

const sent = [];
const IMG = path.join(__dirname, '..', '..', 'public', 'img', 'mail');
// Bandeaux dédiés aux e-mails : JPEG optimisés 1200 × 400, affichés à 600 px.
const HEADERS = { attack: 'attack-v2.jpg', account: 'account-v2.jpg' };

let transport;
/** Transport SMTP (nodemailer), créé à la première utilisation ; nul sans SMTP_HOST (logs seulement). */
function smtp() {
  if (transport !== undefined) return transport;
  const { host, port, secure, user, pass } = config.mail;
  transport = host
    ? require('nodemailer').createTransport({ host, port, secure, ...(user ? { auth: { user, pass } } : {}) })
    : null;
  return transport;
}

/**
 * Envoie un message ({ to, subject, text, html, attachments }). Une erreur d'envoi est écrite dans les logs sans
 * interrompre l'action qui l'a demandé (réinitialisation, passage du gestionnaire).
 */
async function send({ to, subject, text, html = null, attachments = [] }) {
  const message = { to, subject, text, html, at: new Date() };
  sent.push(message);
  if (sent.length > 20) sent.shift();
  if (process.env.NODE_ENV === 'test') return message;
  const smtpTransport = smtp();
  if (!smtpTransport) {
    console.log(`[mail] À : ${to}\n[mail] Objet : ${subject}\n${text.split('\n').map((l) => `[mail] ${l}`).join('\n')}`);
    return message;
  }
  try {
    await smtpTransport.sendMail({ from: config.mail.from, to, subject, text, ...(html ? { html } : {}), attachments });
  } catch (err) {
    console.error('[mail] envoi impossible', to, subject, err.message);
  }
  return message;
}

/**
 * Message au gabarit commun : { to, subject, header ('attack' | 'account'), preheader, title, intro (texte),
 * body (HTML déjà échappé), action ({ label, url }), footer (texte), text (version texte, obligatoire) }.
 */
async function sendTemplate({ to, subject, header = 'account', preheader = '', title, intro = '', body = '', action = null, footer = '', text }) {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'mail', 'layout.ejs'), {
    subject, preheader, title, intro, body, action, footer,
  });
  const attachments = [
    { filename: 'adarma.png', path: path.join(IMG, 'logo.png'), cid: 'logo' },
    { filename: 'en-tete.jpg', path: path.join(IMG, HEADERS[header] || HEADERS.account), cid: 'header' },
  ];
  return send({ to, subject, text, html, attachments });
}

/** Adresse complète d'une page du site (SITE_URL), ou nulle s'il n'est pas configuré. */
const siteLink = (pathname) => (config.siteUrl ? `${config.siteUrl}${pathname}` : null);

/** Derniers messages envoyés (tests). */
const outbox = () => sent;

module.exports = { send, sendTemplate, siteLink, outbox, HEADERS };
