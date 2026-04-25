import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';

/**
 * T235 — public sitemap.xml is generated from active, public-visibility
 * products + non-deleted categories. The cache row is overwritten on
 * `regenerate`, and the public route falls through to a fresh build when
 * the cache is empty or stale.
 */

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
    product.status = 'archived';
    await em.flush();

    // Force a fresh build — the test fixture pins staleAfterMs=0.
    const regenRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/seo/sitemap/regenerate',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(regenRes.statusCode).toBe(200);

    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/sitemap.xml' });
    expect(res.body).not.toContain(`/p/${product.slug}`);

    // Restore for downstream tests.
    product.status = 'active';
    await em.flush();
  });

  it('regenerate endpoint returns the new metadata', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/seo/sitemap/regenerate',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { generatedAt: string; urlCount: number; byteSize: number };
    };
    expect(body.data.urlCount).toBeGreaterThan(0);
    expect(body.data.byteSize).toBeGreaterThan(0);
    expect(new Date(body.data.generatedAt).getTime()).toBeGreaterThan(0);
  });
});
