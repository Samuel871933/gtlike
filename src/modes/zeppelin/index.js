'use strict';

// Mode Zeppelin : chaque village est un vaisseau au-dessus d'une mer de nuages. Extension du moteur de base, branchée
// par src/modes/index.js : habillage des vues (view.js, CSS, images), et une seule règle en plus, le vol du vaisseau
// (FlightService.js), qui interdit d'envoyer troupes et marchands pendant le vol.

const { MODES } = require('../catalog');
const GameError = require('../../services/GameError');

const flights = () => require('./FlightService');

module.exports = {
  ...MODES.zeppelin,

  /** Atterrissages échus du monde, avant de charger une page d'un village (la page voit sa nouvelle case). */
  async beforeLoad(village, now) {
    return (await flights().landDue(now, { worldId: village.worldId })) > 0;
  },

  /** Règles en plus : un vaisseau en vol n'envoie ni troupes ni marchands. */
  async guard(action, ctx, t) {
    if (!['command', 'trade'].includes(action)) return;
    if (await flights().inFlight(ctx.village.id, t)) {
      throw new GameError(action === 'trade' ? 'Le vaisseau est en vol : les marchands partiront à l’atterrissage.' : 'Le vaisseau est en vol : les troupes ne peuvent pas débarquer avant l’atterrissage.');
    }
  },

  /** Boucle de jeu : atterrissages de tous les mondes, même sans joueur connecté. */
  tick: (now) => flights().landDue(now),

  async viewLocals(ctx) {
    return { ...require('./view'), zeppelinShip: await flights().status(ctx.village.id, ctx.cfg, ctx.now) };
  },

  router: () => require('./routes'),
  mapScripts: ['/js/modes/zeppelin-map.js'],
  panels: [require('path').join(__dirname, 'views', 'ship-panel.ejs')],
};
