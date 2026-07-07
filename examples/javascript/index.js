/**
 * JavaScript fixture for testing re-exports.
 */

const { Vehicle, Car, Motorcycle } = require('./vehicles.js');
const { add, power, geometry } = require('./math.js');

module.exports = {
  Vehicle,
  Car,
  Motorcycle,
  add,
  power,
  geometry,
};
