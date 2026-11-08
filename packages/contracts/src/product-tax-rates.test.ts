import { describe, expect, it, vi } from 'vitest';
import type { OrganizationTaxProfilePort } from './organizations.js';
import type { TaxResolutionInput, TaxServicePort } from './taxes.js';
import { createProductTaxRateResolver } from './product-tax-rates.js';

/**
 * Issue #436 — a basket's rates, resolved as placement resolves an order's.
 * Issue #852 — and a product's, on the catalogue read, by the same rule: the
 * resolver moved here from `carts` so that the cart and the catalogue cannot
 * answer the same buyer two different rates for the same product.
 */
const ORG = '00000000-0000-4000-8000-000000000436';
const RULES: Record<string, number> = { simple: 0.23, virtual: 0.08, configurable: 0.05 };

function ports(profile: Awaited<ReturnType<OrganizationTaxProfilePort['taxProfileOf']>>) {
  const taxRateFor = vi.fn(async (input: TaxResolutionInput) =>
    input.productType in RULES
      ? ({ source: 'rule', rate: RULES[input.productType]!, taxId: ORG } as const)
      : ({ source: 'none' } as const),
  );
  const taxes: TaxServicePort = { taxRateFor };
  const taxProfiles: OrganizationTaxProfilePort = { taxProfileOf: vi.fn(async () => profile) };
  return { taxes, taxProfiles, taxRateFor };
}

describe('product tax rates', () => {
  it("resolves each product class once, against the Organization's status and country", async () => {
    const p = ports({ vatStatus: 'vat_payer', country: 'DE' });
    const rates = await createProductTaxRateResolver(p)({
      organizationId: ORG,
      productTypes: ['simple', 'virtual', 'simple', 'configurable'],
    });
    expect([...rates]).toEqual([
      ['simple', 0.23],
      ['virtual', 0.08],
      ['configurable', 0.05],
    ]);
    expect(p.taxRateFor).toHaveBeenCalledTimes(3);
    expect(p.taxRateFor).toHaveBeenCalledWith({ country: 'DE', productType: 'virtual', vatStatus: 'vat_payer' });
  });

  it('answers 0 for a VAT-exempt or reverse-charge Organization, without asking the rules', async () => {
    for (const vatStatus of ['vat_exempt', 'reverse_charge'] as const) {
      const p = ports({ vatStatus, country: 'PL' });
      const rates = await createProductTaxRateResolver(p)({ organizationId: ORG, productTypes: ['simple'] });
      expect(rates.get('simple')).toBe(0);
      expect(p.taxRateFor).not.toHaveBeenCalled();
    }
  });

  it("answers 0 where the deployment holds no rule that applies (the resolver's none)", async () => {
    const p = ports({ vatStatus: 'vat_payer', country: 'PL' });
    const rates = await createProductTaxRateResolver(p)({ organizationId: ORG, productTypes: ['bundle'] });
    expect(rates.get('bundle')).toBe(0);
  });

  it('reads a buyer with no Organization as a VAT payer in PL, as the checkout preview does', async () => {
    const p = ports(null);
    await createProductTaxRateResolver(p)({ organizationId: null, productTypes: ['simple'] });
    expect(p.taxProfiles.taxProfileOf).not.toHaveBeenCalled();
    expect(p.taxRateFor).toHaveBeenCalledWith({ country: 'PL', productType: 'simple', vatStatus: 'vat_payer' });
  });

  it('asks nothing for an empty list', async () => {
    const p = ports({ vatStatus: 'vat_payer', country: 'PL' });
    const rates = await createProductTaxRateResolver(p)({ organizationId: ORG, productTypes: [] });
    expect(rates.size).toBe(0);
    expect(p.taxProfiles.taxProfileOf).not.toHaveBeenCalled();
  });
});
