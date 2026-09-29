'use strict';

// Disposition du plan du village (décor médiéval illustré), commune au plan en jeu (partials/village-plan.ejs) et à
// la vitrine de la page d'accueil (partials/village-showcase.ejs).

// [centre horizontal, pied du bâtiment, largeur], en % du décor.
// Ancrer au sol garde les trois paliers sur leur parcelle, quelle que soit leur hauteur.
// Le quartier général domine le fond ; les ateliers entourent le puits sans couper les chemins.
const SPOTS = {
  wood: [11, 25, 14], iron: [90, 25, 14],
  snob: [36, 23, 15], main: [60, 23, 17],
  stable: [72, 61, 12], barracks: [76, 45, 13], hide: [43, 34, 7],
  statue: [37, 47, 6.5], market: [30, 35, 13], smith: [40, 67, 13],
  place: [60, 41, 9], storage: [25, 54, 14], garage: [59, 69, 13],
  stone: [10, 79, 14], farm: [90, 77, 14],
};
const WALL_SPOT = [50, 78, 14];
// Décor uniquement : les mondes actuels ne proposent pas le bâtiment église.
const CHURCH_SPOT = [73, 29, 13];

/** Position d'une parcelle (style en ligne) ; `ratio` : hauteur / largeur de son image. */
const spotStyle = ([x, y, width], ratio = 7 / 8) => `left:${x - width / 2}%;top:${y - width * ratio * 1.5}%;width:${width}%;--plot-depth:${Math.round(y)}`;

module.exports = { SPOTS, WALL_SPOT, CHURCH_SPOT, spotStyle };
