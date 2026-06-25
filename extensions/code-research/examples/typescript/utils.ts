/**
 * TypeScript fixture for testing function/variable resolution.
 */

export function add(a: number, b: number): number {
  return a + b;
}

export const subtract = (a: number, b: number): number => a - b;

export function fetchUserData(userId: string): Promise<{ id: string; name: string }> {
  return Promise.resolve({ id: userId, name: 'Test User' });
}

export function fetchPostData(postId: string): Promise<{ id: string; title: string }> {
  return Promise.resolve({ id: postId, title: 'Test Post' });
}

export const mathUtils = {
  multiply(a: number, b: number): number {
    return a * b;
  },

  divide(a: number, b: number): number {
    return a / b;
  },
};
