import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';

/**
 * Per-channel sitemap. Public `/api/v1/catalog/sitemap.xml` resolves the
 * channel from `X-Sales-Channel`; admin endpoints take the channel code in
 * the path. Each channel filters by its own membership (sales_channel_*
 * bridge tables) and stamps URLs with its own storefront URL (read from
 * the `sales_channels.storefront_url` setting; tests fall back to the
 * shared baseUrl baked into the seoModule options).
 */

const RETAIL = 'pl_retail';

describe('GET /api/v1/catalog/sitemap.xml', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns valid XML containing the seeded public products + categories', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/sitemap.xml',
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(res.body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    // Seeded category slug "widgets" + at least one seeded product slug.
    expect(res.body).toContain('http://test.local/c/widgets');
    expect(res.body).toMatch(/http:\/\/test\.local\/p\/[a-z0-9-]+/);
    expect(res.body).toContain('</urlset>');
  });

  it('excludes archived products from the public sitemap', async () => {
    const em = h.em();
    const product = await em.findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    product.status = 'inactive';
    await em.flush();

    // Force a fresh build — the test fixture pins staleAfterMs=0.
    const regenRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/seo/sitemap/${RETAIL}/regenerate`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(regenRes.statusCode).toBe(200);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/sitemap.xml',
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(res.body).not.toContain(`/p/${product.slug}`);

    // Restore for downstream tests.
    product.status = 'active';
    await em.flush();
  });

  it('excludes a public product whose allow-list names an organisation (issue #227)', async () => {
    // The filter here read `visibility === 'public'` and stopped, so this row —
    // which an operator can save from the product editor today — had its URL
    // published to every crawler. A sitemap has one audience, the anonymous
    // one, and a non-empty allow-list restricts whatever the visibility column
    // says.
    const em = h.em();
    const product = await em.findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    product.allowedOrganizationIds = ['00000000-0000-4000-8000-0000000000ab'];
    await em.flush();

    const regenRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/seo/sitemap/${RETAIL}/regenerate`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(regenRes.statusCode).toBe(200);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/sitemap.xml',
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(res.body).not.toContain(`/p/${product.slug}`);

    // Restore for downstream tests.
    product.allowedOrganizationIds = [];
    await em.flush();
  });

  it('regenerate endpoint returns the new metadata', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/seo/sitemap/${RETAIL}/regenerate`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        salesChannelCode: string;
        generatedAt: string;
        urlCount: number;
        byteSize: number;
      };
    };
    expect(body.data.salesChannelCode).toBe(RETAIL);
    expect(body.data.urlCount).toBeGreaterThan(0);
    expect(body.data.byteSize).toBeGreaterThan(0);
    expect(new Date(body.data.generatedAt).getTime()).toBeGreaterThan(0);
  });
});
