import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture, type RowSpec } from '../../helpers/pricing-fixture.js';
import { countRebuildRequests, settlePriceSurface } from '../../helpers/price-surface.js';

/**
 * Feature 160 (FR-027, `contracts/price-surface.md` §4) — the price surface is
 * refreshed after every change that can move a price: a book, its rows, its
 * channel set, a base price, a catalogue event, a channel change. Each marks
 * the profiles stale and bumps the pricing generation; the worker rebuilds. A
 * request never waits on a build (`contracts/price-surface.md` §3): a stale
 * profile keeps serving its previous surface until the rebuilt one is swapped
 * in, and a profile never built is answered without one. The live paths — line
 * and listing resolution, which the cart, checkout, product page, quotes and
 * order intake use — never read the surface.
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
    await settlePriceSurface(h);
    expect(await sql(`select distinct "state", "stale" from "price_profiles"`)).toEqual([{ state: 'ready', stale: false }]);
  }
  /**
   * Marked — whole (`stale`) or per product (`price_profile_stale_products`,
   * `contracts/price-surface.md` §4) — and still serving the surface it had.
   * Which profiles and products a trigger marks is
   * `price-surface-targeted-refresh.test.ts`'s subject.
   */
  async function expectStale(): Promise<void> {
    expect(await sql(`select distinct "state" from "price_profiles"`)).toEqual([{ state: 'ready' }]);
    const [{ n }] = (await sql<{ n: number }>(
      `select count(*)::int as n from "price_profiles" f
        where f."stale" or exists (select 1 from "price_profile_stale_products" m where m."profile_id" = f."id")`,
    )) as [{ n: number }];
    expect(n, 'profiles marked').toBeGreaterThan(0);
  }

  /** The surface rows a request writes while it runs: none, ever. */
  async function surfaceWritesOf(run: () => Promise<unknown>): Promise<string[]> {
    const knex = h.em().getConnection().getKnex();
    const writes: string[] = [];
    const listen = (q: { sql: string }) => {
      if (/^\s*(insert into|delete from|update) "price_profile_prices"/i.test(q.sql)) writes.push(q.sql);
    };
    knex.on('query', listen);
    try {
      await run();
    } finally {
      knex.off('query', listen);
    }
    return writes;
  }

  const firstPage = async (organization?: PricingFixture['orgs']['Acme']) =>
    f.pricing.orderByUnitPrice({
      context: { ...context(), ...(organization ? { organization } : {}) },
      direction: 'asc',
      after: null,
      limit: 50,
    });

  it('a request during a rebuild answers from the previous surface, and the swap brings the new order', async () => {
    await ready();
    const before = (await firstPage()).rows.map((r) => r.productId);
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P3, fixed: '1' }] });
    await expectStale();
    let during: string[] = [];
    const started = Date.now();
    const writes = await surfaceWritesOf(async () => {
      during = (await firstPage()).rows.map((r) => r.productId);
    });
    expect(Date.now() - started).toBeLessThan(150);
    expect(writes).toEqual([]);
    expect(during).toEqual(before);
    await settlePriceSurface(h);
    expect((await firstPage()).rows[0]).toMatchObject({ productId: f.products.P3.id, amount: '1.0000' });
    await f.clearBooks();
    await settlePriceSurface(h);
  });

  /**
   * Run `request` with a build swapped in between the read path's look at the
   * served generation and its read of the surface rows — the moment a swap
   * committing under a request lands. The swap happens on the first surface
   * read of the request, once.
   */
  async function withSwapBeforeSurfaceRead<T>(request: () => Promise<T>): Promise<{ result: T; swapped: number }> {
    const driver = h.em().getDriver() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = driver.execute;
    let swapped = -1;
    driver.execute = async function (this: unknown, ...args: unknown[]) {
      if (swapped === -1 && /from "price_profile_prices" [eb]\b/.test(String(args[0]))) {
        swapped = 0;
        driver.execute = original;
        swapped = await settlePriceSurface(h);
      }
      return original.apply(this, args);
    };
    try {
      return { result: await request(), swapped };
    } finally {
      driver.execute = original;
    }
  }

  it('a swap committing while a request reads the surface leaves it one whole build, never an empty or mixed page', async () => {
    // A guest (everyone stream only), a buyer with one own row (both streams),
    // and a buyer whose all-products percentage covers the everyone surface (the
    // buyer stream alone) — once with a write that keeps the coverage and once
    // with one that ends it, where the page read for the old pair of builds
    // must not be served from the new buyer build alone.
    const everyoneWrite = async () => {
      await f.book({ audience: 'everyone', rows: [{ product: f.products.P3, fixed: '1' }] });
    };
    const cases: Array<{ viewer?: PricingFixture['orgs']['Acme']; row: RowSpec; write: (acmeBook: { id: string; rowIds: string[] }) => Promise<void> }> = [
      { row: { product: f.products.P2, fixed: '2' }, write: everyoneWrite },
      { viewer: f.orgs.Acme, row: { product: f.products.P2, fixed: '2' }, write: everyoneWrite },
      { viewer: f.orgs.Acme, row: { percent: '-2' }, write: everyoneWrite },
      {
        viewer: f.orgs.Acme,
        row: { percent: '-2' },
        write: async (acmeBook) => {
          await f.system(() =>
            f.books.replaceRows(acmeBook.id, {
              upsert: [{ selection: { productId: f.products.P2.id }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '2' } }],
              delete: acmeBook.rowIds,
            }),
          );
        },
      },
    ];
    for (const { viewer, row, write } of cases) {
      const acmeBook = await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [row] });
      await firstPage(viewer);
      await settlePriceSurface(h);
      await ready();
      const before = (await firstPage(viewer)).rows.map((r) => `${r.productId}:${r.amount}`);
      expect(before.length).toBeGreaterThan(0);
      await write(acmeBook);
      await expectStale();
      const { result, swapped } = await withSwapBeforeSurfaceRead(() => firstPage(viewer));
      expect(swapped).toBeGreaterThan(0);
      const after = (await firstPage(viewer)).rows.map((r) => `${r.productId}:${r.amount}`);
      expect(after).not.toEqual(before);
      const during = result.rows.map((r) => `${r.productId}:${r.amount}`);
      expect([before, after]).toContainEqual(during);
      await f.clearBooks();
      await settlePriceSurface(h);
    }
  });

  it('a never-built unrestricted request returns without building and asks the worker', async () => {
    await sql(`delete from "price_profiles"`);
    const rebuilds = countRebuildRequests(h);
    try {
      // Nothing is built: no order to give, and none is built for the request.
      let guest: Awaited<ReturnType<typeof firstPage>> | null = null;
      expect(await surfaceWritesOf(async () => (guest = await firstPage()))).toEqual([]);
      expect(guest!).toMatchObject({ rows: [], unordered: true });
      expect(rebuilds.count).toBeGreaterThan(0);
      expect(await sql(`select distinct "state" from "price_profiles"`)).toEqual([{ state: 'building' }]);

      // The everyone surface is built; Acme's is not — Acme is ordered from the
      // everyone surface meanwhile, and the build of Acme's is asked for.
      await settlePriceSurface(h);
      await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P2, fixed: '1' }] });
      await settlePriceSurface(h);
      const asked = rebuilds.count;
      let acme: Awaited<ReturnType<typeof firstPage>> | null = null;
      expect(await surfaceWritesOf(async () => (acme = await firstPage(f.orgs.Acme)))).toEqual([]);
      expect(acme!.rows.map((r) => r.productId)).toEqual((await firstPage()).rows.map((r) => r.productId));
      expect(rebuilds.count).toBeGreaterThan(asked);

      // Once built, Acme's order is Acme's.
      await settlePriceSurface(h);
      expect((await firstPage(f.orgs.Acme)).rows[0]).toMatchObject({ productId: f.products.P2.id, amount: '1.0000' });
    } finally {
      rebuilds.restore();
      await f.clearBooks();
      await settlePriceSurface(h);
    }
  });


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
    // A book pricing on the attribute, so the attribute event concerns a product.
    await f.book({ audience: 'everyone', rows: [{ category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' }] });
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
    await f.clearBooks();
    await settlePriceSurface(h);
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
