/**
 * Thrown by scaffold stubs that later waves (B1/B2/B3) replace with real
 * implementations. Tests assert on this contract.
 */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet (Wave A scaffold stub)`);
    this.name = "NotImplementedError";
  }
}
