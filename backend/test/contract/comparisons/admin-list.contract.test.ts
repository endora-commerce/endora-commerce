import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';
import { findAttributeExtensionByKey } from '../../helpers/seed-catalog.js';
import { Comparison } from '../../../src/modules/comparisons/entities/comparison.entity.js';
import { ComparisonProduct } from '../../../src/modules/comparisons/entities/comparison-product.entity.js';

/**
 * T061 — Contract test for the admin overview endpoints
 * (US5, feature 007).
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };
const ADMIN_COOKIE = 'b2b_session=stub-admin-session';
const RESTRICTED_ADMIN_COOKIE = 'b2b_session=stub-restricted-admin-session';

describe('admin/comparisons — feature 007 / US5', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const key of ['color', 'material']) {
      const ext = await findAttributeExtensionByKey(em, key);
      if (ext) ext.isComparable = true;
    }
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    const em = h.em();
    await em.nativeDelete(ComparisonProduct, {});
    await em.nativeDelete(Comparison, {});
  });

  it('GET /admin/comparisons returns 403 for an admin without comparisons:read', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons',
      headers: { ...SALES_CHANNEL_HEADER, cookie: RESTRICTED_ADMIN_COOKIE },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.FORBIDDEN } });
  });

  it('GET /admin/comparisons returns the list with pagination metadata', async () => {
    await mintComparison(h);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons',
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{
        id: string;
        owner: { kind: string };
        productCount: number;
        salesChannel: { code: string };
      }>;
      meta: { limit: number; nextCursor: string | null };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.owner.kind).toBe('anonymous');
    expect(body.data[0]!.productCount).toBe(2);
    expect(body.data[0]!.salesChannel.code).toBe('pl_retail');
    expect(body.meta.limit).toBe(25);
    expect(body.meta.nextCursor).toBeNull();
  });

  it('GET /admin/comparisons honours ownerType filter', async () => {
    await mintComparison(h);

    const anonOnly = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons?ownerType=anonymous',
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    const customerOnly = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons?ownerType=customer',
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    const anonBody = anonOnly.json() as { data: unknown[] };
    const customerBody = customerOnly.json() as { data: unknown[] };
    expect(anonBody.data).toHaveLength(1);
    expect(customerBody.data).toHaveLength(0);
  });

  it('GET /admin/comparisons/:id returns the detail projection', async () => {
    await mintComparison(h);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons',
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    const id = (list.json() as { data: Array<{ id: string }> }).data[0]!.id;

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/comparisons/${id}`,
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      data: { id: string; products: unknown[]; comparableAttributes: unknown[] };
    };
    expect(body.data.id).toBe(id);
    expect(body.data.products).toHaveLength(2);
    expect(Array.isArray(body.data.comparableAttributes)).toBe(true);
  });

  it('GET /admin/comparisons/:id returns 404 for unknown id', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons/00000000-0000-4000-8000-00000000ffff',
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.COMPARISON_NOT_FOUND },
    });
  });

  it('row disappears from list after the storefront customer deletes it (T062 cascade)', async () => {
    const cookie = await mintComparison(h);

    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons',
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    expect((before.json() as { data: unknown[] }).data).toHaveLength(1);

    const del = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });
    expect(del.statusCode).toBe(204);

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons',
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    expect((after.json() as { data: unknown[] }).data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

async function mintComparison(h: BackendServerHandle): Promise<string> {
  const first = await h.app.inject({
    method: 'POST',
    url: '/api/v1/comparisons/me/products',
    headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
    payload: { productId: SEED_PRODUCT_101_ID },
  });
  const cookie =
    (Array.isArray(first.headers['set-cookie'])
      ? first.headers['set-cookie'][0]
      : first.headers['set-cookie']
    )?.split(';')[0] ?? '';
  await h.app.inject({
    method: 'POST',
    url: '/api/v1/comparisons/me/products',
    headers: {
      ...SALES_CHANNEL_HEADER,
      'content-type': 'application/json',
      cookie,
    },
    payload: { productId: SEED_PRODUCT_102_ID },
  });
  return cookie;
}
