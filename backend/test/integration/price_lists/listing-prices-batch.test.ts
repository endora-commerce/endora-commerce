import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListingPriceViewerContext } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Identity — the listing batch equals the single resolution, product by
 * product, for every buyer (D-287 P0's obligation, kept by feature 160 on the
 * price-book engine and the worked-examples fixture, `worked-examples.md`
 * §10.1 + §10.14).
 *
 * The single reference for a product is one `resolveLinePrice` at quantity 1;
 * for a product with variants, the lowest of one `resolveLinePrice` per
 * variant, which is what the card shows "from" (FR-024).
 */
describe('price_lists — the listing batch equals the single resolution (feature 160)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    await f.book({ audience: 'everyone', rows: [{ category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' }] });
    await f.book({ audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-10' }] });
    await f.book({
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P5, percent: '-5' },
        { category: f.categories.screws, percent: '-15' },
        { product: f.products.P5, variant: f.variants.P5r, fixed: '85' },
      ],
    });
    await f.book({ type: 'sale', audience: 'everyone', rows: [{ percent: '-10' }] });
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const products = () => Object.values(f.products);
  const variantsOf = (productId: string) =>
    productId === f.products.P5.id ? [f.variants.P5r, f.variants.P5b] : [];

  it('every buyer, every product, variants included', async () => {
    const buyers: Array<Omit<ListingPriceViewerContext, 'salesChannel'>> = [
      {},
      { organization: f.orgs.Acme },
      { organization: f.orgs.AcmeW },
      { organization: f.orgs.Beta },
      { organization: f.orgs.Gamma, customerAccountId: f.accounts.ola },
    ];
    for (const buyer of buyers) {
      const context = { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, ...buyer };
      const listing = await f.pricing.resolveListingPrices({ products: products(), context });
      for (const product of products()) {
        const card = listing.get(product.id)!;
        const variants = variantsOf(product.id);
        const singles = await Promise.all(
          (variants.length > 0 ? variants : [null]).map((variantId) =>
            f.pricing.resolveLinePrice({ product, variantId, context: { ...context, quantity: 1 } }),
          ),
        );
        const priced = singles.filter((s): s is NonNullable<typeof s> => s !== null);
        if (priced.length === 0) {
          expect(card, `${product.sku}`).toEqual({ source: 'none' });
          continue;
        }
        const lowest = priced.reduce((a, b) => (Number(b.amount) < Number(a.amount) ? b : a));
        expect(card, `${product.sku}`).toMatchObject({
          source: 'price_list',
          amount: lowest.amount,
          currency: lowest.currency,
          isSale: lowest.isSale,
          priceSource: lowest.source,
        });
      }
    }
  });
});
