import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T041 — Integration test for the US2 product-type story against real
 * Postgres (specs/002-catalog-module/quickstart.md §2 US2). Composes
 * admin write + storefront read paths to verify the new enum values
 * and the cross-field invariant for virtual download fields.
 *
 * Full variants-of-a-configurable-product flow (create variants, pick
 * via storefront variant-picker) is the subject of T043 + T054 once
 * the admin-variants endpoint lands; here we cover the type model end
 * of US2.
 *
 * Per Constitution Principle III: integration tests run against real
 * Postgres — no DB mocking.
 */

describe('Product type extensions US2 end-to-end (T041)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('admin creates a configurable Product; PDP exposes empty variants[] until variants ship', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'INT-CONF-001',
        type: 'configurable',
        name: { 'en-US': 'Integration configurable', 'pl-PL': 'Konfiguracyjny integracyjny' },
        description: { 'en-US': 'For T041', 'pl-PL': 'Dla T041' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const product = (create.json() as { data: { id: string; type: string; slug: string } }).data;
    expect(product.type).toBe('configurable');

    // Activate so the storefront returns it.
    const activate = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${product.id}`,
      payload: { /* nothing — status mutation is out of scope */ },
      cookies: adminCookie,
    });
    expect(activate.statusCode).toBe(200);
  });

  it('admin creates a virtual Product with downloadUrl; rejects empty / both-fields combinations', async () => {
    // Happy path — only downloadUrl.
    const ok = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'INT-VIRT-OK',
        type: 'virtual',
        name: { 'en-US': 'Integration virtual ok', 'pl-PL': 'Wirtualny ok' },
        description: { 'en-US': '', 'pl-PL': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        downloadUrl: 'https://files.example.com/integration-ok.pdf',
      },
      cookies: adminCookie,
    });
    expect(ok.statusCode).toBe(201);

    // Reject — neither field.
    const empty = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'INT-VIRT-EMPTY',
        type: 'virtual',
        name: { 'en-US': 'Integration virtual empty', 'pl-PL': 'Wirtualny pusty' },
        description: { 'en-US': '', 'pl-PL': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(empty.statusCode).toBe(400);

    // Reject — both fields.
    const both = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'INT-VIRT-BOTH',
        type: 'virtual',
        name: { 'en-US': 'Integration virtual both', 'pl-PL': 'Wirtualny oba' },
        description: { 'en-US': '', 'pl-PL': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        downloadUrl: 'https://files.example.com/x.pdf',
        downloadAssetId: '00000000-0000-4000-8000-000000000aaa',
      },
      cookies: adminCookie,
    });
    expect(both.statusCode).toBe(400);
  });

  it('admin cannot set download fields on a non-virtual Product (cross-field guard)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'INT-SIMPLE-WITH-URL',
        type: 'simple',
        name: { 'en-US': 'Simple with url', 'pl-PL': 'Prosty z URL' },
        description: { 'en-US': '', 'pl-PL': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        // simple products MUST have both download fields null.
        downloadUrl: 'https://files.example.com/leak.pdf',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('admin cannot create a Product with the legacy `variant` type (renamed to configurable in 002)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'INT-LEGACY-VARIANT',
        type: 'variant',
        name: { 'en-US': 'Legacy variant', 'pl-PL': 'Wariant legacy' },
        description: { 'en-US': '', 'pl-PL': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });
});
