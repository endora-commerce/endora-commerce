import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product } from './package-entities.js';
import { seedPriceBookSql } from './price-book-sql.js';
import { warmPriceSort } from './price-surface.js';
import { seedOtherTestOrganization } from './seed-organizations.js';
import { OTHER_TEST_ORGANIZATION_ID } from './test-actors.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * A corpus for walking a price-sorted listing page by page (review 3 of
 * release 0.108.0, part A): products with an everyone price, unpriced ones and
 * ones the guest may not see, in a default order the test chooses, on
 * `pl_retail`. Every product's SKU starts with {@link PRICE_WALK_PREFIX}, so
 * `q=` scopes a listing to the corpus; each `seed` replaces the previous one.
 */

export const PRICE_WALK_CHANNEL = { 'x-sales-channel': 'pl_retail' };
export const PRICE_WALK_ORG_A = { b2b_session: 'stub-customer-session' };
export const PRICE_WALK_PREFIX = 'PRICE-WALK-';
const BOOK_ID = '00000000-0000-4000-8000-0000000c3b01';

export interface PriceWalkItem {
  key: string;
  /** The everyone book's figure, or `null` for an unpriced product. */
  price: string | null;
  /** Visible to the guest (default), or restricted to another organization. */
  hidden?: boolean;
  /** Minutes before the fixture's epoch: the default order is newest first. */
  age: number;
}

export interface PriceWalkPage {
  data: Array<{ sku: string; price: { amount: number } | null }>;
  pagination: { cursor: string | null; hasMore: boolean };
}

export interface PriceWalkOptions {
  sort?: 'price' | '-price';
  limit: number;
  cookies?: Record<string, string> | undefined;
  start?: string;
  /** More of the query string, e.g. `&maxPrice=200`. */
  query?: string;
  /** Runs after each page that has more, with everything served so far and the next cursor. */
  between?: (served: readonly string[], cursor: string) => Promise<void>;
}

