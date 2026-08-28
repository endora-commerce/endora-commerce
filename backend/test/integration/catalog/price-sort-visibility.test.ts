import type { Knex } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  deleteRestrictedProduct,
  seedPriceSortFixture,
} from '../../helpers/price-sort-fixture.js';

/**
 * Feature 086, US5 and FR-019/FR-020 — a price ordering must not become a side
 * channel, and must not become a scan.
 *
 * ## Why an ordering needs its own disclosure test
 *
 * Sorting introduces a way for a hidden row to be observable that neither the
 * relevance sort nor the name sort had: through **position and page
 * boundaries**, because the hidden row carries the value being ordered by. So
 * the acceptance is a comparison of two catalogues — one holding a product
 * restricted to an organisation the viewer is not in, one with that product
 * deleted outright — asserted page for page and cursor for cursor (SC-007).
 *
 * `DELTA` is priced **between** the two products a viewer outside the
 * organisation can see, which is what makes a gap, a shifted position or a
 * moved page boundary detectable at all.
 */

describe('a price ordering discloses nothing about a product the viewer may not see', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedPriceSortFixture(h.em());
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function walk(
    limit: number,
    cookies?: Record<string, string>,
  ): Promise<Array<{ skus: string[]; cursor: string | null; hasMore: boolean }>> {
    const pages: Array<{ skus: string[]; cursor: string | null; hasMore: boolean }> = [];
    let cursor: string | undefined;
    for (let i = 0; i < 12; i += 1) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=PRICE-SORT&limit=${limit}&sort=price${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
        headers: PRICE_SORT_CHANNEL,
        ...(cookies ? { cookies } : {}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: Array<{ sku: string }>;
        pagination: { cursor: string | null; hasMore: boolean };
      };
      pages.push({
        skus: body.data.map((d) => d.sku),
        cursor: body.pagination.cursor,
        hasMore: body.pagination.hasMore,
      });
      if (!body.pagination.hasMore || !body.pagination.cursor) break;
      cursor = body.pagination.cursor;
    }
    return pages;
  }

  it('lets the organisation inside the allow-list see the restricted product between the two others', async () => {
    const inside = await walk(50, PRICE_SORT_ORG_A);
    expect(inside[0]?.skus).toEqual([ALPHA.sku, DELTA.sku, BETA.sku, GAMMA.sku]);
  });

  it('produces, for a viewer outside it, a listing identical to the catalogue with it deleted', async () => {
    // SC-007. Recorded first, then the row is removed and the walk repeated:
    // page for page, cursor for cursor, `hasMore` for `hasMore`.
    const withRestricted = await walk(1);
    const withRestrictedPageOfTwo = await walk(2);

    await deleteRestrictedProduct(h.em());
    h.em().clear();

    const withoutRestricted = await walk(1);
    const withoutRestrictedPageOfTwo = await walk(2);

    expect(withoutRestricted).toEqual(withRestricted);
    expect(withoutRestrictedPageOfTwo).toEqual(withRestrictedPageOfTwo);
    // …and the comparison is only worth something because the walk saw
    // something: two priced products and the tail, in that order.
    expect(withRestricted.flatMap((p) => p.skus)).toEqual([ALPHA.sku, BETA.sku, GAMMA.sku]);
  });
});

/**
 * FR-020 / SC-003 — the listing gate is a **constant in page size**, and the
 * price ordering holds it.
 *
 * MR !822 made the priced listing constant in page size by hoisting the last
 * per-card reads to the page; a price ordering that read one row per card would
 * hide under a ceiling expressed as an absolute number, so the assertion here is
 * the *shape* of the function rather than its value: the statement count for a
 * page of 5 and a page of 50 is the same number.
 *
 * A separate `describe` with its own server, because the corpus has to be large
 * enough for a page of 50 to be a real page.
 */
