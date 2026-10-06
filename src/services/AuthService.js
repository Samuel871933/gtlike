'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, PasswordReset } = require('../models');
const Mailer = require('./Mailer');
const GameError = require('./GameError');

const USERNAME_RE = /^[A-Za-z0-9_\-. ]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_MAX_PER_HOUR = 3;
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

class AuthService {
  static async register({ username, email, password }) {
    username = String(username || '').trim();
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');

    if (!USERNAME_RE.test(username)) {
      throw new GameError('Le pseudo doit faire 3 à 24 caractères (lettres, chiffres, espace, _ - .).');
    }
    if (!EMAIL_RE.test(email)) throw new GameError('Adresse e-mail invalide.');
    if (password.length < 8) throw new GameError('Le mot de passe doit faire au moins 8 caractères.');

    const existing = await User.findOne({ where: { [Op.or]: [{ username }, { email }] } });
    if (existing) {
      throw new GameError(existing.username === username ? 'Ce pseudo est déjà pris.' : 'Cette adresse e-mail est déjà utilisée.');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    return User.create({ username, email, passwordHash });
  }

  static async login({ login, password }) {
    const value = String(login || '').trim();
    const user = await User.findOne({ where: { [Op.or]: [{ username: value }, { email: value.toLowerCase() }] } });
    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
      throw new GameError('Identifiants incorrects.', 401);
    }
    return user;
  }

  /**
   * « Mot de passe oublié » : envoie un lien de réinitialisation valable une heure. Ne dit jamais si l'adresse
   * existe (même réponse dans tous les cas) ; au plus trois demandes par heure et par compte.
   */
  static async requestPasswordReset(email, baseUrl, now = new Date()) {
    const address = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(address)) throw new GameError('Adresse e-mail invalide.');
    const user = await User.findOne({ where: { email: address } });
    if (!user) return;
    const recent = await PasswordReset.count({ where: { userId: user.id, createdAt: { [Op.gt]: new Date(now - RESET_TTL_MS) } } });
    if (recent >= RESET_MAX_PER_HOUR) return;
    const token = crypto.randomBytes(32).toString('hex');
    await PasswordReset.create({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS) });
    const link = `${baseUrl}/password/reset/${token}`;
    await Mailer.sendTemplate({
      to: user.email,
      subject: 'Adarma : réinitialisation du mot de passe',
      header: 'account',
      title: 'Nouveau mot de passe',
      intro: `Bonjour ${user.username}, pour choisir un nouveau mot de passe, ouvre ce lien : il est valable une heure.`,
      action: { label: 'Choisir un nouveau mot de passe', url: link },
      footer: 'Si tu n’es pas à l’origine de cette demande, ignore ce message : ton mot de passe ne change pas.',
      text: `Bonjour ${user.username},\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable une heure) :\n${link}\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message.`,
    });
  }

  /** Demande de réinitialisation encore valable pour ce jeton, sinon null. */
  static async findReset(token, now = new Date()) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
    const reset = await PasswordReset.findOne({ where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { [Op.gt]: now } } });
    return reset || null;
  }

  /** Nouveau mot de passe depuis un lien valable ; le lien et les autres demandes du compte deviennent inutilisables. */
  static async resetPassword(token, password, now = new Date()) {
    const reset = await AuthService.findReset(token, now);
    if (!reset) throw new GameError('Ce lien de réinitialisation est invalide ou a expiré.', 400);
    if (String(password || '').length < 8) throw new GameError('Le mot de passe doit faire au moins 8 caractères.');
    const passwordHash = await bcrypt.hash(String(password), 10);
    await User.update({ passwordHash }, { where: { id: reset.userId } });
    await PasswordReset.update({ usedAt: now }, { where: { userId: reset.userId, usedAt: null } });
    return User.findByPk(reset.userId);
  }
}

module.exports = AuthService;
