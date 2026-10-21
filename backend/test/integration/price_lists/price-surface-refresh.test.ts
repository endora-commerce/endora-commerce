import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-027, `contracts/price-surface.md` §4) — the price surface is
 * refreshed after every change that can move a price: a book, its rows, its
 * channel set, a base price, a catalogue event, a channel change. Each marks
 * the profiles stale and bumps the pricing generation; the next ordering
 * rebuilds. The live paths — line and listing resolution, which the cart,
 * checkout, product page, quotes and order intake use — never read the surface.
 */
describe('price surface — freshness and live-path isolation', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);
  const context = () => ({ salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } });

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function ready(): Promise<void> {
    await f.pricing.orderByUnitPrice({ context: context(), direction: 'asc', after: null, limit: 1 });
    expect(await sql(`select distinct "state" from "price_profiles"`)).toEqual([{ state: 'ready' }]);
  }
  async function expectStale(): Promise<void> {
    expect(await sql(`select distinct "state" from "price_profiles"`)).toEqual([{ state: 'building' }]);
  }

  it('a book with rows, a row batch, a channel set and a base price each mark the surface stale', async () => {
    await ready();
    const book = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '99' }] });
    await expectStale();
    await ready();
    await f.system(() =>
      f.books.replaceRows(book.id, {
        upsert: [{ selection: { productId: f.products.P2.id }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '49' } }],
        delete: [],
      }),
    );
    await expectStale();
    await ready();
    await f.system(() => f.books.replaceChannels(book.id, [f.channels.CH2.id]));
    await expectStale();
    await ready();
    await f.setBase(f.products.P3, { product: [{ minQuantity: 1, maxQuantity: null, amount: '31' }], variants: {} });
    await expectStale();
    await f.clearBooks();
    await f.resetBase();
  });

  it('a catalogue event and a channel change mark it stale', async () => {
    for (const [event, payload] of [
      ['category.updated.v1', { categoryId: f.categories.screws }],
      ['attribute.updated.v1', { attributeKey: 'color' }],
      ['product.created.v1', { productId: f.products.P1.id }],
      ['sales_channels.identity_changed', { channelCode: f.channels.CH1.code }],
    ] as const) {
      await ready();
      h.eventBus.emit(event as never, { eventId: `t-${Date.now()}`, occurredAt: new Date().toISOString(), ...payload } as never);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await expectStale();
    }
  });

  it('live resolution never reads the surface', async () => {
    await ready();
    const conn = h.em().getConnection() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = conn.execute.bind(conn);
    const seen: string[] = [];
    conn.execute = (...args: unknown[]) => {
      seen.push(String(args[0]));
      return original(...args);
    };
    try {
      await f.pricing.resolveLinePrices({
        lines: [{ key: 'a', product: f.products.P1, quantity: 3 }],
        context: { ...context(), organization: f.orgs.Acme },
      });
      await f.pricing.resolveListingPriceDetails({ products: Object.values(f.products), context: context() });
      await f.pricing.resolveEngine({ product: f.products.P5, variantId: f.variants.P5r, context: { ...context(), quantity: 1 } });
    } finally {
      conn.execute = original;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.includes('price_profile'))).toEqual([]);
  });
});
