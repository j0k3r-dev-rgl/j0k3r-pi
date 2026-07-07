/**
 * TypeScript fixture for testing interface/class resolution.
 */

export interface Shape {
  name: string;
  area(): number;
}

export interface Drawable {
  draw(): void;
}

export class Circle implements Shape, Drawable {
  name = 'circle';
  radius: number;

  constructor(radius: number) {
    this.radius = radius;
  }

  area(): number {
    return Math.PI * this.radius * this.radius;
  }

  draw(): void {
    console.log(`Drawing circle with radius ${this.radius}`);
  }
}

export class Rectangle implements Shape {
  name = 'rectangle';
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  area(): number {
    return this.width * this.height;
  }
}
