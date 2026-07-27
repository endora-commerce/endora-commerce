// Fixture: core implementation of the contracted service.
import type { PricingServiceContract } from './pricing-service.interface.js';

export class PricingService implements PricingServiceContract {
  async resolveLinePrice(input: { productId: string; qty: number }): Promise<number> {
    void input.productId;
    return input.qty;
  }
}
