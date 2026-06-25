/**
 * TypeScript fixture for edge cases.
 */

export type UserID = string;

export function outer(): number {
  function inner(): number {
    return 42;
  }

  return inner();
}
