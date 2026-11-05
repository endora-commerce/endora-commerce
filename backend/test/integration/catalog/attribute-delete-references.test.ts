import { randomUUID } from 'node:crypto';
import type { CartSnapshot } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-009, owner ruling
 * OR-5, research R-21 "inert") — what happens to other modules' rules when the
 * catalogue deletes an attribute they name.
 *
 * `catalog` may not read `promotions`', `price_lists`' or `product_feeds`'
 * tables (Principle I), so the delete neither refuses on their references nor
 * removes them. Each owner already fails closed on a key that no longer exists:
 *
 * - a promotion condition on the key is kept, and stops matching a cart line;
 * - a price-book row on the key is kept, and reports itself inactive;
 * - a feed whose selection rule names the key records a configuration error on
 *   its next run — never "match everything".
 *
 * No row of those modules is deleted. Every assertion has its positive control
 * before the delete, so "does not match" cannot pass on a rule that never did.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

describe('Attribute delete leaves foreign rules inert (feature 172, FR-009)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 6);
  const key = `adr_flag_${run}`;
  let attributeId: string;
  let productId: string;
  let channelId: string;

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params, 'all')) as T;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    // A closed-vocabulary attribute flagged for promotions and price lists, so
    // every consumer below accepts it at save time.
    const attribute = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: ADMIN,
      payload: {
        key,
        label: { 'en-US': 'Inert probe' },
        labelDefault: 'Inert probe',
        type: 'select',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        isPromoRule: true,
        isPriceRule: true,
        options: [
          { value: 'x', labelDefault: 'X', isDefault: true },
          { value: 'y', labelDefault: 'Y' },
        ],
      },
    });
    expect(attribute.statusCode, attribute.body).toBe(201);
    attributeId = (attribute.json() as { data: { id: string } }).data.id;

    const product = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: `ADR-172-${run}`,
        type: 'simple',
        status: 'active',
        name: `Inert probe ${run}`,
        description: 'Probe',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(product.statusCode, product.body).toBe(201);
    productId = (product.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('keeps every promotion, price-book row and feed, and each stops matching on the deleted key', async () => {
    // --- promotions: `notIn` holds for a line with no value, while the key exists.
    const promotion = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: ADMIN,
      payload: {
        name: `Inert promotion ${run}`,
        action: { type: 'free_delivery' },
        rule: { kind: 'condition', field: { kind: 'attribute', attributeKey: key }, op: 'notIn', values: ['x'] },
      },
    });
    expect(promotion.statusCode, promotion.body).toBe(201);
    const promotionId = (promotion.json() as { data: { id: string } }).data.id;
    const promotions = promotionServiceFor(h);
    const cart: CartSnapshot = {
      organizationId: null,
      customerGroupId: null,
      currency: 'PLN',
      deliveryTotal: 20,
      promotionCode: null,
      lines: [{ productId, variantId: null, categoryIds: [], quantity: 1, unitPrice: { amount: 100, currency: 'PLN' } }],
    } as unknown as CartSnapshot;
    const appliedBefore = await promotions.applyToCart(cart);
    expect(appliedBefore.appliedPromotions.map((p) => p.promotionId)).toContain(promotionId);

    // --- price_lists: an attribute row that is active while the key qualifies.
    const bookId = await seedPriceBookSql(h.em(), { name: `Inert book ${run}`, audience: 'everyone', rows: [] });
    await sql(
      `insert into price_list_matrix_entries
         (id, price_list_id, attribute_key, attribute_value, min_quantity, price_type, percent, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 'x', 1, 'percent', -10, now(), now())`,
      [bookId, key],
    );
    const bookRows = async (): Promise<Array<{ inactiveReason: string | null }>> => {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/price-books/${bookId}/rows`, cookies: ADMIN });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Array<{ inactiveReason: string | null }> }).data;
    };
    expect((await bookRows()).map((row) => row.inactiveReason)).toEqual([null]);

    // --- product_feeds: a feed narrowed on the key runs while the key exists.
    const priceListId = await seedFeedPrices(h.em(), { code: `adr_list_${run}`, amount: '55.0000' });
    const templates = await h.app.inject({ method: 'GET', url: '/api/v1/admin/feed-templates', cookies: ADMIN });
    const templateId = (templates.json() as { data: Array<{ id: string; systemCode: string | null }> }).data.find(
      (t) => t.systemCode === 'google_merchant_v1',
    )!.id;
    const feed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      cookies: ADMIN,
      payload: {
        name: `Inert feed ${run}`,
        slug: `inert-feed-${run}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        priceListId,
        selectionRule: { kind: 'condition', field: { kind: 'attribute', attributeKey: key }, op: 'eq', values: ['x'] },
      },
    });
    expect(feed.statusCode, feed.body).toBe(201);
    const feedId = (feed.json() as { data: { feed: { id: string } } }).data.feed.id;
    const runBefore = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(runBefore.status).not.toBe('failed');

    // --- the delete: nothing in the catalogue refers to the key any more.
    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/attributes/${attributeId}`, cookies: ADMIN });
    expect(del.statusCode, del.body).toBe(204);

    // promotions: kept, and no longer applied.
    expect(await sql<unknown[]>(`select id from promotions where id = ?`, [promotionId])).toHaveLength(1);
    const appliedAfter = await promotions.applyToCart(cart);
    expect(appliedAfter.appliedPromotions.map((p) => p.promotionId)).not.toContain(promotionId);

    // price_lists: kept, and inactive.
    expect(
      await sql<unknown[]>(`select id from price_list_matrix_entries where price_list_id = ? and attribute_key = ?`, [
        bookId,
        key,
      ]),
    ).toHaveLength(1);
    expect((await bookRows()).map((row) => row.inactiveReason)).toEqual(['attribute_deleted']);

    // product_feeds: kept, and the next run fails closed with a configuration error.
    expect(await sql<unknown[]>(`select id from product_feeds where id = ?`, [feedId])).toHaveLength(1);
    const runAfter = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(runAfter.status).toBe('failed');
    expect(runAfter.failureCode).toBe('unknown_attribute');
    expect(runAfter.failureDetail).toContain(key);
    expect(runAfter.emittedCount).toBe(0);
  });
});
