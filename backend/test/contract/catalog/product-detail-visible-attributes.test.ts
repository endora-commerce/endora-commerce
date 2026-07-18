import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Feature 012 / T043 — Product detail visibleAttributes contract (US6).
 *
 * Covers `contracts/storefront-attribute-rendering.contract.md` § US6:
 *   - GET /api/v1/catalog/products/:slug response includes
 *     `visibleAttributes[]` containing every attribute that has a
 *     value AND `isVisibleOnProductPage = true`.
 *   - For select / enum / multiselect types `valueRendered` is the
 *     resolved per-locale option label (with fallback to labelDefault).
 *   - Attributes flagged invisible OR with no value are omitted.
 */
describe('GET /catalog/products/:slug — visibleAttributes (T043)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('omits visibleAttributes when no attribute is flagged for the product page', async () => {
    // Seed has color/material/etc. on SEED_PRODUCT_101 but none flagged
    // isVisibleOnProductPage = true by default.
    const productSlug = await getProductSlug(h, SEED_PRODUCT_101_ID, adminCookie);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${productSlug}`,
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { visibleAttributes?: Array<{ key: string }> };
    };
    expect(body.data.visibleAttributes ?? []).toEqual([]);
  });

  it('surfaces an attribute once it is flagged isVisibleOnProductPage', async () => {
    // Flip isVisibleOnProductPage on the seeded `color` attribute and
    // verify that SEED_PRODUCT_101 (which has color: 'red') now
    // surfaces it. Resolved value should be the option label per active
    // locale (the seed sets en-US: 'Red' and pl-PL: 'Czerwony' — er,
    // actually the seed leaves the option labels at labelDefault, so
    // the rendered value is 'red').
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/color',
      payload: { isVisibleOnProductPage: true },
      cookies: adminCookie,
    });

    const productSlug = await getProductSlug(h, SEED_PRODUCT_101_ID, adminCookie);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${productSlug}`,
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { visibleAttributes?: Array<{ key: string; valueRendered: string }> };
    };
    const colorAttr = (body.data.visibleAttributes ?? []).find((a) => a.key === 'color');
    expect(colorAttr).toBeDefined();
    expect(colorAttr?.valueRendered).toBe('red');
  });
});

async function getProductSlug(
  h: BackendServerHandle,
  productId: string,
  cookies: Record<string, string>,
): Promise<string> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/admin/catalog/products/${productId}`,
    cookies,
  });
  const body = res.json() as { data: { slug: string } };
  return body.data.slug;
}
