'use strict';

// Boutique (voir ShopService) : solde d'Adartons du compte, droits acquis (Entitlements) et historique des Adartons.
// Droits acquis : les comptes qui utilisaient déjà un thème ou un design devenu payant le gardent pour toujours.

const { DataTypes } = require('sequelize');

const FREE_STYLES = ['adarma', 'basic', 'brume'];
const FREE_DESIGNS = ['beige'];

async function up({ context: qi }) {
  const users = await qi.describeTable('Users');
  if (!users.adartons) await qi.addColumn('Users', 'adartons', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('Entitlements')) {
    await qi.createTable('Entitlements', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      worldId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      scope: { type: DataTypes.STRING(8), allowNull: false },
      itemKey: { type: DataTypes.STRING(48), allowNull: false },
      offerId: { type: DataTypes.STRING(24), allowNull: true },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: true },
      price: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      source: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'purchase' },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('Entitlements', ['userId']);
    await qi.addIndex('Entitlements', ['worldId']);
  }
  if (!tables.includes('AdartonTransactions')) {
    await qi.createTable('AdartonTransactions', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      amount: { type: DataTypes.INTEGER, allowNull: false },
      balanceAfter: { type: DataTypes.INTEGER, allowNull: false },
      reason: { type: DataTypes.STRING(12), allowNull: false },
      label: { type: DataTypes.STRING(160), allowNull: false },
      entitlementId: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('AdartonTransactions', ['userId']);
  }

  // Droits acquis : thème et design choisis avant l'ouverture de la boutique.
  const [rows] = await qi.sequelize.query('SELECT id, "gameStyle", "villageDesign" FROM "Users"');
  const now = new Date();
  const grants = [];
  for (const u of rows) {
    if (u.gameStyle && !FREE_STYLES.includes(u.gameStyle)) grants.push({ userId: u.id, itemKey: `theme:${u.gameStyle}` });
    if (u.villageDesign && !FREE_DESIGNS.includes(u.villageDesign)) grants.push({ userId: u.id, itemKey: `design:${u.villageDesign}` });
  }
  if (grants.length) {
    await qi.bulkInsert('Entitlements', grants.map((g) => ({
      ...g, worldId: null, scope: 'account', offerId: null, startsAt: now, endsAt: null, price: 0, source: 'legacy', createdAt: now, updatedAt: now,
    })));
  }
}

async function down({ context: qi }) {
  await qi.dropTable('AdartonTransactions');
  await qi.dropTable('Entitlements');
  await qi.removeColumn('Users', 'adartons');
}

module.exports = { up, down };
