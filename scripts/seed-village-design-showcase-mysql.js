'use strict';

/**
 * Galerie des designs de village sur le monde de test « speed » (MySQL) : une ligne par design, ses 6 niveaux de
 * gauche à droite (N1 à N6), dans une zone dégagée de la carte (x 592–597, y 467 et suivantes, aucun village autour).
 * Rejouable : crée les lignes manquantes (compte « Apercu… » du design, joueur, 6 villages, droit de boutique) et
 * ramène dans la grille les villages de galerie déjà créés ailleurs (ancienne galerie en 510–515 × 510–530).
 * Les autres villages éventuels de ces comptes ne bougent pas.
 *
 *   node scripts/seed-village-design-showcase-mysql.js
 */
const { Op } = require('sequelize');
const { sequelize, World, User, Player, Village, Entitlement } = require('../src/models');
const terrain = require('../src/game/terrain');

// Ordre des lignes, de haut en bas ; `username` des comptes déjà créés par l'ancienne galerie.
const DESIGNS = [
  ['beige', 'ApercuBeige', 'Beige'], ['blanc-bleu', 'ApercuBlancBleu', 'Blanc Bleu'], ['noir', 'ApercuNoir', 'Noir'],
  ['viking', 'ApercuViking', 'Viking'], ['rome-antique', 'ApercuRome', 'Rome'], ['egyptien', 'ApercuEgypte', 'Egypte'],
  ['futuriste', 'ApercuFuturiste', 'Futuriste'], ['grece-antique', 'ApercuGrece', 'Grece'],
  ['arabo-musulman', 'ApercuAraboMusulman', 'Empire Arabo'], ['napoleon', 'ApercuNapoleon', 'Napoleon'],
  ['empire-japonais', 'ApercuEmpireJaponais', 'Empire Japonais'], ['camp-caravanes', 'ApercuCampCaravanes', 'Camp Caravanes'],
  ['ville-luxe', 'ApercuVilleLuxe', 'Ville du Golf'], ['ville-zombie', 'ApercuVilleZombie', 'Apocalypse Zombi'],
  ['ville-enfer', 'ApercuVilleEnfer', 'Enfer'], ['paradis', 'ApercuParadis', 'Paradis'],
  ['palais-glace', 'ApercuPalaisGlace', 'Palais de Glace'], ['halloween', 'ApercuHalloween', 'Halloween'],
  ['noel', 'ApercuNoel', 'Noel'], ['christianisme', 'ApercuChristianisme', 'Christianisme'], ['islam', 'ApercuIslam', 'Islam'],
  ['humains', 'ApercuHumains', 'Humains'], ['elfes', 'ApercuElfes', 'Elfes'], ['nains', 'ApercuNains', 'Nains'],
  ['orques', 'ApercuOrques', 'Orques'],
].map(([id, username, label]) => ({ id, username, label }));
const ORIGIN = { x: 592, y: 467 };
// Ancienne galerie : ses villages sont ramenés dans la nouvelle grille.
const OLD = { x: [510, 515], y: [510, 530] };

const inBox = (v, x0, x1, y0, y1) => v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1;

