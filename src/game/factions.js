'use strict';

// Factions des mondes à factions (réglage `factions.active` du monde, voir WorldConfig) : chaque joueur choisit la
// sienne en entrant dans le monde, pour toute la partie. Les tribus existent toujours, mais une tribu n'accueille que
// des joueurs de la faction de son fondateur ; la condition de victoire se calcule alors par faction au lieu de tribu.
// Les factions ne changent rien d'autre au jeu (mêmes bâtiments, mêmes unités).

// `hint` : une ligne ; `lore` : présentation de la page d'entrée dans le monde (views/join.ejs). Illustration facultative :
// public/img/factions/<id>.webp (portrait 3:4), sinon un blason de repli aux couleurs de la faction.
// `design` : design de village de la faction (web/villageDesigns.js) : offert et par défaut sur les mondes à factions
// pour les joueurs de cette faction, en vente à la boutique pour tous les autres mondes.
const FACTIONS = [
  { id: 'elf', name: 'Elfes', singular: 'Elfe', design: 'elfes', hint: 'Peuple des forêts anciennes.', lore: 'Gardiens des bois immémoriaux, ils frappent vite et loin, puis disparaissent sous les frondaisons.' },
  { id: 'dwarf', name: 'Nains', singular: 'Nain', design: 'nains', hint: 'Peuple des montagnes et des forges.', lore: 'Bâtisseurs têtus des cités sous la roche, ils ne cèdent jamais un pouce de leurs murailles.' },
  { id: 'orc', name: 'Orques', singular: 'Orque', design: 'orques', hint: 'Peuple des steppes et des clans.', lore: 'Clans farouches des terres brûlées, unis par la guerre et la soif de conquête.' },
  { id: 'human', name: 'Humains', singular: 'Humain', design: 'humains', hint: 'Peuple des royaumes et des cités.', lore: 'Royaumes ambitieux aux bannières innombrables, maîtres du commerce et des alliances.' },
];

const BY_ID = new Map(FACTIONS.map((f) => [f.id, f]));

const isFaction = (id) => BY_ID.has(id);
const faction = (id) => BY_ID.get(id) || null;
const factionName = (id) => (BY_ID.get(id) || {}).name || '';
/** Design de village d'une faction (nul hors faction). */
const factionDesign = (id) => (BY_ID.get(id) || {}).design || null;

module.exports = { FACTIONS, isFaction, faction, factionName, factionDesign };
