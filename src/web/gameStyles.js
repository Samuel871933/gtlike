'use strict';

/*
  Styles de jeu : l'habillage de toute l'interface en partie (couleurs, polices, images comme le fond du
  village). La page d'accueil n'en dépend pas. Chaque style a :
    - une entrée ici (nom, description, polices à charger) ;
    - un fichier src/styles/game-styles/<id>.css qui redéfinit les jetons sous [data-game-style="<id>"] ;
    - ses images dans public/img/game-styles/<id>/.
  En jeu, <html> porte la classe `game_style` et l'attribut data-game-style="<id>".
  Tous les styles sont gratuits pour l'instant ; le compte choisit le sien (User.gameStyle).
*/

const GAME_STYLES = {
  roman: {
    id: 'roman',
    name: 'Romain',
    description: 'Encre, rouge sang et bronze : la grandeur de l’Empire.',
    fonts: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Cinzel:wght@700;900&display=swap',
  },
  viking: {
    id: 'viking',
    name: 'Viking',
    description: 'Fer, givre et palissades de bois : les terres du Nord.',
    fonts: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Grenze:wght@400;600;700;800&display=swap',
  },
};

const DEFAULT_GAME_STYLE = 'roman';

/** Le style existe-t-il ? */
const isGameStyle = (id) => Object.prototype.hasOwnProperty.call(GAME_STYLES, id);

/** Style de jeu d'un compte : son choix s'il existe encore, sinon le style par défaut. */
function gameStyleFor(user) {
  const id = user && user.gameStyle;
  return GAME_STYLES[isGameStyle(id) ? id : DEFAULT_GAME_STYLE];
}

module.exports = { GAME_STYLES, DEFAULT_GAME_STYLE, isGameStyle, gameStyleFor };
