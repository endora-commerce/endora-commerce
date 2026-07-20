// Fixture: a formalized core service interface an overlay must satisfy.
export interface PricingServiceContract {
  resolveLinePrice(input: { productId: string; qty: number }): Promise<number>;
}
