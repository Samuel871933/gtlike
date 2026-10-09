'use strict';

// Table du mode Zeppelin : le vol en cours (ou le dernier) de chaque vaisseau. Le village garde ses coordonnées de
// départ jusqu'à l'atterrissage : tout le moteur de base (distances, carte, morale) continue de lire Village.x/y.

const { DataTypes } = require('sequelize');

module.exports = function defineModels(sequelize, { Village, World }) {
  const ShipFlight = sequelize.define('ShipFlight', {
    fromX: { type: DataTypes.INTEGER, allowNull: false },
    fromY: { type: DataTypes.INTEGER, allowNull: false },
    toX: { type: DataTypes.INTEGER, allowNull: false },
    toY: { type: DataTypes.INTEGER, allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    arrivesAt: { type: DataTypes.DATE, allowNull: false },
    // Atterrissage effectif (null pendant le vol) : départ du délai avant le vol suivant.
    landedAt: { type: DataTypes.DATE, allowNull: true },
  }, { indexes: [{ unique: true, fields: ['villageId'] }, { fields: ['worldId', 'landedAt'] }, { fields: ['arrivesAt'] }] });
  ShipFlight.belongsTo(Village, { foreignKey: { name: 'villageId', allowNull: false }, onDelete: 'CASCADE' });
  ShipFlight.belongsTo(World, { foreignKey: { name: 'worldId', allowNull: false }, onDelete: 'CASCADE' });
  return { ShipFlight };
};
