import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { ProductAttribute } from '../../../src/modules/catalog/entities/product-attribute.entity.js';

/**
 * Feature 039 (US3) — quick search matches SKU, name, and the values of
 * `quick_searchable` attributes only (FR-011 / FR-013).
 */

const COOKIE = { b2b_session: 'stub-customer-session' };
const FLAGGED_VALUE = 'qomagenta7';
const PLAIN_VALUE = 'qohidden7';

async function search(h: BackendServerHandle, q: string): Promise<Array<{ productId: string; matchedOn?: string[] }>> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/quick-order/search?q=${encodeURIComponent(q)}`,
    cookies: COOKIE,
  });
  return (res.json() as { data: Array<{ productId: string; matchedOn?: string[] }> }).data;
}

describe('Quick-order quick search', () => {
  let h: BackendServerHandle;
  let productId: string;
  let sku: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    // A quick_searchable attribute + a plain (non-flagged) attribute.
    em.create(ProductAttribute, {
      key: 'qo_flag_attr',
      label: { 'en-US': 'QO Flagged' },
      labelDefault: 'QO Flagged',
      valueType: 'string',
      quickSearchable: true,
    });
    em.create(ProductAttribute, {
      key: 'qo_plain_attr',
      label: { 'en-US': 'QO Plain' },
      labelDefault: 'QO Plain',
      valueType: 'string',
    });
    await em.flush();

    const product = await em.findOne(Product, { status: 'active' });
    productId = product!.id;
    sku = product!.sku;
    product!.attributeValues = {
      ...product!.attributeValues,
      qo_flag_attr: FLAGGED_VALUE,
      qo_plain_attr: PLAIN_VALUE,
    };
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('matches by SKU', async () => {
    const results = await search(h, sku);
    const hit = results.find((r) => r.productId === productId);
    expect(hit).toBeTruthy();
    expect(hit?.matchedOn).toContain('sku');
  });

  it('matches by a quick_searchable attribute value', async () => {
    const results = await search(h, FLAGGED_VALUE);
    const hit = results.find((r) => r.productId === productId);
    expect(hit).toBeTruthy();
    expect(hit?.matchedOn).toContain('attribute');
  });

  it('does NOT match a value found only in a non-flagged attribute', async () => {
    const results = await search(h, PLAIN_VALUE);
    expect(results.find((r) => r.productId === productId)).toBeUndefined();
  });

  it('requires an authenticated session', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/quick-order/search?q=${sku}` });
    expect(res.statusCode).toBe(401);
  });
});
