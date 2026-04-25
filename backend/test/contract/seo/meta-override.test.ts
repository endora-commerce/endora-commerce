import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';

/**
 * T235 — admin can read the resolved meta for a product (rule-derived by
 * default), set an override, and watch `source` flip to `'override'`. The
 * resolver also accepts a per-locale override and falls back to the rule
 * for any field the override leaves null.
 */

describe('Admin SEO meta override', () => {
  let h: BackendServerHandle;
  let productId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const product = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    productId = product.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns rule-derived meta when no override exists', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/seo/meta/product/${productId}?locale=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        resolved: { title: string; source: string; locale: string };
        override: unknown;
      };
    };
    expect(body.data.resolved.source).toBe('rule');
    expect(body.data.resolved.locale).toBe('en-US');
    expect(body.data.resolved.title.length).toBeGreaterThan(0);
    expect(body.data.override).toBeNull();
  });

  it('upserts an override and the resolver flips to source=override', async () => {
    const putRes = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/seo/meta/product/${productId}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        locale: 'en-US',
        title: 'Hand-tuned title',
        description: 'Hand-tuned description.',
      },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/seo/meta/product/${productId}?locale=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = getRes.json() as {
      data: {
        resolved: {
          title: string;
          description: string;
          openGraph: { title: string };
          source: string;
        };
        override: { title: string };
      };
    };
    expect(body.data.resolved.source).toBe('override');
    expect(body.data.resolved.title).toBe('Hand-tuned title');
    expect(body.data.resolved.description).toBe('Hand-tuned description.');
    // OG title was not overridden, so falls back to the rule (product name).
    expect(body.data.resolved.openGraph.title).not.toBe('Hand-tuned title');
    expect(body.data.override.title).toBe('Hand-tuned title');
  });

  it('returns 404 when entity does not exist', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/seo/meta/product/00000000-0000-4000-8000-000000000000?locale=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
  });
});
