import type { OrganizationTaxProfilePort, ProductType, TaxServicePort } from '@endora-commerce/contracts';

/**
 * The VAT rate of each product tax class in a basket, as a fraction — issue
 * #436. A product's class is its `type`.
 */
export type CartTaxRateResolver = (input: {
  organizationId: string | null;
  productTypes: readonly ProductType[];
}) => Promise<Map<ProductType, number>>;

/**
 * Resolves a basket's rates the way placement resolves an order's
 * (`OrderService.computeMonetaryTotals`): the product's class against the
 * Organization's VAT status and country, a VAT-exempt or reverse-charge
 * Organization at 0, and a deployment holding no rule that applies — the
 * resolver's `none` — at 0. The checkout preview's defaults stand for what the
 * cart cannot know yet: a basket with no Organization is a VAT payer's, and the
 * country is the Organization's registered one, `PL` without one; placement
 * prefers the billing address chosen at checkout.
 *
 * No `catch` (issue #84): the only errors that reach here are a failing
 * database and a switched-off owner, and a rate invented for either would be a
 * VAT figure no rule supports. The cart read decides what a failure means.
 */
export function createCartTaxRateResolver(ports: {
  taxProfiles: OrganizationTaxProfilePort;
  taxes: TaxServicePort;
}): CartTaxRateResolver {
  return async ({ organizationId, productTypes }) => {
    const rates = new Map<ProductType, number>();
    const types = [...new Set(productTypes)];
    if (types.length === 0) return rates;
    const profile = organizationId ? await ports.taxProfiles.taxProfileOf(organizationId) : null;
    const vatStatus = profile?.vatStatus ?? 'vat_payer';
    for (const productType of types) {
      if (vatStatus !== 'vat_payer') {
        rates.set(productType, 0);
        continue;
      }
      const resolved = await ports.taxes.taxRateFor({
        country: profile?.country ?? 'PL',
        productType,
        vatStatus,
      });
      rates.set(productType, resolved.source === 'none' ? 0 : resolved.rate);
    }
    return rates;
  };
}
