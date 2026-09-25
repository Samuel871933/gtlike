'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');
const GameError = require('./GameError');

const USERNAME_RE = /^[A-Za-z0-9_\-. ]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
}

module.exports = AuthService;
