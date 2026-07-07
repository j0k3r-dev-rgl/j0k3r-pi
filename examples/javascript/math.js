//**
 * JavaScript fixture for testing functions and objects.
 */

function add(a, b) {
  return a + b;
}

const power = (base, exponent) => {
  return Math.pow(base, exponent);
};

const geometry = {
  circleArea(radius) {
    return Math.PI * radius * radius;
  },

  rectangleArea(width, height) {
    return width * height;
  },
};

module.exports = {
  add,
  power,
  geometry,
};
