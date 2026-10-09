'use strict';

/*
  Points d'accroche des modes de jeu (extensions du moteur de base). Le moteur appelle ces fonctions à quelques
  endroits précis ; sur un monde classique, aucune ne fait rien. Un mode (src/modes/<id>/index.js) peut fournir :

    beforeLoad(village, now)   avant le chargement d'une page de village (renvoie true si le village a changé)
    guard(action, ctx, t)      refuse une action du moteur en levant une GameError ('command' : envoi de troupes,
                               'trade' : envoi de marchands)
    tick(now)                  à chaque tour de la boucle de jeu (src/services/GameLoop.js)
    viewLocals(ctx)            valeurs des vues qui remplacent les helpers de même nom (noms, images, plan…)
    router()                   routeur monté sous /village/:villageId/<id>
    mapScripts                 scripts de la carte chargés après public/js/map.js
    panels                     encarts (chemins de vues EJS) au-dessus du plan, dans l'aperçu du village

  Tables propres à un mode : src/modes/<id>/model.js (voir ./models.js) et une migration dans migrations/.
*/

const { MODES, modeIdOf } = require('./catalog');

const loaded = new Map();
function runtime(id) {
  if (!loaded.has(id)) {
    let mod = MODES[id];
    try {
      mod = require(`./${id}`);
    } catch (err) {
      if (!(err.code === 'MODULE_NOT_FOUND' && err.message.includes(`'./${id}'`))) throw err;
    }
    loaded.set(id, mod);
  }
  return loaded.get(id);
}

/** Mode d'un monde, à partir de sa configuration. */
const modeOf = (cfg) => runtime(modeIdOf(cfg));
const all = () => Object.keys(MODES).map(runtime);

async function beforeLoad(cfg, village, now) {
  const m = modeOf(cfg);
  return m.beforeLoad ? m.beforeLoad(village, now) : false;
}

async function guard(action, ctx, t) {
  const m = modeOf(ctx.cfg);
  if (m.guard) await m.guard(action, ctx, t);
}

async function tick(now) {
  for (const m of all()) if (m.tick) await m.tick(now);
}

/** Valeurs des vues d'un village : `mode` (entrée du catalogue) et ce que le mode remplace. */
async function viewLocals(ctx) {
  const m = modeOf(ctx.cfg);
  return { mode: MODES[m.id], modeScripts: m.mapScripts || [], modePanels: m.panels || [], ...(m.viewLocals ? await m.viewLocals(ctx) : {}) };
}

/** Routeurs des modes : [[id, router]]. */
const routers = () => all().filter((m) => m.router).map((m) => [m.id, m.router()]);

module.exports = { MODES, modeOf, beforeLoad, guard, tick, viewLocals, routers };
