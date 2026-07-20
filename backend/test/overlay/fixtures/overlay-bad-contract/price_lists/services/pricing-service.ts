// Fixture: an overlay that does NOT satisfy PricingServiceContract — the return
// type is Promise<string> instead of Promise<number>. The contract check MUST
// fail the build (SC-004).
export class PricingService {
  async resolveLinePrice(input: { productId: string; qty: number }): Promise<string> {
    void input.qty;
    return input.productId;
  }
}
