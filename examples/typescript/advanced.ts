/**
 * Advanced TypeScript fixture for edge cases.
 */

export abstract class Animal {
  abstract name: string;

  constructor(public age: number) {}

  abstract speak(): string;

  static create(): Animal {
    throw new Error('abstract');
  }

  get description(): string {
    return `${this.name} is ${this.age}`;
  }

  set description(value: string) {
    // no-op
  }
}

export class Parrot extends Animal {
  name = 'parrot';

  constructor(age: number) {
    super(age);
  }

  speak(): string {
    return 'squawk';
  }
}

export interface Container<T> {
  value: T;
  getValue(): T;
}

export class Box<T> implements Container<T> {
  constructor(public value: T) {}

  getValue(): T {
    return this.value;
  }
}

export function process(value: string): string;
export function process(value: number): number;
export function process(value: string | number): string | number {
  return value;
}
