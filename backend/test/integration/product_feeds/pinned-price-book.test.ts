import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-029) — a product feed pinned to a named price book reads that
 * book's rows over the catalogue price of the feed's channel and currency;
 * products the book does not price are absent from the feed, as before. The
 * read is `pricingService.namedListPrices` on the price-book engine.
 */
describe('product feeds — a feed pinned to a price book', () => {
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

  const read = (priceListId: string) =>
    f.pricing.namedListPrices({
      priceListId,
      currencyCode: 'PLN',
      salesChannelId: f.channels.CH1.id,
      productIds: [f.products.P1.id, f.products.P2.id, f.products.P3.id],
    });

  it('the book’s rows over the catalogue price; what it does not price is absent', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '120' }] });
    const acme = await f.book({
      audience: { organizations: [f.orgs.Acme] },
      rows: [{ category: f.categories.screws, percent: '-10' }],
    });
    const prices = await read(acme.id);
    // P1: catalogue 120 −10 %; P2: base 50 −10 %; P3 is a bolt — not priced by the book.
    expect(Object.fromEntries(prices)).toEqual({
      [f.products.P1.id]: '108.0000',
      [f.products.P2.id]: '45.0000',
    });
  });

  it('a feed pinned to the base book reads the base prices', async () => {
    const [base] = await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select "id" from "price_lists" where "is_system" = true and "currency_code" = 'PLN'`);
    const prices = await read(base!.id);
    expect(Object.fromEntries(prices)).toEqual({
      [f.products.P1.id]: '100.0000',
      [f.products.P2.id]: '50.0000',
      [f.products.P3.id]: '30.0000',
    });
  });
});
