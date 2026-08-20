import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { createAttributeFixture, SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Feature 039 (US3) — quick search matches SKU, name, and the values of
 * `quick_searchable` attributes only (FR-011 / FR-013).
 *
 * Issue #174 changed the fixture, and the change is the point. The subject was
 * `em.findOne(Product, { status: 'active' })` — whichever active row the
 * database returned first, bound to a sales channel or not — and the request
 * carried no `x-sales-channel`, so it fell back to the install-created default
 * channel, which no test binds a product to. Both worked because the endpoint
 * ignored the channel entirely. It does not any more: the subject is a product
 * this harness binds to `pl_retail`, and the request says which channel it is
 * shopping. See `quick-search-channel-scoping.test.ts` for the property.
 */

const COOKIE = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const FLAGGED_VALUE = 'qomagenta7';
const PLAIN_VALUE = 'qohidden7';

async function search(h: BackendServerHandle, q: string): Promise<Array<{ productId: string; matchedOn?: string[] }>> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/quick-order/search?q=${encodeURIComponent(q)}`,
    headers: CHANNEL,
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
    await createAttributeFixture(em, {
      key: 'qo_flag_attr',
      label: { 'en-US': 'QO Flagged' },
      labelDefault: 'QO Flagged',
      valueType: 'string',
      quickSearchable: true,
    });
    await createAttributeFixture(em, {
      key: 'qo_plain_attr',
      label: { 'en-US': 'QO Plain' },
      labelDefault: 'QO Plain',
      valueType: 'string',
    });

    // A seeded product bound to both `pl_retail` and `pl_b2b_vip`, so the
    // subject is reachable on the channel the requests below name.
    const product = await em.findOne(Product, { id: SEED_PRODUCT_101_ID });
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
