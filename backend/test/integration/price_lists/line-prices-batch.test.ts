import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListingPriceViewerContext } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Identity — `resolveLinePrices` answers, key by key, exactly what one
 * `resolveLinePrice` per line answers (D-287 P0's obligation, kept by feature
 * 160 on the price-book engine): every buyer of the fixture, every product and
 * variant, at the quantities of `worked-examples.md` §10.8, the same product on
 * several lines, and the one customer-group rule (A2).
 */
describe('price_lists — the line batch equals one resolution per line (feature 160)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    await f.setBase(f.products.P1, {
      product: [
        { minQuantity: 1, maxQuantity: 9, amount: '100' },
        { minQuantity: 10, maxQuantity: null, amount: '90' },
      ],
      variants: {},
    });
    await f.book({
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P1, percent: '-5', max: 99 },
        { product: f.products.P1, percent: '-8', min: 100 },
        { category: f.categories.screws, percent: '-15' },
        { product: f.products.P5, variant: f.variants.P5r, fixed: '85' },
      ],
    });
    await f.book({ audience: { groups: [f.groups.VIP, f.groups.Gold] }, rows: [{ product: f.products.P2, percent: '-20' }] });
    await f.book({ type: 'sale', audience: 'everyone', rows: [{ product: f.products.P3, fixed: '29' }] });
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('every buyer, every line, each at its own quantity', async () => {
    const buyers: Array<Omit<ListingPriceViewerContext, 'salesChannel'>> = [
      {},
      { organization: f.orgs.Acme },
      { organization: f.orgs.AcmeW },
      { organization: f.orgs.Beta },
      { organization: f.orgs.Beta, customerAccountId: f.accounts.betaSilver },
      { organization: f.orgs.Gamma, customerAccountId: f.accounts.ola },
    ];
    const lines = [
      { key: 'p1-1', product: f.products.P1, quantity: 1 },
      { key: 'p1-10', product: f.products.P1, quantity: 10 },
      { key: 'p1-100', product: f.products.P1, quantity: 100 },
      { key: 'p1-1-again', product: f.products.P1, quantity: 1 },
      { key: 'p2', product: f.products.P2, quantity: 3 },
      { key: 'p3', product: f.products.P3, quantity: 1 },
      { key: 'p4', product: f.products.P4, quantity: 1 },
      { key: 'p5r', product: f.products.P5, variantId: f.variants.P5r, quantity: 2 },
      { key: 'p5b', product: f.products.P5, variantId: f.variants.P5b, quantity: 2 },
    ];
    for (const buyer of buyers) {
      const context = { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, ...buyer };
      const batch = await f.pricing.resolveLinePrices({ lines, context });
      expect([...batch.keys()].sort()).toEqual(lines.map((l) => l.key).sort());
      for (const line of lines) {
        const single = await f.pricing.resolveLinePrice({
          product: line.product,
          variantId: line.variantId ?? null,
          context: { ...context, quantity: line.quantity },
        });
        expect(batch.get(line.key), `${JSON.stringify(buyer)} ${line.key}`).toEqual(single);
      }
    }
  });

  it('A2 — the customer’s own group wins, and an account of another organisation is ignored', async () => {
    const channel = { id: f.channels.CH1.id, defaultCurrency: 'PLN' };
    const line = [{ key: 'k', product: f.products.P2, quantity: 1 }];
    const ola = await f.pricing.resolveLinePrices({ lines: line, context: { organization: f.orgs.Gamma, customerAccountId: f.accounts.ola, salesChannel: channel } });
    expect(ola.get('k')).toMatchObject({ amount: '40.0000', source: 'buyer' });
    const silver = await f.pricing.resolveLinePrices({ lines: line, context: { organization: f.orgs.Beta, customerAccountId: f.accounts.betaSilver, salesChannel: channel } });
    expect(silver.get('k')).toMatchObject({ amount: '50.0000', source: 'base' });
    const foreign = await f.pricing.resolveLinePrices({ lines: line, context: { organization: f.orgs.Acme, customerAccountId: f.accounts.ola, salesChannel: channel } });
    // Ola's account belongs to Gamma, so her own group (Gold) is ignored and
    // Acme's VIP applies — but under HY Acme's own category row (−15 % of 50)
    // ranks before VIP's product row (−20 %).
    expect(foreign.get('k')).toMatchObject({ amount: '42.5000', source: 'buyer' });
  });
});
