'use strict';

// Tables des modes de jeu : chaque mode qui en a besoin fournit src/modes/<id>/model.js. Appelé à la fin de
// src/models/index.js, avec les modèles de base déjà définis (pour les associations).

const { MODES } = require('./catalog');

module.exports = function defineModeModels(sequelize, models) {
  const out = {};
  for (const id of Object.keys(MODES)) {
    let define;
    try {
      define = require(`./${id}/model`);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' && err.message.includes(`${id}/model`)) continue;
      throw err;
    }
    Object.assign(out, define(sequelize, models));
  }
  return out;
};
