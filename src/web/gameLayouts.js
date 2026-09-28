'use strict';

/*
  Style de jeu (Compte → Style de jeu) : la densité de l'interface en partie, indépendante du thème de jeu (gameStyles.js).
    - normal : l'interface aérée d'origine (grands en-têtes, ombres portées, traits d'encre épais) ;
    - minimaliste (par défaut) : encarts serrés à la Guerre Tribale (en-têtes fins, marges et tailles réduites, contenu moins large).
  En jeu, <html> porte l'attribut data-game-layout="<id>" ; la variante Tailwind `minimal:` (src/styles/app.css)
  permet d'ajuster un composant, et l'échelle d'espacement (--spacing) y est réduite pour tout le jeu.
  Gratuit ; le compte choisit le sien (User.gameLayout).
*/

const GAME_LAYOUTS = {
  minimal: {
    id: 'minimal',
    name: 'Minimaliste',
    description: 'Encarts serrés et en-têtes fins, comme sur Guerre Tribale : plus d’informations à l’écran.',
  },
  normal: {
    id: 'normal',
    name: 'Normal',
    description: 'Encarts aérés, grands en-têtes et ombres portées.',
  },
};

// Style par défaut : minimaliste, au plus près de Guerre Tribale.
const DEFAULT_GAME_LAYOUT = 'minimal';

/** Le style de jeu existe-t-il ? */
const isGameLayout = (id) => Object.prototype.hasOwnProperty.call(GAME_LAYOUTS, id);

/** Style de jeu d'un compte : son choix s'il existe encore, sinon le style par défaut (minimaliste). */
function gameLayoutFor(user) {
  const id = user && user.gameLayout;
  return GAME_LAYOUTS[isGameLayout(id) ? id : DEFAULT_GAME_LAYOUT];
}

module.exports = { GAME_LAYOUTS, DEFAULT_GAME_LAYOUT, isGameLayout, gameLayoutFor };
