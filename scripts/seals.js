'use strict';

// Donne des sceaux à un compte (tests, support) :
//   node scripts/seals.js <pseudo> <type> <niveau> [nombre]   un type précis (production, recruit, attack, defense, luck,
//                                                             population, coin, haul), niveau 1 à 9
//   node scripts/seals.js <pseudo> --kit                      lot de test : pour chaque type, 3 sceaux de niveau 1
//                                                             (pour essayer la fusion) et un de niveau 3, 6 et 9
const { sequelize, User } = require('../src/models');
const SealService = require('../src/services/SealService');
const seals = require('../src/game/seals');

(async () => {
  const [username, type, level, count = '1'] = process.argv.slice(2);
  if (!username || !type) throw new Error('Usage : node scripts/seals.js <pseudo> <type> <niveau> [nombre] | <pseudo> --kit');
  const user = await User.findOne({ where: { username } });
  if (!user) throw new Error(`Compte « ${username} » introuvable.`);
  const lots = type === '--kit'
    ? seals.TYPES.flatMap((t) => [[t.id, 1, 3], [t.id, 3, 1], [t.id, 6, 1], [t.id, 9, 1]])
    : [[type, Number(level), Number(count)]];
  for (const [t, l, n] of lots) {
    if (!seals.isType(t) || !seals.isLevel(l) || !(n > 0)) throw new Error(`Sceau invalide : ${t} ${l} × ${n}.`);
  }
  await sequelize.transaction(async (tx) => {
    for (const [t, l, n] of lots) {
      await SealService.add(user.id, t, l, n, tx);
      await SealService.log(user.id, null, t, l, 'admin', `${n} × par script`, tx);
    }
  });
  const total = lots.reduce((s, [, , n]) => s + n, 0);
  console.log(`${username} : ${total} sceau(x) ajouté(s).`);
  await sequelize.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
