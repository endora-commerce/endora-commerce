import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T053 — Journey: an anonymous visitor searches the catalog, applies a filter,
 * lands on a category, and opens a PDP — every response must be usable by a
 * crawler (R-14), carry the JSON-LD block (FR-103), and include its Sales
 * Channel-appropriate price field.
 */

interface ProductSummary {
  id: string;
  slug: string;
  price: { amount: number; currency: string } | null;
}
interface ProductDetail extends ProductSummary {
  structuredDataJsonLd: Record<string, unknown>;
  seo: { metaTitle: string; metaDescription: string };
}

describe('catalog browse journey', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('search → filter → PDP returns SEO-ready payloads on a public channel', async () => {
    // 1. Search
    const search = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?q=example',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json() as { data: ProductSummary[] };
    expect(searchBody.data.length).toBeGreaterThan(0);

    // 2. Filter by a filterable attribute
    const filtered = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?filter%5Battr.color%5D=red',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(filtered.statusCode).toBe(200);

    // 3. PDP for the first hit
    const pick = searchBody.data[0];
    expect(pick).toBeDefined();
    const pdp = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${pick!.slug}`,
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(pdp.statusCode).toBe(200);
    const pdpBody = pdp.json() as { data: ProductDetail };
    expect(pdpBody.data.structuredDataJsonLd).toBeDefined();
    expect(pdpBody.data.seo.metaTitle).toMatch(/.+/);
    expect(pdpBody.data.price?.amount).toBeTypeOf('number');
  });
});
