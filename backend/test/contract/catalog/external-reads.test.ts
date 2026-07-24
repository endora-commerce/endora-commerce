import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';

/**
 * Feature 062 / T013 — external catalog reads (contracts/catalog-api-key-reads.md).
 *
 *  - anonymous ⇒ 401 on every /api/v1/external/catalog/* endpoint;
 *  - key without `catalog:read` ⇒ 403 API_KEY_OUT_OF_SCOPE (audited);
 *  - unbound key ⇒ platform context: channel-default prices, header channel;
 *  - bound key ⇒ org-effective `price`, `priceUnavailable` marker,
 *    `availability`, detail `priceTiers`, key-pinned channel,
 *    `x-search-backend: postgres`;
 *  - `changedSince` + pagination work on the external list;
 *  - EVERY response carries `Cache-Control: private, no-store` (§0 invariant).
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const NO_STORE = 'private, no-store';

interface ExternalSummary {
  id: string;
  sku: string;
  slug: string;
  price: { amount: number; currency: string } | null;
  priceUnavailable?: boolean;
  availability?: { band: string; inStock: boolean };
  priceTiers?: Array<{
    minQuantity: number;
    amount: number;
    currency: string;
    isSale: boolean;
  }>;
}

describe('External catalog reads (062 / T013)', () => {
  let h: BackendServerHandle;
  let boundToken: string;
  let unboundToken: string;
  let ordersOnlyToken: string;
  let productPricedId: string;
  let productUnpricedId: string;

  const mint = async (payload: Record<string, unknown>): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const channel = em.create(SalesChannel, {
      code: 'ext-read',
      name: { 'en-US': 'External read channel' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    await em.persistAndFlush(channel);
    await h.salesChannels.cache.invalidate('ext-read');

    const category = em.create(Category, {
      name: { 'en-US': 'External widgets' },
      slug: 'external-widgets',
    });
    await em.persistAndFlush(category);

    const priced = em.create(Product, {
      sku: 'EXT-PRICED-001',
      slug: 'ext-priced-product',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Externally priced product' },
      description: { 'en-US': '' },
      visibility: 'public',
      manageStock: false,
      attributeValues: { defaultPrice: 42.5 },
    });
    const unpriced = em.create(Product, {
      sku: 'EXT-UNPRICED-002',
      slug: 'ext-unpriced-product',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Externally unpriced product' },
      description: { 'en-US': '' },
      visibility: 'public',
      manageStock: false,
      attributeValues: { defaultPrice: 13 },
    });
    await em.persistAndFlush([priced, unpriced]);
    productPricedId = priced.id;
    productUnpricedId = unpriced.id;

    const conn = em.getConnection();
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?)`,
      [channel.id, priced.id, channel.id, unpriced.id],
    );
    await conn.execute(
      `insert into sales_channel_categories (sales_channel_id, category_id) values (?,?)`,
      [channel.id, category.id],
    );
    await conn.execute(
      `insert into product_categories (product_id, category_id) values (?,?)`,
      [priced.id, category.id],
    );

    // Org-targeted price list with a two-step bracket ladder for EXT-PRICED-001.
    const priceLists = new PriceListService(() => h.em());
    const list = await priceLists.create({
      name: 'Org A external base',
      type: 'base',
      applicationRule: {
        kind: 'criterion',
        type: 'organization',
        values: [TEST_ORGANIZATION_ID],
      },
    });
    await priceLists.addProduct(list.id, priced.id);
    await priceLists.replaceBrackets(list.id, priced.id, {
      PLN: [
        { minQuantity: 1, maxQuantity: 9, amount: '100.00' },
        { minQuantity: 10, maxQuantity: null, amount: '90.00' },
      ],
    });
    await priceLists.activate(list.id);

    boundToken = await mint({
      name: 'Bound external reader',
      scopes: ['catalog:read'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: channel.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    unboundToken = await mint({ name: 'Unbound external reader', scopes: ['catalog:read'] });
    ordersOnlyToken = await mint({
      name: 'Orders-only key',
      scopes: ['orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: channel.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('anonymous requests are refused with 401 on every external catalog endpoint', async () => {
    for (const url of [
      '/api/v1/external/catalog/products',
      '/api/v1/external/catalog/products/ext-priced-product',
      '/api/v1/external/catalog/categories',
    ]) {
      const res = await h.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.headers['cache-control']).toBe(NO_STORE);
    }
  });

  it('key without catalog:read ⇒ 403 API_KEY_OUT_OF_SCOPE + audit row', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'api_key.out_of_scope' });
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products',
      headers: { authorization: `Bearer ${ordersOnlyToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_OUT_OF_SCOPE,
    );
    const after = await h.em().count(AuditLogEntry, { action: 'api_key.out_of_scope' });
    expect(after).toBe(before + 1);
  });

  it('unbound key gets platform context: channel-default prices from the header channel', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products',
      headers: {
        authorization: `Bearer ${unboundToken}`,
        'x-sales-channel': 'ext-read',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(NO_STORE);
    expect(res.headers['x-search-backend']).toBe('postgres');
    const items = (res.json() as { data: ExternalSummary[] }).data;
    const priced = items.find((p) => p.sku === 'EXT-PRICED-001');
    const unpriced = items.find((p) => p.sku === 'EXT-UNPRICED-002');
    expect(priced).toBeDefined();
    expect(unpriced).toBeDefined();
    // Channel-default pricing exactly as the public surface computes it.
    expect(priced!.price).toEqual({ amount: 42.5, currency: 'PLN' });
    expect(unpriced!.price).toEqual({ amount: 13, currency: 'PLN' });
    expect(priced!.priceUnavailable).toBeUndefined();
    expect(unpriced!.priceUnavailable).toBeUndefined();
    // Availability indication is channel-public data — present for any key.
    expect(priced!.availability).toEqual({ band: 'available', inStock: true });
  });

  it('bound key gets org-effective prices, priceUnavailable marker, and its pinned channel', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products',
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(NO_STORE);
    expect(res.headers['x-search-backend']).toBe('postgres');
    expect(res.headers['x-sales-channel']).toBe('ext-read');
    const items = (res.json() as { data: ExternalSummary[] }).data;
    const priced = items.find((p) => p.sku === 'EXT-PRICED-001');
    const unpriced = items.find((p) => p.sku === 'EXT-UNPRICED-002');
    expect(priced).toBeDefined();
    expect(unpriced).toBeDefined();
    // Org-effective unit price at quantity 1 — NOT the channel default.
    expect(priced!.price).toEqual({ amount: 100, currency: 'PLN' });
    expect(priced!.priceUnavailable).toBeUndefined();
    // No bracket for this product on any matching list ⇒ explicit marker.
    expect(unpriced!.price).toBeNull();
    expect(unpriced!.priceUnavailable).toBe(true);
    expect(priced!.availability).toEqual({ band: 'available', inStock: true });
  });

  it('bound detail carries the org bracket ladder as priceTiers', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products/ext-priced-product',
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(NO_STORE);
    const detail = (res.json() as { data: ExternalSummary }).data;
    expect(detail.id).toBe(productPricedId);
    expect(detail.price).toEqual({ amount: 100, currency: 'PLN' });
    expect(detail.priceTiers).toEqual([
      { minQuantity: 1, amount: 100, currency: 'PLN', isSale: false },
      { minQuantity: 10, amount: 90, currency: 'PLN', isSale: false },
    ]);
  });

  it('unbound detail has no org fields; detail 404s stay no-store', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products/ext-priced-product',
      headers: {
        authorization: `Bearer ${unboundToken}`,
        'x-sales-channel': 'ext-read',
      },
    });
    expect(res.statusCode).toBe(200);
    const detail = (res.json() as { data: ExternalSummary }).data;
    expect(detail.price).toEqual({ amount: 42.5, currency: 'PLN' });
    expect(detail.priceTiers).toBeUndefined();

    const missing = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products/no-such-product',
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['cache-control']).toBe(NO_STORE);
  });

  it('changedSince filters the external list (Postgres path)', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const empty = await h.app.inject({
      method: 'GET',
      url: `/api/v1/external/catalog/products?changedSince=${encodeURIComponent(future)}`,
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { data: unknown[] }).data).toHaveLength(0);

    const past = new Date(Date.now() - 3_600_000).toISOString();
    const full = await h.app.inject({
      method: 'GET',
      url: `/api/v1/external/catalog/products?changedSince=${encodeURIComponent(past)}`,
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(full.statusCode).toBe(200);
    expect((full.json() as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(2);
  });

  it('pagination works on the external list', async () => {
    const first = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/products?limit=1',
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: ExternalSummary[];
      pagination: { cursor: string | null; hasMore: boolean; limit: number };
    };
    expect(firstBody.data).toHaveLength(1);
    expect(firstBody.pagination.hasMore).toBe(true);
    expect(firstBody.pagination.cursor).toBeTruthy();

    const second = await h.app.inject({
      method: 'GET',
      url: `/api/v1/external/catalog/products?limit=1&cursor=${encodeURIComponent(firstBody.pagination.cursor!)}`,
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { data: ExternalSummary[] };
    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.data[0]!.id).not.toBe(firstBody.data[0]!.id);
  });

  it('categories endpoint returns the channel tree, no-store', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/catalog/categories',
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(NO_STORE);
    const tree = (res.json() as { data: Array<{ slug: string }> }).data;
    expect(tree.some((n) => n.slug === 'external-widgets')).toBe(true);
    expect((res.json() as { data: unknown[] }).data).toBeDefined();

    void productUnpricedId;
  });
});
