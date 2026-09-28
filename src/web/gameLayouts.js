'use strict';

/*
  Style de jeu (Compte → Style de jeu) : la densité de l'interface en partie, indépendante du thème de jeu (gameStyles.js).
    - normal : l'interface telle quelle ;
    - minimaliste : encarts serrés à la Guerre Tribale (en-têtes fins, marges et tailles réduites, contenu moins large).
  En jeu, <html> porte l'attribut data-game-layout="<id>" ; la variante Tailwind `minimal:` (src/styles/app.css)
  permet d'ajuster un composant, et l'échelle d'espacement (--spacing) y est réduite pour tout le jeu.
  Gratuit ; le compte choisit le sien (User.gameLayout).
*/

const GAME_LAYOUTS = {
  normal: {
    id: 'normal',
    name: 'Normal',
    description: 'Encarts aérés, grands en-têtes et ombres portées.',
  },
  minimal: {
    id: 'minimal',
    name: 'Minimaliste',
    description: 'Encarts serrés et en-têtes fins, comme sur Guerre Tribale : plus d’informations à l’écran.',
  },
};

const DEFAULT_GAME_LAYOUT = 'normal';

/** Le style de jeu existe-t-il ? */
const isGameLayout = (id) => Object.prototype.hasOwnProperty.call(GAME_LAYOUTS, id);

/** Style de jeu d'un compte : son choix s'il existe encore, sinon le style normal. */
function gameLayoutFor(user) {
  const id = user && user.gameLayout;
  return GAME_LAYOUTS[isGameLayout(id) ? id : DEFAULT_GAME_LAYOUT];
}

module.exports = { GAME_LAYOUTS, DEFAULT_GAME_LAYOUT, isGameLayout, gameLayoutFor };
