// Fixture overlay: a valid client-specific override that satisfies the core
// PricingServiceContract (structurally). Doubles the price.
export class PricingService {
  async resolveLinePrice(input: { productId: string; qty: number }): Promise<number> {
    void input.productId;
    return input.qty * 2;
  }
}
