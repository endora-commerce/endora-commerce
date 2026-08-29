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
import {
  freshCompareToken,
  freshShareToken,
} from '../../helpers/comparison-fixtures.js';
import { Comparison } from '../../helpers/package-entities.js';

/**
 * T052 — Contract test for `GET /api/v1/comparisons/me/pdf`
 * (US4, feature 007). Per contracts/public-comparisons-pdf.md.
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };

describe('GET /api/v1/comparisons/me/pdf — feature 007 / US4', () => {
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

  // No `beforeEach` cleanup (issue #166): every case below carries an owner
  // token minted for it, so "this caller has no comparison" is a statement
  // about that token rather than about the table being empty.

  it('returns 404 COMPARISON_NOT_FOUND when caller has no comparison', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me/pdf',
      headers: {
        ...SALES_CHANNEL_HEADER,
        cookie: `compare_token=${freshCompareToken()}`,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.COMPARISON_NOT_FOUND },
    });
  });

  it('streams a PDF starting with %PDF- when the comparison has products', async () => {
    const cookie = await mintComparison(h);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me/pdf',
      headers: { ...SALES_CHANNEL_HEADER, cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="comparison-[A-Za-z0-9_-]{8}\.pdf"$/,
    );
    // res.body in Fastify inject is a Buffer when the content-type isn't JSON.
    const body = res.rawPayload;
    expect(body.length).toBeGreaterThan(100);
    expect(body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 30_000);

  it('returns 409 COMPARISON_EMPTY for a comparison with zero products', async () => {
    // Seed an empty comparison directly via the EM so we hit the guard.
    const em = h.em();
    const channel = await em.findOne(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'SalesChannel' as any,
      { code: 'pl_retail' },
    );
    if (!channel) throw new Error('expected pl_retail seed channel');
    const ownerToken = freshCompareToken();
    const c = em.create(Comparison, {
      shareToken: freshShareToken(),
      anonymousToken: ownerToken,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      salesChannelId: (channel as any).id,
      displayMode: 'all',
    });
    await em.persistAndFlush(c);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me/pdf',
      headers: {
        ...SALES_CHANNEL_HEADER,
        cookie: `compare_token=${ownerToken}`,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.COMPARISON_EMPTY },
    });
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
