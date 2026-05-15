import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 — T022. Integration test for the US1 translate-language-scoped
 * flow: seed a product with per-language name JSONB, write a new EN name
 * through the existing PATCH product endpoint, then re-fetch with
 * `languageCode=en-US` and assert the resolved value picked up the change
 * without disturbing the PL slot.
 *
 * US1 only exercises the language dimension; channelId is left null so
 * the resolver returns `'global+language'` for both locales.
 */
describe('US1 — translate language-scoped Name', () => {
  let h: BackendServerHandle;
  let productId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `TRANSL-${Date.now()}`,
        type: 'simple',
        name: { 'pl-PL': 'Wiertarka', 'en-US': 'Drill' },
        description: { 'pl-PL': 'Opis', 'en-US': 'Description' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode).toBe(201);
    productId = (created.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('PATCH product name { en-US: <new> } updates only the EN slot in the resolver view', async () => {
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}`,
      payload: {
        name: { 'pl-PL': 'Wiertarka', 'en-US': 'Power drill (EN)' },
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(patched.statusCode).toBe(200);

    const en = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}?languageCode=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(en.statusCode).toBe(200);
    const enBody = en.json() as { data: { resolved?: { name: unknown; sources: Record<string, string> } } };
    expect(enBody.data.resolved!.name).toBe('Power drill (EN)');
    expect(enBody.data.resolved!.sources['name']).toBe('global+language');

    const pl = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}?languageCode=pl-PL`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(pl.statusCode).toBe(200);
    const plBody = pl.json() as { data: { resolved?: { name: unknown } } };
    expect(plBody.data.resolved!.name).toBe('Wiertarka');
  });

  it('languageCode requesting a missing baseline locale falls back to the primary admin language', async () => {
    // A fresh PATCH that writes only the en-US slot drops the pl-PL key —
    // verify the resolver then returns the EN string when languageCode=pl-PL
    // is requested (primary admin language fallback, source=global).
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}`,
      payload: {
        name: { 'en-US': 'Only English (EN)' },
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(patched.statusCode).toBe(200);

    const pl = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}?languageCode=pl-PL`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(pl.statusCode).toBe(200);
    const body = pl.json() as { data: { resolved?: { name: unknown; sources: Record<string, string> } } };
    expect(body.data.resolved!.name).toBe('Only English (EN)');
    expect(body.data.resolved!.sources['name']).toBe('global');
  });
});
