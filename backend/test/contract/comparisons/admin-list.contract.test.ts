import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  // No `beforeEach` cleanup (issue #166). The admin list is the one surface
  // here that reads every comparison there is, so it used to be made
  // deterministic by emptying the table first — which is what let the
  // assertions below be written as `toHaveLength(1)`, a claim about the
  // platform rather than about this test. Each case now mints its own
  // comparison and reads it back through the endpoint's own `createdAfter`
  // filter, keyed on the id it was handed.

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
    const since = new Date();
    const { id } = await mintComparison(h);

    const res = await h.app.inject({
      method: 'GET',
      url: listUrl({ createdAfter: since }),
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
    const row = body.data.find((r) => r.id === id);
    expect(row, 'the comparison this test created is missing from the list').toBeDefined();
    expect(row!.owner.kind).toBe('anonymous');
    expect(row!.productCount).toBe(2);
    expect(row!.salesChannel.code).toBe('pl_retail');
    expect(body.meta.limit).toBe(25);
    // The cursor is a statement about the page, not about the table: a page
    // that did not fill is the last one. Asserting `null` outright would be
    // asserting that nothing else in the suite has ever created a comparison.
    if (body.data.length < body.meta.limit) {
      expect(body.meta.nextCursor).toBeNull();
    } else {
      expect(typeof body.meta.nextCursor).toBe('string');
    }
  });

  it('GET /admin/comparisons honours ownerType filter', async () => {
    const since = new Date();
    const { id } = await mintComparison(h);

    const anonOnly = await h.app.inject({
      method: 'GET',
      url: listUrl({ createdAfter: since, ownerType: 'anonymous' }),
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    const customerOnly = await h.app.inject({
      method: 'GET',
      url: listUrl({ createdAfter: since, ownerType: 'customer' }),
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    expect(idsOf(anonOnly)).toContain(id);
    expect(idsOf(customerOnly)).not.toContain(id);
  });

  it('GET /admin/comparisons/:id returns the detail projection', async () => {
    const { id } = await mintComparison(h);

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
    const since = new Date();
    const { cookie, id } = await mintComparison(h);

    const before = await h.app.inject({
      method: 'GET',
      url: listUrl({ createdAfter: since }),
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    expect(idsOf(before)).toContain(id);

    const del = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });
    expect(del.statusCode).toBe(204);

    const after = await h.app.inject({
      method: 'GET',
      url: listUrl({ createdAfter: since }),
      headers: { ...SALES_CHANNEL_HEADER, cookie: ADMIN_COOKIE },
    });
    expect(idsOf(after)).not.toContain(id);
  });
});

// ---------------------------------------------------------------------------

/**
 * The admin list, filtered to what this test created.
 *
 * `createdAfter` is the endpoint's own filter, so scoping a case to a timestamp
 * it took itself exercises the contract rather than working around it.
 */
function listUrl(filters: {
  createdAfter: Date;
  ownerType?: 'anonymous' | 'customer';
}): string {
  const params = new URLSearchParams({ createdAfter: filters.createdAfter.toISOString() });
  if (filters.ownerType) params.set('ownerType', filters.ownerType);
  return `/api/v1/admin/comparisons?${params.toString()}`;
}

/** The ids a list response carries, so a case can name its own row in it. */
function idsOf(response: { json(): unknown }): string[] {
  return (response.json() as { data: Array<{ id: string }> }).data.map((row) => row.id);
}

/**
 * A comparison owned by this test alone: the server mints the `compare_token`,
 * and the id it answers with is what every assertion below keys on.
 */
async function mintComparison(
  h: BackendServerHandle,
): Promise<{ cookie: string; id: string }> {
  const first = await h.app.inject({
    method: 'POST',
    url: '/api/v1/comparisons/me/products',
    headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
    payload: { productId: SEED_PRODUCT_101_ID },
  });
  if (first.statusCode !== 200) {
    throw new Error(`mint failed: ${first.statusCode} ${first.body}`);
  }
  const cookie =
    (Array.isArray(first.headers['set-cookie'])
      ? first.headers['set-cookie'][0]
      : first.headers['set-cookie']
    )?.split(';')[0] ?? '';
  const second = await h.app.inject({
    method: 'POST',
    url: '/api/v1/comparisons/me/products',
    headers: {
      ...SALES_CHANNEL_HEADER,
      'content-type': 'application/json',
      cookie,
    },
    payload: { productId: SEED_PRODUCT_102_ID },
  });
  const { id } = (second.json() as { data: { id: string } }).data;
  return { cookie, id };
}
