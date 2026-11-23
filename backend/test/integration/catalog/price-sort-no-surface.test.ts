import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PRICE_WALK_CURSOR_PURPOSE,
  type CatalogCursorSeal,
} from '../../../../packages/modules/catalog/src/backend/services/catalog-query.service.js';
import { pricingEngineOf, settlePriceSurface, warmPriceSort } from '../../helpers/price-surface.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  ALPHA,
  BETA,
  DELTA,
  GAMMA,
  PRICE_SORT_CHANNEL,
  PRICE_SORT_ORG_A,
  seedPriceSortFixture,
} from '../../helpers/price-sort-fixture.js';
import { tapStatements } from '../../helpers/statement-tap.js';

/**
 * Review finding 3 (release 0.108.0) — a price-sorted listing with no price
 * surface built yet (right after the upgrade, on a new channel, before the
 * worker has run) is served in the default order (`contracts/price-surface.md`
 * §3). It used to drop the cursor as well, so every page was page 1 with
 * `hasMore: true`, forever. The fallback now issues a cursor of its own and
 * honours it, so a walk terminates and meets every product exactly once —
 * also when the surface is built in the middle of the walk.
 */
describe('a price-sorted listing with no price surface pages to the end', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedPriceSortFixture(h.em());
    await dropRetailProfiles();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** No price order for the listing's channel: its profiles, and only those, go. */
  const dropRetailProfiles = () =>
    h
      .em()
      .getConnection()
      .execute(`delete from "price_profiles" where "sales_channel_id" = (select "id" from "sales_channels" where "code" = 'pl_retail')`);

  async function walk(
    limit: number,
    options: { cookies?: Record<string, string>; between?: (page: number) => Promise<void>; sort?: 'price' | '-price' } = {},
  ): Promise<{ skus: string[]; pages: number; ended: boolean }> {
    const skus: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=PRICE-SORT&limit=${limit}&sort=${options.sort ?? 'price'}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: PRICE_SORT_CHANNEL,
        ...(options.cookies ? { cookies: options.cookies } : {}),
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: Array<{ sku: string }>; pagination: { cursor: string | null; hasMore: boolean } };
      skus.push(...body.data.map((d) => d.sku));
      if (!body.pagination.hasMore) return { skus, pages: page + 1, ended: true };
      expect(body.pagination.cursor, 'a page with more after it names where to continue').not.toBeNull();
      cursor = body.pagination.cursor!;
      await options.between?.(page);
    }
    return { skus, pages: 20, ended: false };
  }

  it('a guest walk ends and meets every visible product once', async () => {
    for (const limit of [1, 2]) {
      const { skus, ended } = await walk(limit);
      expect(ended, `limit ${limit}`).toBe(true);
      expect([...skus].sort(), `limit ${limit}`).toEqual([ALPHA.sku, BETA.sku, GAMMA.sku].sort());
    }
  });

  it('an organization walk ends and meets every product it may see once', async () => {
    const { skus, ended } = await walk(1, { cookies: PRICE_SORT_ORG_A });
    expect(ended).toBe(true);
    expect([...skus].sort()).toEqual([ALPHA.sku, BETA.sku, DELTA.sku, GAMMA.sku].sort());
  });

  it('a walk begun without a surface keeps its own order when the surface is built midway', async () => {
    await dropRetailProfiles();
    const { skus, ended } = await walk(1, {
      between: async (page) => {
        if (page === 0) await settlePriceSurface(h);
      },
    });
    expect(ended).toBe(true);
    expect([...skus].sort()).toEqual([ALPHA.sku, BETA.sku, GAMMA.sku].sort());
  });

  /**
   * Review 2, finding 6 (release 0.108.0) — the other transition: a walk that
   * began on a price order whose surface then goes missing (a profile retired,
   * a precedence change, a rebuild) restarted at the default listing's page 1,
   * so the buyer met the products already served again. The walk now carries
   * on from the last price it served: the products still to come — priced
   * after it in the walk's direction, then the unpriced — in the default order.
   */
  describe('a walk begun on a price order whose surface goes missing midway', () => {
    const guest = { skus: [ALPHA.sku, BETA.sku, GAMMA.sku] };
    const orgA = { skus: [ALPHA.sku, BETA.sku, DELTA.sku, GAMMA.sku], cookies: PRICE_SORT_ORG_A };
    for (const [name, viewer] of [['a guest', guest], ['organization A', orgA]] as const) {
      for (const sort of ['price', '-price'] as const) {
        for (const limit of [1, 2]) {
          it(`${name}, sort=${sort}, limit ${limit}: no product is repeated or lost`, async () => {
            await dropRetailProfiles();
            await warmPriceSort(h, [{ headers: PRICE_SORT_CHANNEL, cookies: 'cookies' in viewer ? viewer.cookies : undefined }]);
            const { skus, ended } = await walk(limit, {
              sort,
              ...('cookies' in viewer ? { cookies: viewer.cookies } : {}),
              between: async (page) => {
                if (page === 0) await dropRetailProfiles();
              },
            });
            expect(ended).toBe(true);
            expect([...skus].sort()).toEqual([...viewer.skus].sort());
          });
        }
      }
    }

    it('a page that loses the order between two chunks ends with what it collected, and the walk goes on', async () => {
      await dropRetailProfiles();
      await warmPriceSort(h, [{ headers: PRICE_SORT_CHANNEL }]);
      const engine = pricingEngineOf(h);
      const real = engine.orderByUnitPrice.bind(engine);
      let calls = 0;
      const spy = vi.spyOn(engine, 'orderByUnitPrice').mockImplementation(async (query) => {
        calls += 1;
        // The first chunk is cut to this listing's first row so the page asks
        // again, and the order is gone by then — and for the rest of the walk.
        if (calls === 1) {
          const chunk = await real({ ...query, limit: 100 });
          return { ...chunk, rows: chunk.rows.filter((r) => r.productId === ALPHA.id), exhausted: false };
        }
        return { rows: [], exhausted: false, sourceRowsRead: 0, unordered: true };
      });
      try {
        const { skus, ended } = await walk(2);
        expect(calls).toBeGreaterThan(1);
        expect(ended).toBe(true);
        expect(skus[0]).toBe(ALPHA.sku);
        expect([...skus].sort()).toEqual([ALPHA.sku, BETA.sku, GAMMA.sku].sort());
      } finally {
        spy.mockRestore();
      }
    });

    it('the first page still comes from the price order', async () => {
      await dropRetailProfiles();
      await warmPriceSort(h, [{ headers: PRICE_SORT_CHANNEL }]);
      const { skus } = await walk(1, {
        between: async () => {
          await dropRetailProfiles();
        },
      });
      expect(skus[0]).toBe(ALPHA.sku);
    });
  });

  /**
   * Review 2, finding 7 — an `unordered` cursor is served by the default
   * listing, so what the price path read before it (the viewer's pricing
   * context, the category tree, the search's attribute keys) was thrown away.
   * A page on such a cursor issues exactly the statements the default
   * listing's page on the same cursor does.
   */
  it.each([
    ['organization A', { cookies: PRICE_SORT_ORG_A, filter: 'q=PRICE-SORT' }],
    // A category of at most 5 000 products is ordered live, never unordered:
    // its unordered cursor is built here, as a category above that size gets one.
    ['a guest in a category', { cookies: undefined, filter: `${encodeURIComponent('filter[category]')}=widgets` }],
  ] as const)('%s: an unordered page costs what the default page costs', async (_name, viewer) => {
    await dropRetailProfiles();
    const get = (query: string) =>
      h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?${viewer.filter}&limit=1${query}`,
        headers: PRICE_SORT_CHANNEL,
        ...(viewer.cookies ? { cookies: viewer.cookies } : {}),
      });
    const firstDefault = await get('');
    expect(firstDefault.statusCode, firstDefault.body).toBe(200);
    const defaultCursor = (firstDefault.json() as { pagination: { cursor: string | null } }).pagination.cursor;
    expect(defaultCursor, 'the listing has a second page').not.toBeNull();
    // Sealed as the walk seals its own (issue #497).
    const priceCursor = (h.container as unknown as { resolve<T>(name: string): T })
      .resolve<CatalogCursorSeal>('cursorSeal')
      .seal(PRICE_WALK_CURSOR_PURPOSE, JSON.stringify({ stream: 'unordered', cursor: defaultCursor }));
    const statementsOf = async (query: string): Promise<string[]> => {
      const seen: string[] = [];
      const listen = (q: { sql: string }) => seen.push(q.sql);
      const untap = tapStatements(h.em(), listen);
      try {
        const res = await get(query);
        expect(res.statusCode, res.body).toBe(200);
      } finally {
        untap();
      }
      return seen;
    };
    // The same page twice over, so caches on either path are as warm as each other.
    const cursorOf = (c: string | null) => `&cursor=${encodeURIComponent(c!)}`;
    // Feature 163 — the availability condition inlines the read's one `now`
    // (MikroORM renders bound values into the statement text), so two pages a
    // few milliseconds apart differ in that literal alone. The clock stands
    // still for the four reads; every statement, and every other value in it,
    // is still compared.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date() });
    let viaPrice: string[];
    let viaDefault: string[];
    try {
      await statementsOf(`&sort=price${cursorOf(priceCursor)}`);
      await statementsOf(cursorOf(defaultCursor));
      viaPrice = await statementsOf(`&sort=price${cursorOf(priceCursor)}`);
      viaDefault = await statementsOf(cursorOf(defaultCursor));
    } finally {
      vi.useRealTimers();
    }
    expect(viaPrice.join('\n')).toEqual(viaDefault.join('\n'));
  });
});
