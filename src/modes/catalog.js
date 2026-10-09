'use strict';

/*
  Modes de jeu : données seules (aucun service, aucune vue), lues par WorldConfig et le formulaire de création de
  serveur. Le comportement d'un mode (vues, règles en plus, routes) est dans src/modes/<id>/index.js, branché par
  src/modes/index.js.

  Un mode est une extension du moteur de base : il ne modifie ni les formules, ni les bâtiments, ni les unités, ni les
  réglages du monde. Le mode classique n'ajoute rien.

  Chaque entrée :
    id, name, description
    config    réglages propres au mode, rangés sous world.config[id] (fusionnés avec ces valeurs par défaut)
    settings  réglages proposés à la création d'un serveur (mêmes champs que src/game/serverSettings.js)
*/

const MODES = {
  classic: {
    id: 'classic',
    name: 'Classique',
    description: 'Le jeu de base : villages, terres et forêts.',
  },
  zeppelin: {
    id: 'zeppelin',
    name: 'Zeppelin',
    // Style de jeu imposé dans ce mode (son CSS redéfinit les couleurs de ce style, voir zeppelin/zeppelin.css).
    gameStyle: 'roman',
    description: 'Chaque village devient un zeppelin, au-dessus d’une mer de nuages. Mêmes règles que le mode classique, mais le vaisseau peut changer de place sur la carte.',
    config: {
      // Minutes par case pour déplacer le vaisseau, à vitesse ×1 (divisées par la vitesse du monde et des unités,
      // comme les troupes : le bélier est à 30, la cavalerie légère à 10).
      minutesPerField: 30,
      // Distance maximale d'un vol, en cases. 0 : sans limite.
      maxDistance: 20,
      // Attente après un atterrissage avant de pouvoir repartir (minutes réelles, divisées par la vitesse du monde).
      cooldownMinutes: 120,
    },
    settings: [
      { key: 'zeppelin.minutesPerField', label: 'Vitesse du vaisseau (minutes par case)', type: 'number', min: 1, max: 120, step: 1, hint: 'Durée d’un vol d’une case à vitesse ×1, divisée ensuite par la vitesse du monde et des unités, comme pour les troupes (bélier : 30, cavalerie légère : 10).' },
      { key: 'zeppelin.maxDistance', label: 'Distance maximale d’un vol (cases)', type: 'number', min: 0, max: 200, step: 1, hint: 'Un vaisseau ne peut pas se poser plus loin que cette distance de sa position. 0 : sans limite.' },
      { key: 'zeppelin.cooldownMinutes', label: 'Attente entre deux vols (minutes)', type: 'number', min: 0, max: 1440, step: 5, hint: 'Après un atterrissage, le vaisseau reste à quai ce temps avant de pouvoir repartir (divisé par la vitesse du monde).' },
    ],
  },
};

const DEFAULT_MODE = 'classic';

const isMode = (id) => Object.prototype.hasOwnProperty.call(MODES, id);

/** Mode d'une configuration de monde (WorldConfig ou objet brut). */
const modeIdOf = (cfg) => (cfg && isMode(cfg.mode) ? cfg.mode : DEFAULT_MODE);

module.exports = { MODES, DEFAULT_MODE, isMode, modeIdOf };
