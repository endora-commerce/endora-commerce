import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 — T021. Contract test for the modified
 * `GET /api/v1/admin/catalog/products/:id?languageCode=…` endpoint.
 *
 * Asserts the `resolved` block surfaces `name` / `description` as scalars
 * picked per the language context, with the documented primary-language
 * fallback when the requested language is missing on the baseline.
 *
 * Channel context (`channelId`) is exercised by US2 contract tests — this
 * test deliberately only varies `languageCode` so the US1 slice can ship
 * independently.
 */
describe('GET /api/v1/admin/catalog/products/:id?languageCode (resolver)', () => {
  let h: BackendServerHandle;
  let productId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `RESOLVED-${Date.now()}`,
        type: 'simple',
        name: { 'en-US': 'Resolved EN', 'pl-PL': 'Resolved PL' },
        description: { 'en-US': 'Description EN', 'pl-PL': 'Opis PL' },
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

  it('languageCode=en-US returns the EN scalar for name + description', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}?languageCode=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        resolved?: {
          context: { channelId: string | null; languageCode: string | null };
          name: unknown;
          description: unknown;
          attributeValues: Record<string, unknown>;
          sources: Record<string, string>;
        };
      };
    };
    expect(body.data.resolved).toBeDefined();
    expect(body.data.resolved!.context).toEqual({ channelId: null, languageCode: 'en-US' });
    expect(body.data.resolved!.name).toBe('Resolved EN');
    expect(body.data.resolved!.description).toBe('Description EN');
    // Source SHOULD be 'global+language' since the EN slot exists on baseline.
    expect(body.data.resolved!.sources['name']).toBe('global+language');
    expect(body.data.resolved!.sources['description']).toBe('global+language');
  });

  it('languageCode=pl-PL returns the PL scalar for name + description', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}?languageCode=pl-PL`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { resolved?: { name: unknown; description: unknown; sources: Record<string, string> } };
    };
    expect(body.data.resolved).toBeDefined();
    expect(body.data.resolved!.name).toBe('Resolved PL');
    expect(body.data.resolved!.description).toBe('Opis PL');
    expect(body.data.resolved!.sources['name']).toBe('global+language');
  });

  it('languageCode=de-DE falls back to the primary admin language (en-US) and reports source=global', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}?languageCode=de-DE`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { resolved?: { name: unknown; description: unknown; sources: Record<string, string> } };
    };
    expect(body.data.resolved).toBeDefined();
    expect(body.data.resolved!.name).toBe('Resolved EN');
    expect(body.data.resolved!.description).toBe('Description EN');
    expect(body.data.resolved!.sources['name']).toBe('global');
  });

  it('omitting both query params keeps the legacy response shape (no resolved block)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data).toBeDefined();
    expect(body.data['resolved']).toBeUndefined();
    expect(body.data['name']).toEqual({ 'en-US': 'Resolved EN', 'pl-PL': 'Resolved PL' });
  });
});
