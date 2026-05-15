import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 — `GET /admin/catalog/products/:id/scope-context`.
 *
 * Asserts the response carries the per-product Sales Channel list with
 * each channel's language array, the union of languages, the platform
 * primary admin language, and a (possibly null) editor preference.
 *
 * The test creates a fresh product (with no explicit channel
 * assignments, so the SalesChannelMembership default reconciler binds
 * it to the system-default channel) and reads its scope context.
 */
describe('GET /api/v1/admin/catalog/products/:id/scope-context', () => {
  let h: BackendServerHandle;
  let productId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `SCOPE-CTX-${Date.now()}`,
        type: 'simple',
        name: { 'en-US': 'Scope context probe' },
        description: { 'en-US': 'Scope context probe' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { data: { id: string } };
    productId = body.data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns channels, languagesUnion, primaryAdminLanguage, preference=null', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/scope-context`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        productId: string;
        channels: Array<{
          id: string;
          code: string;
          name: string;
          languages: string[];
          isDefault: boolean;
        }>;
        languagesUnion: string[];
        primaryAdminLanguage: string;
        preference: null | { lastChannelId: string | null; lastLanguageCode: string | null };
      };
    };
    expect(body.data.productId).toBe(productId);
    expect(Array.isArray(body.data.channels)).toBe(true);
    expect(body.data.channels.length).toBeGreaterThan(0);
    for (const ch of body.data.channels) {
      expect(typeof ch.id).toBe('string');
      expect(typeof ch.code).toBe('string');
      expect(Array.isArray(ch.languages)).toBe(true);
    }
    expect(Array.isArray(body.data.languagesUnion)).toBe(true);
    expect(body.data.languagesUnion.length).toBeGreaterThan(0);
    expect(typeof body.data.primaryAdminLanguage).toBe('string');
    // First-time read — no preference recorded yet.
    expect(body.data.preference).toBeNull();
  });

  it('returns 404 for an unknown product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/00000000-0000-4000-8000-000000000000/scope-context`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
  });
});
