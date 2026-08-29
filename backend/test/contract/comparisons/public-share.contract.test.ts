import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
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
import { freshShareToken } from '../../helpers/comparison-fixtures.js';

/**
 * T037 — Contract test for `GET /api/v1/comparisons/share/:token`
 * (US2, feature 007). Per contracts/public-comparisons-share.md.
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };

describe('GET /api/v1/comparisons/share/:token — feature 007 / US2', () => {
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

  // No `beforeEach` cleanup (issue #166): a share token identifies exactly one
  // comparison, so every case below names the row it created and the unknown-
  // token case names one it minted and never stored. Neither depends on the
  // table being empty.

  it('returns 404 for an unknown token', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/comparisons/share/${freshShareToken()}`,
      headers: SALES_CHANNEL_HEADER,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.COMPARISON_NOT_FOUND },
    });
  });

  it('returns 200 with viewerIsOwner=false for a recipient', async () => {
    const { shareToken } = await mintComparison(h);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/comparisons/share/${shareToken}`,
      headers: SALES_CHANNEL_HEADER,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { products: unknown[]; comparableAttributes: unknown[] };
      meta: { viewerIsOwner: boolean };
    };
    expect(body.meta.viewerIsOwner).toBe(false);
    expect(body.data.products).toHaveLength(2);
    // The shape must NOT carry `maxProducts` — that's owner-only.
    expect((body.data as Record<string, unknown>)['maxProducts']).toBeUndefined();
  });

  it('returns viewerIsOwner=true when the owner opens their own share link', async () => {
    const { shareToken, ownerCookie } = await mintComparison(h);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/comparisons/share/${shareToken}`,
      headers: { ...SALES_CHANNEL_HEADER, cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { meta: { viewerIsOwner: boolean } };
    expect(body.meta.viewerIsOwner).toBe(true);
  });

  it('returns 404 once the owner deletes the comparison', async () => {
    const { shareToken, ownerCookie } = await mintComparison(h);

    // Owner deletes.
    const del = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/comparisons/me',
      headers: { ...SALES_CHANNEL_HEADER, cookie: ownerCookie },
    });
    expect(del.statusCode).toBe(204);

    // Recipient revisits.
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/comparisons/share/${shareToken}`,
      headers: SALES_CHANNEL_HEADER,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function mintComparison(
  h: BackendServerHandle,
): Promise<{ shareToken: string; ownerCookie: string }> {
  const first = await h.app.inject({
    method: 'POST',
    url: '/api/v1/comparisons/me/products',
    headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
    payload: { productId: SEED_PRODUCT_101_ID },
  });
  const ownerCookie =
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
      cookie: ownerCookie,
    },
    payload: { productId: SEED_PRODUCT_102_ID },
  });

  const get = await h.app.inject({
    method: 'GET',
    url: '/api/v1/comparisons/me',
    headers: { ...SALES_CHANNEL_HEADER, cookie: ownerCookie },
  });
  const body = get.json() as { data: { shareToken: string } };
  return { shareToken: body.data.shareToken, ownerCookie };
}
