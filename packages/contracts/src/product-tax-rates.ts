import type { ProductType } from './catalog.js';
import type { OrganizationTaxProfilePort } from './organizations.js';
import type { TaxServicePort } from './taxes.js';

/**
 * The VAT rate of each product tax class a buyer is charged, as a fraction —
 * issue #436 (the cart) and issue #852 (the catalogue). A product's class is
 * its `type`.
 */
export type ProductTaxRateResolver = (input: {
  organizationId: string | null;
  productTypes: readonly ProductType[];
}) => Promise<Map<ProductType, number>>;

/**
 * Resolves a buyer's rates the way placement resolves an order's
 * (`OrderService.computeMonetaryTotals`): the product's class against the
 * Organization's VAT status and country, a VAT-exempt or reverse-charge
 * Organization at 0, and a deployment holding no rule that applies — the
 * resolver's `none` — at 0. The checkout preview's defaults stand for what a
 * read before checkout cannot know yet: a buyer with no Organization is a VAT
 * payer, and the country is the Organization's registered one, `PL` without
 * one; placement prefers the billing address chosen at checkout.
 *
 * **One rule, two readers.** It was `carts`' own (`cart-tax-rates.ts`, issue
 * #436) until the catalogue needed the same answer for a product's gross price
 * (issue #852). A second copy in `catalog` would be a second chance to answer
 * the same buyer two rates for the same product, so the rule lives here, over
 * the two contract ports both modules already resolve, and each module wires
 * it with its own `lazyPort`s — no module imports the other.
 *
 * No `catch` (issue #84): the only errors that reach here are a failing
 * database and a switched-off owner, and a rate invented for either would be a
 * VAT figure no rule supports. The caller decides what a failure means.
 */
export function createProductTaxRateResolver(ports: {
  taxProfiles: OrganizationTaxProfilePort;
  taxes: TaxServicePort;
}): ProductTaxRateResolver {
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
