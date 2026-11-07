import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Issue #234 — the storefront listing's default keyset is `(created_at, id)`
 * and its cursor carries `created_at` as a millisecond ISO string. A
 * `created_at` written by SQL `now()` (an import, a seed, a bulk insert) used
 * to keep microseconds, so on the next page `created_at < T.mmm` excluded the
 * rest of that millisecond and `created_at = T.mmm` matched none of it: of six
 * products 100 µs apart, three came back.
 *
 * `products.created_at` is `timestamptz(3)` now, so PostgreSQL rounds every
 * value it stores to the millisecond the cursor carries, whoever wrote it.
 * The six products are created through the ORM and then given their
 * `created_at` by SQL, 100 µs apart inside one millisecond and later than
 * anything else in the database, so they are the first six of the walk.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const BASE = '2099-01-01T00:00:00.000100Z';

describe('#234 — listing cursor over sub-millisecond created_at [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const products: MinimumProductFixture[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    for (let i = 0; i < 6; i++) {
      products.push(
        await createMinimumProduct(em, {
          sku: `S234-${i}-${RUN}`,
          nameEn: `Sub-millisecond ${i} ${RUN}`,
          namePl: `Sub-millisecond ${i} ${RUN}`,
          channelIds: [channelId],
        }),
      );
    }
    for (const [i, product] of products.entries()) {
      await em
        .getConnection()
        .execute(`update "products" set "created_at" = ?::timestamptz + (? * interval '100 microseconds') where "id" = ?`, [
          BASE,
          i,
          product.id,
        ]);
    }
  }, 120_000);

  afterAll(async () => {
    if (!h) return;
    // Out of the far future, so no later file's walk starts with them.
    await h
      .em()
      .getConnection()
      .execute(`update "products" set "created_at" = now() - interval '1 day' where "id" in (?)`, [
        products.map((p) => p.id),
      ]);
    await teardownBackendServer(h);
  });

  async function walk(limit: number, pages: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < pages; page++) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: CHANNEL,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as {
        data: Array<{ id: string }>;
        pagination: { cursor: string | null; hasMore: boolean };
      };
      seen.push(...body.data.map((p) => p.id));
      if (!body.pagination.hasMore) break;
      cursor = body.pagination.cursor;
    }
    return seen;
  }

  it('stores created_at to the millisecond, whoever writes it', async () => {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ us: string }>>(
        `select (extract(microseconds from "created_at")::bigint % 1000)::text as us from "products" where "id" in (?)`,
        [products.map((p) => p.id)],
      );
    expect(rows.map((row) => row.us)).toEqual(['0', '0', '0', '0', '0', '0']);
  });

  // They are the six newest products, so the walk's first six rows are
  // exactly them — once each, whatever the page size.
  it.each([1, 2, 4])('walks all six exactly once with limit %i', async (limit) => {
    const firstSix = (await walk(limit, Math.ceil(6 / limit))).slice(0, 6);
    expect([...firstSix].sort()).toEqual(products.map((p) => p.id).sort());
  });
});
