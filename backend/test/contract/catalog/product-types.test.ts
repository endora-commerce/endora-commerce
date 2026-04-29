import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T039 — contract test for the extended Product type enum from feature
 * 002. Foundation 001 used `simple | variant | grouped | virtual`; 002
 * renames `variant → configurable` and adds `bundle`. Virtual products
 * also gain `downloadAssetId | downloadUrl` (exactly-one-of).
 *
 * Per Constitution Principle III: written FIRST, fails for the right
 * reason — productTypeSchema still has the foundation 4-element enum.
 * T044 (migration), T045 (entity union update), T046 (Zod schema) turn
 * these reds green.
 */

describe('Admin Products contract — feature 002 type enum (T039)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  const baseProduct = {
    sku: 'TYPETEST-001',
    name: { 'en-US': 'Type test', 'pl-PL': 'Test typu' },
    description: { 'en-US': 'For T039', 'pl-PL': 'Dla T039' },
    categoryIds: [] as string[],
    attributeValues: {},
    visibility: 'public',
  };

  it('POST accepts type=configurable (rename of legacy `variant`)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: { ...baseProduct, sku: 'TYPETEST-CONFIGURABLE', type: 'configurable' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST accepts type=bundle (new in feature 002)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: { ...baseProduct, sku: 'TYPETEST-BUNDLE', type: 'bundle' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST rejects type=variant (the foundation 001 spelling is gone)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: { ...baseProduct, sku: 'TYPETEST-LEGACY-VARIANT', type: 'variant' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST accepts type=virtual with downloadUrl (and not downloadAssetId)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        ...baseProduct,
        sku: 'TYPETEST-VIRTUAL-URL',
        type: 'virtual',
        downloadUrl: 'https://files.example.com/ebook.pdf',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST rejects type=virtual when both downloadUrl and downloadAssetId are missing', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        ...baseProduct,
        sku: 'TYPETEST-VIRTUAL-EMPTY',
        type: 'virtual',
      },
      cookies: adminCookie,
    });
    // Once T047 lands the cross-field refine, this should be 400.
    // Until then, the contract test documents the EXPECTED behaviour.
    expect(res.statusCode).toBe(400);
  });

  it('POST rejects type=virtual when BOTH downloadUrl AND downloadAssetId are sent', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        ...baseProduct,
        sku: 'TYPETEST-VIRTUAL-BOTH',
        type: 'virtual',
        downloadUrl: 'https://files.example.com/ebook.pdf',
        downloadAssetId: '00000000-0000-4000-8000-000000000aaa',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });
});
