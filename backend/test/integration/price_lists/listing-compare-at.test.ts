import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-025) — a listing card carries the compare-at amount when a
 * sale is charged, and none when the sale does not undercut the buyer price.
 */
describe('price books — compare-at on listing cards', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function listing(organization: { id: string; customerGroupId?: string | null } | null) {
    return f.pricing.resolveListingPriceDetails({
      products: [f.products.P1, f.products.P2],
      context: {
        salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' },
        ...(organization ? { organization } : {}),
      },
    });
  }

  it('a charged sale carries the buyer price as compare-at; an equal one carries none', async () => {
    await f.book({ audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-10' }] });
    await f.book({ type: 'sale', audience: 'everyone', rows: [{ product: f.products.P1, percent: '-10' }] });

    const guest = await listing(null);
    expect(guest.get(f.products.P1.id)!.price).toMatchObject({
      source: 'price_list',
      amount: '90.0000',
      isSale: true,
      priceSource: 'sale',
      compareAtAmount: '100.0000',
    });
    expect(guest.get(f.products.P1.id)).toMatchObject({
      basePrice: { amount: '100.0000', currency: 'PLN' },
      salePrice: { amount: '90.0000', currency: 'PLN' },
    });

    const beta = await listing(f.orgs.Beta);
    const price = beta.get(f.products.P1.id)!.price;
    expect(price).toMatchObject({ amount: '90.0000', isSale: false, priceSource: 'buyer' });
    expect('compareAtAmount' in price).toBe(false);
    expect(beta.get(f.products.P1.id)!.salePrice).toBeNull();
    expect(guest.get(f.products.P2.id)!.price).toMatchObject({ amount: '50.0000', priceSource: 'base' });
  });
});
