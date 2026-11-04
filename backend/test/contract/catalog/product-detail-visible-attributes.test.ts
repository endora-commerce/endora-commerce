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

  /**
   * Feature 172 / US4 (SC-003, FR-032) — across the whole seeded catalogue,
   * the projection the storefront's "Parametry" draws holds only attributes
   * flagged visible, never a hidden one that has a value, and never a Page
   * Builder content attribute — even one in the product's set.
   */
  it('holds neither a hidden attribute nor a content attribute, on any seeded product', async () => {
    const DEFAULT_ATTRIBUTE_SET_ID = 'defa0017-0000-4000-8000-000000000000';
    const contentKey = 'sc003_buying_guide';
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: contentKey,
        label: { 'en-US': 'Buying guide' },
        type: 'page_builder',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(created.statusCode, created.body).toBe(201);
    const contentAttributeId = (created.json() as { data: { id: string } }).data.id;
    const assigned = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attribute-sets/${DEFAULT_ATTRIBUTE_SET_ID}/attributes`,
      payload: { assignments: [{ attributeId: contentAttributeId, position: 9 }] },
      cookies: adminCookie,
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    // `color` visible, every other seeded attribute hidden — and SEED_PRODUCT_101
    // holds values for `material` and `certification` too.
    const flipped = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/color',
      payload: { isVisibleOnProductPage: true },
      cookies: adminCookie,
    });
    expect(flipped.statusCode).toBe(200);

    const attributes = (
      (
        await h.app.inject({ method: 'GET', url: '/api/v1/admin/catalog/attributes', cookies: adminCookie })
      ).json() as { data: Array<{ key: string; isVisibleOnProductPage: boolean }> }
    ).data;
    const visibleKeys = new Set(attributes.filter((a) => a.isVisibleOnProductPage).map((a) => a.key));
    expect(visibleKeys.has(contentKey)).toBe(false);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?limit=100',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(list.statusCode).toBe(200);
    const products = (list.json() as { data: Array<{ id: string; slug: string }> }).data;
    expect(products.map((p) => p.id)).toContain(SEED_PRODUCT_101_ID);

    for (const product of products) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${product.slug}`,
        headers: { 'x-sales-channel': 'pl_retail' },
      });
      expect(res.statusCode).toBe(200);
      const keys = ((res.json() as { data: { visibleAttributes?: Array<{ key: string }> } }).data.visibleAttributes ?? []).map(
        (a) => a.key,
      );
      for (const key of keys) {
        expect(visibleKeys.has(key), `${product.slug} shows ${key}`).toBe(true);
        expect(key).not.toBe(contentKey);
      }
      if (product.id === SEED_PRODUCT_101_ID) expect(keys).toEqual(['color']);
    }
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
