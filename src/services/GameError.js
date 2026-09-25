'use strict';

/** Erreur « métier » affichable au joueur (ressources insuffisantes, file pleine…). */
class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

module.exports = GameError;
