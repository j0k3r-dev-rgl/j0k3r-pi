/**
 * TypeScript fixture for edge cases.
 */

export type UserID = string;

export const helper = (): void => {};

export function register(cb: () => void): void {
  cb();
}

export function outer(): number {
  function inner(): number {
    return 42;
  }

  const alias = helper;
  alias();
  register(helper);

  return inner();
}
