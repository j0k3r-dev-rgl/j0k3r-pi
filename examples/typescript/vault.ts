/**
 * TypeScript fixture for testing private member resolution.
 */

export class Vault {
  private secret: string;
  #hash: string;

  constructor(secret: string, hash: string) {
    this.secret = secret;
    this.#hash = hash;
  }

  private getSecret(): string {
    return this.secret;
  }

  #getHash(): string {
    return this.#hash;
  }

  public unlock(password: string): boolean {
    return password === this.secret;
  }
}