async function main() {
  if (sequelize.getDialect() !== 'mysql') throw new Error('Ce script vise le monde de test MySQL.');
  await sequelize.transaction(async (transaction) => {
    const world = await World.findOne({ where: { slug: 'speed' }, transaction });
    if (!world) throw new Error('Monde rapide (test) introuvable.');
    const grid = { x: [ORIGIN.x, ORIGIN.x + 5], y: [ORIGIN.y, ORIGIN.y + DESIGNS.length - 1] };
    for (let y = grid.y[0]; y <= grid.y[1]; y++) {
      for (let x = grid.x[0]; x <= grid.x[1]; x++) if (terrain.blocked(x, y)) throw new Error(`Case ${x}|${y} non constructible.`);
    }

    const emails = DESIGNS.map((d) => `${d.username.toLowerCase()}@showcase.adarma.local`);
    const users = await User.findAll({ where: { email: emails }, transaction });
    const players = users.length ? await Player.findAll({ where: { worldId: world.id, userId: users.map((u) => u.id) }, transaction }) : [];
    const galleryPlayerIds = new Set(players.map((p) => p.id));

    // La grille doit être libre de tout autre village.
    const intruders = await Village.findAll({
      where: { worldId: world.id, x: { [Op.between]: grid.x }, y: { [Op.between]: grid.y } }, attributes: ['x', 'y', 'playerId'], transaction,
    });
    const foreign = intruders.filter((v) => !galleryPlayerIds.has(v.playerId));
    if (foreign.length) throw new Error(`Zone occupée : ${foreign.map((v) => `${v.x}|${v.y}`).join(', ')}`);

    // Modèle des 6 niveaux : la ligne Beige (bâtiments et points de chaque niveau).
    const beigeUser = users.find((u) => u.username === 'ApercuBeige');
    const beigePlayer = beigeUser && players.find((p) => p.userId === beigeUser.id);
    const beigeRow = beigePlayer ? (await Village.findAll({ where: { playerId: beigePlayer.id }, transaction }))
      .filter((v) => inBox(v, ...OLD.x, ...OLD.y) || inBox(v, ...grid.x, ...grid.y)).sort((a, b) => a.x - b.x) : [];
    if (beigeRow.length !== 6) throw new Error('Ligne Beige de référence introuvable (6 villages attendus).');
    const template = beigeRow.map((v) => ({ buildings: v.buildings, points: v.points }));
    const bot = await User.findOne({ where: { email: { [Op.like]: '%@bots.adarma.local' } }, transaction });
    if (!bot) throw new Error('Compte de test modèle introuvable.');

    // Deux temps : d'abord écarter les villages à déplacer (coordonnées hors carte), pour ne jamais se croiser.
    const moves = [];
    let created = 0;
    for (const [row, design] of DESIGNS.entries()) {
      const y = ORIGIN.y + row;
      const email = `${design.username.toLowerCase()}@showcase.adarma.local`;
      let user = users.find((u) => u.email === email);
      if (!user) user = await User.create({ username: design.username, email, passwordHash: bot.passwordHash, villageDesign: design.id }, { transaction });
      else if (user.villageDesign !== design.id) await user.update({ villageDesign: design.id }, { transaction });
      let player = players.find((p) => p.userId === user.id);
      if (!player) {
        player = await Player.create({
          name: design.username, userId: user.id, worldId: world.id, villageCount: 6, points: template.reduce((n, l) => n + l.points, 0),
        }, { transaction });
      }
      const row6 = (await Village.findAll({ where: { playerId: player.id }, transaction }))
        .filter((v) => inBox(v, ...OLD.x, ...OLD.y) || inBox(v, ...grid.x, ...grid.y)).sort((a, b) => a.x - b.x);
      if (row6.length && row6.length !== 6) throw new Error(`${design.username} : ${row6.length} villages de galerie au lieu de 6.`);
      if (!row6.length) {
        const now = new Date();
        for (let i = 0; i < 6; i += 1) {
          await Village.create({
            name: `${design.label} N${i + 1}`, x: -1000 - row * 10 - i, y: -1000, isFirst: i === 0, buildings: template[i].buildings,
            units: {}, resourcesAt: now, points: template[i].points, worldId: world.id, playerId: player.id,
          }, { transaction }).then((v) => row6.push(v));
        }
        created += 1;
      }
      row6.forEach((v, i) => moves.push({ v, x: ORIGIN.x + i, y }));

      const itemKey = `design:${design.id}`;
      if (design.id !== 'beige' && !(await Entitlement.findOne({ where: { userId: user.id, worldId: world.id, scope: 'world', itemKey }, transaction }))) {
        await Entitlement.create({ userId: user.id, worldId: world.id, scope: 'world', itemKey, startsAt: new Date(), price: 0, source: 'showcase' }, { transaction });
      }
    }
    for (const [i, m] of moves.entries()) await m.v.update({ x: -2000 - i, y: -2000 }, { transaction });
    for (const m of moves) await m.v.update({ x: m.x, y: m.y }, { transaction });
    console.log(`Galerie du monde ${world.name} : ${DESIGNS.length} designs × 6 niveaux en x ${grid.x.join('–')}, y ${grid.y.join('–')} (${created} ligne(s) créée(s)).`);
  });
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; })
  .finally(() => sequelize.close());
