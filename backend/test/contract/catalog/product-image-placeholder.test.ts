import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature: product image placeholder setting.
 *
 * The `general.product_image_placeholder_url` setting (Settings module, General
 * group) supplies a fallback image for products that have no image of their
 * own. The storefront catalog list + detail endpoints fill `primaryAssetUrl`
 * with the resolved value (global or per sales channel). Empty value ⇒ no
 * placeholder (behaviour unchanged).
 */
describe('Storefront product image placeholder setting', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const PLACEHOLDER = 'https://cdn.example.com/no-image.png';

  interface Summary {
    id: string;
    slug: string;
    primaryAssetUrl: string | null;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    // Reset the global override so the placeholder can't leak into sibling
    // catalog tests sharing the database.
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/product_image_placeholder_url/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: '' },
    });
    await teardownBackendServer(h);
  });

  async function listProducts(): Promise<Summary[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/products', headers: { 'x-sales-channel': 'pl_retail' } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Summary[] }).data;
  }

  it('returns null primaryAssetUrl for imageless products when the setting is empty', async () => {
    const data = await listProducts();
    const imageless = data.find((p) => p.primaryAssetUrl === null);
    // The synthetic seed creates products without assets, so there must be one.
    expect(imageless).toBeDefined();
  });

  it('fills primaryAssetUrl with the configured placeholder on list + detail', async () => {
    // Capture an imageless product to assert against after the setting is set.
    const before = await listProducts();
    const target = before.find((p) => p.primaryAssetUrl === null);
    expect(target).toBeDefined();

    // Set the global placeholder.
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/product_image_placeholder_url/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: PLACEHOLDER },
    });
    expect(put.statusCode).toBe(200);

    // List: the previously-imageless product now carries the placeholder.
    const after = await listProducts();
    const updated = after.find((p) => p.id === target!.id);
    expect(updated?.primaryAssetUrl).toBe(PLACEHOLDER);

    // Detail: same fallback on the product page payload.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${target!.slug}`,
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(detail.statusCode).toBe(200);
    const product = (detail.json() as { data: { primaryAssetUrl: string | null; assets: unknown[] } }).data;
    if (product.assets.length === 0) {
      expect(product.primaryAssetUrl).toBe(PLACEHOLDER);
    }
  });
});
