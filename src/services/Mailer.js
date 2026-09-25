'use strict';

/*
  Envoi des e-mails du jeu (réinitialisation du mot de passe).
  Aucun serveur d'envoi n'est configuré : le message est écrit dans les logs du serveur, ce qui suffit en
  développement. Pour la production, brancher ici un vrai transport (SMTP, API d'un fournisseur).
*/

const sent = [];

async function send({ to, subject, text }) {
  const message = { to, subject, text, at: new Date() };
  sent.push(message);
  if (sent.length > 20) sent.shift();
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[mail] À : ${to}\n[mail] Objet : ${subject}\n${text.split('\n').map((l) => `[mail] ${l}`).join('\n')}`);
  }
  return message;
}

/** Derniers messages envoyés (tests). */
const outbox = () => sent;

module.exports = { send, outbox };
