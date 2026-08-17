import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 011 / US8 — Linked price-lists product editor panel (T092).
 *
 * Covers `GET /api/v1/admin/products/:productId/price-lists`.
 */
const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('Linked price-lists panel (feature 011 US8)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    await new DefaultPriceListMigrator(h.em).seedDefault();
  });

  it('returns a product-only-on-Default panel with the Default row', async () => {
    const svc = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '99.0000' }],
    });

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/price-lists`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        items: Array<{
          list: { id: string; name: string; type: string; status: string };
          summary: Array<{ currencyCode: string; summary: string }>;
          deepLinkPath: string;
        }>;
      };
    };
    expect(body.data.items).toHaveLength(1);
    const row = body.data.items[0]!;
    expect(row.list.id).toBe(DEFAULT_PRICE_LIST_ID);
    expect(row.list.name).toBe('Default');
    expect(row.summary).toHaveLength(1);
    expect(row.summary[0]?.currencyCode).toBe('PLN');
    expect(row.summary[0]?.summary).toContain('99');
    expect(row.deepLinkPath).toBe(
      `/admin/price-lists/${DEFAULT_PRICE_LIST_ID}/products?focus=${SEED_PRODUCT_101_ID}`,
    );
  });

  it('lists every linked price list with per-currency summaries', async () => {
    const svc = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));

    await svc.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100' }],
      EUR: [{ minQuantity: 1, maxQuantity: null, amount: '24' }],
    });

    const sale = await svc.create({
      name: 'Spring Promo',
      type: 'sale',
      applicationRule: { kind: 'criterion', type: 'currency', values: ['PLN'] },
    });
    await svc.addProduct(sale.id, SEED_PRODUCT_101_ID);
    await svc.replaceBrackets(sale.id, SEED_PRODUCT_101_ID, {
      PLN: [
        { minQuantity: 1, maxQuantity: 9, amount: '90' },
        { minQuantity: 10, maxQuantity: null, amount: '80' },
      ],
    });
    await svc.activate(sale.id);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/price-lists`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        items: Array<{
          list: { id: string; name: string; type: string };
          summary: Array<{ currencyCode: string; summary: string }>;
        }>;
      };
    };
    expect(body.data.items).toHaveLength(2);

    const def = body.data.items.find((i) => i.list.id === DEFAULT_PRICE_LIST_ID);
    expect(def).toBeDefined();
    expect(def!.summary.map((s) => s.currencyCode).sort()).toEqual(['EUR', 'PLN']);

    const promo = body.data.items.find((i) => i.list.name === 'Spring Promo');
    expect(promo).toBeDefined();
    expect(promo!.list.type).toBe('sale');
    expect(promo!.summary).toHaveLength(1);
    expect(promo!.summary[0]?.summary).toMatch(/across 2 brackets/);
  });

  it('returns an empty items array when the product is not assigned to any list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/products/${SEED_PRODUCT_102_ID}/price-lists`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: unknown[] } };
    expect(body.data.items).toEqual([]);
  });

  it('returns 404 for an unknown product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/products/00000000-0000-4000-8000-000000ffff77/price-lists',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated callers', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/price-lists`,
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
