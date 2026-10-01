'use strict';

/*
  Styles de jeu : l'habillage de toute l'interface en partie (couleurs, polices, images comme le fond du
  village). La page d'accueil n'en dépend pas. Chaque style a :
    - une entrée ici (nom, description, polices à charger) ;
    - un fichier src/styles/game-styles/<id>.css qui redéfinit les jetons sous [data-game-style="<id>"] ;
    - ses images dans public/img/game-styles/<id>/.
  En jeu, <html> porte la classe `game_style` et l'attribut data-game-style="<id>".
  Le style par défaut est gratuit ; les autres s'achètent à la boutique (article « theme:<id> », voir
  game/shopCatalog.js). Le compte choisit le sien (User.gameStyle), appliqué là où il le possède.
*/

const GAME_STYLES = {
  adarma: {
    id: 'adarma',
    name: 'Adarma',
    description: 'Pierre claire, olive et terre cuite : un village chaleureux et lumineux.',
    fonts: 'https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=Marcellus&display=swap',
  },
  medieval: {
    id: 'medieval',
    name: 'Médiéval',
    description: 'Parchemin, cuir et encre brune : l’esprit de Guerre Tribale.',
    fonts: 'https://fonts.googleapis.com/css2?family=Alegreya:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@400;500;600;700&family=Cinzel:wght@600;700&display=swap',
  },
  roman: {
    id: 'roman',
    name: 'Romain',
    description: 'Encre, rouge sang et bronze : la grandeur de l’Empire.',
    fonts: 'https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=Cinzel:wght@600;700&family=Marcellus&display=swap',
  },
  egypt: {
    id: 'egypt',
    name: 'Égypte antique',
    description: 'Pierre ocre, or et fresques délavées : les temples du Nil.',
    fonts: 'https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=El+Messiri:wght@500;600;700&display=swap',
  },
  viking: {
    id: 'viking',
    name: 'Viking',
    description: 'Fer, givre et palissades de bois : les terres du Nord.',
    fonts: 'https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=Cinzel:wght@600;700&family=Grenze:wght@400;500;600;700&display=swap',
  },
};

// Style par défaut : Adarma, clair, aux couleurs du jeu (comptes sans choix, nouveaux inscrits).
const DEFAULT_GAME_STYLE = 'adarma';

/** Le style existe-t-il ? */
const isGameStyle = (id) => Object.prototype.hasOwnProperty.call(GAME_STYLES, id);

/**
 * Style de jeu d'un compte : son choix s'il existe encore et, si `rights` est donné (droits de la boutique dans ce
 * contexte, ShopService.rightsFor), s'il le possède ; sinon le style par défaut.
 */
function gameStyleFor(user, rights = null) {
  const id = user && user.gameStyle;
  // Les comptes qui avaient choisi Brume ou Basic, anciens noms du style Adarma, gardent leur thème.
  const resolvedId = id === 'brume' || id === 'basic' ? 'adarma' : id;
  const ok = isGameStyle(resolvedId) && (!rights || rights.has(`theme:${resolvedId}`));
  return GAME_STYLES[ok ? resolvedId : DEFAULT_GAME_STYLE];
}

module.exports = { GAME_STYLES, DEFAULT_GAME_STYLE, isGameStyle, gameStyleFor };
