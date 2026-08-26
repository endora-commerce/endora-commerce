import type { EntityManager } from '@mikro-orm/postgresql';
import { PriceList, PriceListPriceBracket, PriceListProduct } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';

/**
 * A listing pages by a **keyset over the column it is ordered by**, and
 * `sort=name` is ordered by `slug`.
 *
 * Both chunked walks in `CatalogQueryService` fetch a chunk with
 * `orderForSort(sort)` and then ask for "everything after the last row of that
 * chunk". Those are one decision, and they had come apart: the `after`
 * predicate was written over `created_at` whatever the ordering, so under
 * `sort=name` it excluded the rows *newer* than the last one served — an
 * arbitrary set — instead of the rows already served.
 *
 * The consequence is not a slow page, it is a wrong one: products repeat inside
 * a single page, and the products between the repeats are never reached at all.
 * The fixture makes that visible by pinning `created_at` so it **agrees** with
 * the slug order, which is the case in which a `created_at` keyset throws the
 * page away and keeps re-serving its own beginning.
 *
 * `ZZPAGE-01` and `ZZPAGE-02` carry no price, so a price range excludes both:
 * that is what makes the ranged walk take more than one chunk for a *single*
 * page, which is where the repeat became observable — the statement-count
 * assertion in `price-sort-visibility.test.ts` was the alarm, at
 * `expected 23 to be 31`, and the page under it read
 * `[ALPHA, BETA, BULK-0000, ALPHA, BETA]`. Two of them rather than one because
 * a page whose first chunk falls exactly one row short cuts the repeat off with
 * its own `slice(0, limit)`; two short is what brings it inside the page.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const LIST_ID = '00000000-0000-4000-8000-0000000087b1';

/** Slug order, and — deliberately — `created_at` order as well. */
const PRICED = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

async function seed(em: EntityManager): Promise<void> {
  const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });

  const make = async (suffix: string, createdAt: Date): Promise<string> => {
    const product = em.create(Product, {
      sku: `ZZPAGE-${suffix}`,
      slug: `zz-page-${suffix.toLowerCase()}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': `Paging ${suffix}` },
      description: { 'en-US': `Paging ${suffix}` },
      visibility: 'public',
      allowedOrganizationIds: [],
      attributeValues: {},
      createdAt,
    });
    await em.persistAndFlush(product);
    await em
      .getConnection()
      .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [
        retail.id,
        product.id,
      ]);
    return product.id;
  };

  // Sort first of the eight and are priced by nobody, so a price range drops
  // both. Their `created_at` is the newest, so a `created_at` keyset never
  // reaches back past them either.
  await make('01', new Date('2026-02-01T00:00:00.000Z'));
  await make('02', new Date('2026-02-02T00:00:00.000Z'));

  const priced: string[] = [];
  for (const [index, suffix] of PRICED.entries()) {
    priced.push(await make(suffix, new Date(Date.UTC(2026, 0, index + 1))));
  }

  const list = em.create(PriceList, {
    id: LIST_ID,
    code: 'zz-page-list',
    name: 'Paging list',
    currency: 'PLN',
    isDefault: false,
    priority: 0,
    type: 'base',
    status: 'active',
    startsAt: null,
    endsAt: null,
    applicationRule: { kind: 'all' },
    isSystem: false,
    modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await em.persistAndFlush(list);
  for (const productId of priced) {
    em.create(PriceListProduct, { priceListId: list.id, productId });
  }
  await em.flush();
  for (const [index, productId] of priced.entries()) {
    em.create(PriceListPriceBracket, {
      priceListId: list.id,
      productId,
      currencyCode: 'PLN',
      minQuantity: 1,
      maxQuantity: null,
      amount: `${(index + 1) * 10}.00`,
    });
  }
  await em.flush();
}

describe('a name-ordered listing pages by the slug it is ordered by', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seed(h.em());
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function walk(query: string, limit: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | undefined;
    // Bounded rather than `while (hasMore)`: a keyset that cannot advance
    // re-serves its own first page for ever, and a test that hangs reports
    // nothing.
    for (let page = 0; page < 12; page += 1) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?${query}&limit=${limit}${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
        headers: CHANNEL,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: Array<{ sku: string }>;
        pagination: { cursor: string | null; hasMore: boolean };
      };
      seen.push(...body.data.map((d) => d.sku));
      if (!body.pagination.hasMore || !body.pagination.cursor) break;
      cursor = body.pagination.cursor;
    }
    return seen;
  }

  it('walks the whole catalogue once, in slug order', async () => {
    const seen = await walk('q=ZZPAGE&sort=name', 2);
    expect(seen).toEqual([
      'ZZPAGE-01',
      'ZZPAGE-02',
      ...PRICED.map((suffix) => `ZZPAGE-${suffix}`),
    ]);
  });

  it('walks it once under a price range too, dropping only the unpriced two', async () => {
    const seen = await walk('q=ZZPAGE&sort=name&minPrice=0&maxPrice=1000', 2);
    expect(seen).toEqual(PRICED.map((suffix) => `ZZPAGE-${suffix}`));
  });

  it('serves no product twice inside one ranged page', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?q=ZZPAGE&sort=name&minPrice=0&maxPrice=1000&limit=3',
      headers: CHANNEL,
    });
    expect(res.statusCode).toBe(200);
    const skus = (res.json() as { data: Array<{ sku: string }> }).data.map((d) => d.sku);
    expect(skus).toEqual(['ZZPAGE-A', 'ZZPAGE-B', 'ZZPAGE-C']);
  });

  it('walks the reverse ordering once as well', async () => {
    const seen = await walk('q=ZZPAGE&sort=-name', 3);
    expect(seen).toEqual([
      ...[...PRICED].reverse().map((suffix) => `ZZPAGE-${suffix}`),
      'ZZPAGE-02',
      'ZZPAGE-01',
    ]);
  });
});
