'use strict';

// Guerres runiques (victory.type 'runes', comme les « Guerres runiques » de Guerre Tribale) : règles de combat des
// villages de runes. Une fois conquis, un village de runes se défend mal (`runes.defenseFactor` : force de la défense,
// soutiens compris, 0,5 = −50 %), ce qui oblige à le soutenir sans cesse ; la garnison barbare d'origine n'est pas
// touchée. `runes.disableMorale` : pas de morale sur les attaques contre ces villages.

const isRune = (cfg, village) => cfg.victory.type === 'runes' && Boolean(village) && village.special === 'rune';

/** Facteur de défense d'un village (1 sauf village de runes tenu par un joueur). */
const defenseFactor = (cfg, village) => (isRune(cfg, village) && village.playerId ? cfg.victory.runes.defenseFactor : 1);

/** La morale s'applique-t-elle aux attaques contre ce village ? */
const moraleApplies = (cfg, village) => !(isRune(cfg, village) && cfg.victory.runes.disableMorale);

module.exports = { isRune, defenseFactor, moraleApplies };
