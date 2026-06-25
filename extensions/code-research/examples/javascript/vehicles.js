/**
 * JavaScript fixture for testing class inheritance.
 */

class Vehicle {
  constructor(brand) {
    this.brand = brand;
  }

  start() {
    console.log(`${this.brand} vehicle starting`);
  }
}

class Car extends Vehicle {
  constructor(brand, model) {
    super(brand);
    this.model = model;
  }

  start() {
    console.log(`${this.brand} ${this.model} starting`);
  }

  honk() {
    return 'beep beep';
  }
}

class Motorcycle extends Vehicle {
  constructor(brand) {
    super(brand);
  }

  wheelie() {
    return 'pop a wheelie';
  }
}

module.exports = {
  Vehicle,
  Car,
  Motorcycle,
};
