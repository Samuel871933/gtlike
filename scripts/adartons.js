'use strict';

// Crédite (ou débite, montant négatif) des Adartons sur un compte, en attendant le paiement : node scripts/adartons.js <pseudo> <montant> [libellé]
const { User, sequelize } = require('../src/models');
const ShopService = require('../src/services/ShopService');

(async () => {
  const [username, amount, ...label] = process.argv.slice(2);
  if (!username || !amount) throw new Error('Usage : node scripts/adartons.js <pseudo> <montant> [libellé]');
  const user = await User.findOne({ where: { username } });
  if (!user) throw new Error(`Compte « ${username} » introuvable.`);
  const balance = await ShopService.credit(user.id, amount, label.join(' ') || 'Crédit manuel');
  console.log(`${username} : ${balance} Adartons.`);
  await sequelize.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
