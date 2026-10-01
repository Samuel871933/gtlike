'use strict';

// Bots : des joueurs gérés par l'IA, sans compte (Players.userId devient facultatif), marqués par Players.isBot, et
// leurs réglages dans la table Bots.

const { DataTypes } = require('sequelize');

/**
 * Sous SQLite, rendre une colonne facultative oblige à recréer la table. changeColumn le fait avec un DROP TABLE qui,
 * clés étrangères actives, supprimerait en cascade villages, rapports… On suit donc la procédure de SQLite
 * (https://sqlite.org/lang_altertable.html#otheralter) : clés étrangères coupées, nouvelle table, copie, échange.
 */
async function sqliteUserIdNullable(qi, nullable) {
  const db = qi.sequelize;
  const [[table]] = await db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'Players'");
  const [indexes] = await db.query("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Players' AND sql IS NOT NULL");
  const from = nullable ? '`userId` INTEGER NOT NULL REFERENCES' : '`userId` INTEGER REFERENCES';
  const to = nullable ? '`userId` INTEGER REFERENCES' : '`userId` INTEGER NOT NULL REFERENCES';
  if (!table.sql.includes(from)) return;
  await db.query('PRAGMA foreign_keys = OFF');
  try {
    await db.query(table.sql.replace(from, to).replace('CREATE TABLE `Players`', 'CREATE TABLE `Players_new`'));
    await db.query('INSERT INTO `Players_new` SELECT * FROM `Players`');
    await db.query('DROP TABLE `Players`');
    await db.query('ALTER TABLE `Players_new` RENAME TO `Players`');
    for (const { sql } of indexes) await db.query(sql);
    const [broken] = await db.query('PRAGMA foreign_key_check');
    if (broken.length) throw new Error(`Clés étrangères invalides après la migration des joueurs : ${JSON.stringify(broken.slice(0, 5))}`);
  } finally {
    await db.query('PRAGMA foreign_keys = ON');
  }
}

async function up({ context: qi }) {
  if (qi.sequelize.getDialect() === 'sqlite') await sqliteUserIdNullable(qi, true);
  else await qi.changeColumn('Players', 'userId', { type: DataTypes.INTEGER, allowNull: true });

  const players = await qi.describeTable('Players');
  if (!players.isBot) await qi.addColumn('Players', 'isBot', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const tables = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (!tables.includes('Bots')) {
    await qi.createTable('Bots', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      nextActionAt: { type: DataTypes.DATE, allowNull: false },
      memory: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
      playerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Players', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      worldId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Worlds', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    });
    await qi.addIndex('Bots', ['playerId'], { unique: true });
    await qi.addIndex('Bots', ['nextActionAt']);
  }
}

async function down({ context: qi }) {
  await qi.dropTable('Bots');
  await qi.sequelize.query('DELETE FROM "Players" WHERE "userId" IS NULL');
  if (qi.sequelize.getDialect() === 'sqlite') {
    // removeColumn recrée aussi la table : clés étrangères coupées pendant ce temps (voir plus haut).
    await qi.sequelize.query('PRAGMA foreign_keys = OFF');
    try { await qi.removeColumn('Players', 'isBot'); } finally { await qi.sequelize.query('PRAGMA foreign_keys = ON'); }
    await sqliteUserIdNullable(qi, false);
  } else {
    await qi.removeColumn('Players', 'isBot');
    await qi.changeColumn('Players', 'userId', { type: DataTypes.INTEGER, allowNull: false });
  }
}

module.exports = { up, down };