export function priceWalkCorpus(h: BackendServerHandle) {
  let retailId = '';
  /** sku → product id, of the corpus seeded last. */
  let ids = new Map<string, string>();

  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);
  const bump = () =>
    (h.container as unknown as { resolve<T>(name: string): T })
      .resolve<{ handle: { pricingGeneration: { bump(): Promise<void> } } }>('priceLists')
      .handle.pricingGeneration.bump();

  const skuOf = (key: string) => `${PRICE_WALK_PREFIX}${key}`;

  const corpus = {
    skuOf,

    async init(): Promise<void> {
      await seedOtherTestOrganization(h.em());
      retailId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    },

    /** The retail channel's price order, every viewer's: gone, as a retired or rebuilding profile leaves it. */
    dropRetailProfiles: () => sql(`delete from "price_profiles" where "sales_channel_id" = ?`, [retailId]),

    async clear(): Promise<void> {
      // The harness does not empty display-mode overrides between files, so the
      // corpus removes the ones `withhold` wrote (issue #497).
      await sql(
        `delete from "price_display_mode_overrides" where "scope" = 'product' and "target_id" in (select "id" from "products" where "sku" like ?)`,
        [`${PRICE_WALK_PREFIX}%`],
      );
      await sql(`delete from "price_list_product_lines" where "price_list_id" = ?`, [BOOK_ID]);
      await sql(`delete from "price_list_matrix_entries" where "price_list_id" = ?`, [BOOK_ID]);
      await sql(`delete from "sales_channel_price_lists" where "price_list_id" = ?`, [BOOK_ID]);
      await sql(`delete from "price_lists" where "id" = ?`, [BOOK_ID]);
      await sql(
        `delete from "sales_channel_products" where "product_id" in (select "id" from "products" where "sku" like ?)`,
        [`${PRICE_WALK_PREFIX}%`],
      );
      await sql(`delete from "products" where "sku" like ?`, [`${PRICE_WALK_PREFIX}%`]);
      await bump();
      ids = new Map();
    },

    /** Replace the corpus, then build the retail price order for the viewers named (a cookie jar each). */
    async seed(
      items: readonly PriceWalkItem[],
      viewers: ReadonlyArray<Record<string, string> | undefined> = [undefined],
    ): Promise<void> {
      await corpus.clear();
      const em = h.em().fork();
      const epoch = Date.parse('2026-03-01T00:00:00.000Z');
      for (const item of items) {
        const id = randomUUID();
        const sku = skuOf(item.key);
        ids.set(sku, id);
        em.create(Product, {
          id,
          sku,
          slug: sku.toLowerCase(),
          type: 'simple',
          status: 'active',
          name: sku,
          description: sku,
          visibility: item.hidden ? 'organization_restricted' : 'public',
          allowedOrganizationIds: item.hidden ? [OTHER_TEST_ORGANIZATION_ID] : [],
          attributeValues: {},
          createdAt: new Date(epoch - item.age * 60_000),
        });
      }
      await em.flush();
      for (const id of ids.values()) {
        await sql(`insert into "sales_channel_products" ("sales_channel_id", "product_id") values (?, ?)`, [retailId, id]);
      }
      await seedPriceBookSql(h.em(), {
        id: BOOK_ID,
        name: 'Price walk book',
        audience: 'everyone',
        rows: items
          .filter((i) => i.price !== null)
          .map((i) => ({ productId: ids.get(skuOf(i.key))!, fixed: i.price! })),
      });
      await bump();
      await corpus.dropRetailProfiles();
      await warmPriceSort(
        h,
        viewers.map((cookies) => ({ headers: PRICE_WALK_CHANNEL, cookies })),
      );
    },

    /** Change one product's everyone price, as an unaudited write does, and tell the engine. */
    async reprice(key: string, amount: string): Promise<void> {
      await sql(`update "price_list_matrix_entries" set "amount" = ? where "price_list_id" = ? and "product_id" = ?`, [
        amount,
        BOOK_ID,
        ids.get(skuOf(key))!,
      ]);
      await bump();
    },

    /** The id of a product of the corpus seeded last. */
    idOf(key: string): string {
      const id = ids.get(skuOf(key));
      if (id === undefined) throw new Error(`no product ${key} in the corpus`);
      return id;
    },

    /**
     * Withhold one product's price from every viewer (display mode `none`,
     * issue #491) the way a write the surface has not caught up with yet leaves
     * it: its card is withheld at once, and the price order keeps the position
     * its last price gave it until the worker refreshes it. Removed by `clear`.
     */
    async withhold(key: string): Promise<void> {
      await sql(
        `insert into "price_display_mode_overrides" ("scope", "target_id", "mode") values ('product', ?, 'none')`,
        [corpus.idOf(key)],
      );
      await bump();
    },

    /** One listing page of the corpus; `query` is appended to `q=`. */
    async page(query: string, cookies?: Record<string, string>): Promise<PriceWalkPage> {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${PRICE_WALK_PREFIX}${query}`,
        headers: PRICE_WALK_CHANNEL,
        ...(cookies ? { cookies } : {}),
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as PriceWalkPage;
    },

    /** Walk the listing to its end, or 400 pages. */
    async walk(options: PriceWalkOptions): Promise<{ skus: string[]; ended: boolean; pages: number }> {
      const skus: string[] = [];
      let cursor: string | undefined = options.start;
      for (let n = 0; n < 400; n += 1) {
        const body = await corpus.page(
          `&limit=${options.limit}${options.sort ? `&sort=${options.sort}` : ''}${options.query ?? ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          options.cookies,
        );
        skus.push(...body.data.map((d) => d.sku));
        if (!body.pagination.hasMore) return { skus, ended: true, pages: n + 1 };
        expect(body.pagination.cursor, 'a page with more after it names where to continue').not.toBeNull();
        cursor = body.pagination.cursor!;
        await options.between?.(skus, cursor);
      }
      return { skus, ended: false, pages: 400 };
    },

    visibleSkus: (items: readonly PriceWalkItem[]) => items.filter((i) => !i.hidden).map((i) => skuOf(i.key)),

    counts(skus: readonly string[]): Map<string, number> {
      const out = new Map<string, number>();
      for (const s of skus) out.set(s, (out.get(s) ?? 0) + 1);
      return out;
    },

    /** `n` priced products keyed `<key>00`, `<key>01`, …, each placed by `at`. */
    priced: (n: number, at: (i: number) => { price: string; age: number }, key = 'P'): PriceWalkItem[] =>
      Array.from({ length: n }, (_, i) => ({ key: `${key}${String(i).padStart(2, '0')}`, ...at(i) })),

    /** A `between` that drops the price order once, the first time the walk has served `at` products. */
    dropOnceAt(at: number, before?: () => Promise<void>) {
      let done = false;
      return async (served: readonly string[]) => {
        if (done || served.length < at) return;
        done = true;
        await before?.();
        await corpus.dropRetailProfiles();
      };
    },
  };
  return corpus;
}
