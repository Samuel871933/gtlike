'use strict';

const { Sequelize, DataTypes } = require('sequelize');
const config = require('./config');

function mysql() {
  // DATETIME(3) par défaut : les échéances du jeu (constructions, arrivées d'ordres) se jouent à la milliseconde.
  const MysqlDate = DataTypes.mysql.DATE;
  const { toSql, _stringify } = MysqlDate.prototype;
  MysqlDate.prototype.toSql = function () { return this._length ? toSql.call(this) : 'DATETIME(3)'; };
  MysqlDate.prototype._stringify = function (date, options) {
    if (!this._length) this._length = 3;
    return _stringify.call(this, date, options);
  };

  const { host, port, name, user, password, poolMax } = config.db;
  const sequelize = new Sequelize(name, user, password, {
    dialect: 'mysql',
    host,
    port,
    logging: false,
    timezone: '+00:00',
    dialectOptions: { charset: 'utf8mb4' },
    define: { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
    // Comme PostgreSQL : chaque requête voit les écritures validées, les verrous FOR UPDATE évitent les doubles dépenses.
    isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    pool: { max: poolMax, min: 0, idle: 10000 },
  });
  // Le SQL écrit à la main entoure les noms de colonnes de guillemets doubles ("createdAt"), comme SQLite.
  sequelize.addHook('afterConnect', (connection) => connection.promise()
    .query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',ANSI_QUOTES')"));
  return sequelize;
}

function sqlite() {
  return new Sequelize({
    dialect: 'sqlite',
    storage: config.sqliteStorage,
    logging: false,
    // Verrou d'écriture dès le début de la transaction : évite les doubles dépenses.
    transactionType: 'IMMEDIATE',
  });
}

// MySQL / MariaDB si DB_DIALECT=mysql, sinon SQLite local (tests).
const sequelize = config.db.dialect === 'mysql' ? mysql() : sqlite();

module.exports = sequelize;