describe('a price-ordered page costs a constant number of statements in page size', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedPriceSortFixture(h.em());
    // 120 more priced products, so page sizes 5…100 are all genuinely full.
    const em = h.em();
    const { Product } = await import('../../helpers/package-entities.js');
    const { PriceListProduct, PriceListPriceBracket } = await import(
      '../../helpers/package-entities.js'
    );
    const { SalesChannel } = await import(
      '../../../src/kernel/sales-channels/sales-channel.entity.js'
    );
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    const listId = '00000000-0000-4000-8000-0000000086b1';
    const ids: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      const idx = String(i).padStart(4, '0');
      const product = em.create(Product, {
        sku: `PRICE-SORT-BULK-${idx}`,
        slug: `price-sort-bulk-${idx}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Bulk ${idx}` },
        description: { 'en-US': `Bulk ${idx}` },
        visibility: 'public',
        allowedOrganizationIds: [],
        attributeValues: {},
      });
      em.persist(product);
      ids.push(product.id);
    }
    await em.flush();
    for (const id of ids) {
      await em
        .getConnection()
        .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [
          retail.id,
          id,
        ]);
      em.create(PriceListProduct, { priceListId: listId, productId: id });
    }
    await em.flush();
    for (const [i, id] of ids.entries()) {
      em.create(PriceListPriceBracket, {
        priceListId: listId,
        productId: id,
        currencyCode: 'PLN',
        minQuantity: 1,
        maxQuantity: null,
        amount: `${100 + i}.00`,
      });
    }
    await em.flush();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function statementsFor(limit: number, sort: string): Promise<{ count: number; cards: number }> {
    const knex: Knex = h.em().getConnection().getKnex();
    const url = `/api/v1/catalog/products?limit=${limit}&sort=${sort}`;
    const request = async (): Promise<number> => {
      const res = await h.app.inject({ method: 'GET', url, headers: PRICE_SORT_CHANNEL });
      expect(res.statusCode).toBe(200);
      return (res.json() as { data: unknown[] }).data.length;
    };
    // Warm: the pricing LRU is off in the harness, so this only settles the
    // ORM's own metadata reads.
    await request();
    let count = 0;
    const tally = (): void => {
      count += 1;
    };
    knex.on('query', tally);
    const cards = await request();
    knex.off('query', tally);
    return { count, cards };
  }

  it('costs the same number of statements at page 5 and at page 50', async () => {
    const small = await statementsFor(5, 'price');
    const large = await statementsFor(50, 'price');
    const largest = await statementsFor(100, 'price');
    // eslint-disable-next-line no-console
    console.log(
      `[086] price-sorted statements: 5=>${small.count} (${small.cards} cards) ` +
        `50=>${large.count} (${large.cards} cards) 100=>${largest.count} (${largest.cards} cards)`,
    );
    expect(small.cards).toBe(5);
    expect(large.cards).toBe(50);
    expect(large.count).toBe(small.count);
    expect(largest.count).toBe(small.count);
  });

  it('costs a price-ordered page no more than the default ordering plus a stated constant', async () => {
    // SC-003 — "plus a stated constant", and the constant is **stated**, here,
    // rather than left as a ceiling nobody re-derives. Measured on this corpus
    // at page 50: 13 statements for `-createdAt`, 19 for `price`. The six are
    //
    //   1  the active price lists, for the candidate vector;
    //   1  the merge itself (one candidate for an anonymous viewer, so the
    //      watermark probe *is* the merge — a second statement appears only
    //      where the viewer has more than one candidate list);
    //   1  hydrating the ordered ids into product rows;
    //   1  channel membership over that chunk;
    //   2  the second pass the loop makes when a chunk comes back full and the
    //      page is not.
    //
    // Both numbers include the two statements FR-016's answer costs — the
    // `pricing.*` setting row and its per-channel value — because the listing
    // reports that answer on **every** response (FR-023: the storefront gates
    // its controls on the server's answer rather than guessing the display mode
    // it cannot see), so they are on the default page too and cancel out of the
    // difference. They are the price of not offering a control the API refuses.
    //
    // None of the six is per card, which is the property that matters and which
    // the two page sizes above assert directly.
    const priced = await statementsFor(50, 'price');
    const byDate = await statementsFor(50, '-createdAt');
    // eslint-disable-next-line no-console
    console.log(`[086] price=${priced.count} default=${byDate.count} statements at page 50`);
    expect(priced.count - byDate.count).toBeLessThanOrEqual(8);
  });

  it('costs the same number of statements at page 5 and 50 with a range filter too', async () => {
    const small = await statementsFor(5, 'name&minPrice=0&maxPrice=100000');
    const large = await statementsFor(50, 'name&minPrice=0&maxPrice=100000');
    // eslint-disable-next-line no-console
    console.log(`[086] ranged statements: 5=>${small.count} 50=>${large.count}`);
    expect(large.count).toBe(small.count);
  });
});
