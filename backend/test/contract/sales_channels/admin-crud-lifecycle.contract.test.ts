import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T029-T033 — Admin HTTP contract for the Sales Channels module.
 *
 * Bundles the list / detail / create / update / lifecycle / validation
 * paths into one file because the underlying surface is small and one
 * `setupBackendServer()` per test file pays a real cost.
 *
 * Test-server seeds languages `en-US`, `pl-PL` and currencies `PLN`,
 * `EUR`. The DefaultChannelReconciler runs at boot and inserts a
 * `default` channel using `en-US` / `PLN` (test override).
 */
describe('admin sales-channels CRUD + lifecycle (T029-T033)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Drop any non-default channel created by prior tests so each case starts
    // from a known state. The `default` row is system-protected and never
    // removed; the cascade clears bridge rows automatically.
    const em = h.em();
    for (const c of await em.find(SalesChannel, { systemDefault: false })) {
      em.remove(c);
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  // -- T029: list + detail --------------------------------------------------

  it('GET /admin/sales-channels lists at least the default channel', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { items: Array<{ code: string; systemDefault: boolean }> };
    const def = body.items.find((c) => c.code === 'default');
    expect(def).toBeDefined();
    expect(def?.systemDefault).toBe(true);
  });

  it('GET /admin/sales-channels accepts pageSize=200 (SalesChannelPicker uses it)', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels?pageSize=200&activeOnly=false',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
  });

  it('GET /admin/sales-channels/{code} returns full detail with ETag', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels/default',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers.etag).toBeDefined();
    expect(r.headers.etag).toMatch(/^W\/"[0-9a-f-]+:\d+"$/);
    const body = r.json() as Record<string, unknown>;
    expect(body['code']).toBe('default');
    expect(body['languages']).toContain('en-US');
    expect(body['currencies']).toContain('PLN');
  });

  it('GET /admin/sales-channels/{unknown} returns 404 NOT_FOUND', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels/does-not-exist',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  // -- T030: create + edit --------------------------------------------------

  it('POST /admin/sales-channels creates a new channel with all identity fields', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-a',
        name: { 'en-US': 'Serwis A' },
        languages: ['en-US', 'pl-PL'],
        defaultLanguage: 'en-US',
        currencies: ['EUR', 'PLN'],
        defaultCurrency: 'PLN',
        themeCode: 'storefront-a',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as Record<string, unknown>;
    expect(body['code']).toBe('serwis-a');
    expect(body['systemDefault']).toBe(false);
    expect(body['active']).toBe(true);
    expect(body['version']).toBe(1);
    expect(r.headers.etag).toMatch(/^W\/".+:1"$/);
  });

  it('POST refuses defaultLanguage that is not in languages → VALIDATION_FAILED', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-bad',
        name: { 'en-US': 'Bad' },
        languages: ['en-US'],
        defaultLanguage: 'pl-PL', // not in languages
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  // Feature 017 — language/currency codes are validated against the central
  // dictionary, so an unknown code is rejected with 409 DICTIONARY_ENTRY_NOT_FOUND
  // (the dictionary validator's uniform error) rather than the legacy
  // 422 UNKNOWN_LANGUAGE_CODE / UNKNOWN_CURRENCY_CODE.
  it('POST refuses unknown language code → DICTIONARY_ENTRY_NOT_FOUND', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-bad-lang',
        name: { 'en-US': 'Bad' },
        languages: ['xx-XX'],
        defaultLanguage: 'xx-XX',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
    );
  });

  it('POST refuses unknown currency code → DICTIONARY_ENTRY_NOT_FOUND', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-bad-cur',
        name: { 'en-US': 'Bad' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['XYZ'],
        defaultCurrency: 'XYZ',
      },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
    );
  });

  it('POST refuses duplicate code → DUPLICATE_SALES_CHANNEL_CODE', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-dup',
        name: { 'en-US': 'Dup' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-dup',
        name: { 'en-US': 'Dup 2' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.DUPLICATE_SALES_CHANNEL_CODE,
    );
  });

  it('PATCH updates identity, bumps version, and returns new ETag', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-edit',
        name: { 'en-US': 'Original' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    const r = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/sales-channels/serwis-edit',
      cookies: adminCookie,
      payload: {
        expectedVersion: 1,
        name: { 'en-US': 'Renamed' },
        themeCode: 'new-theme',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect((body['name'] as Record<string, string>)['en-US']).toBe('Renamed');
    expect(body['themeCode']).toBe('new-theme');
    expect(body['version']).toBe(2);
    expect(r.headers.etag).toMatch(/^W\/".+:2"$/);
  });

  // -- T032: optimistic concurrency ----------------------------------------

  it('PATCH with stale expectedVersion → 412 STALE_SALES_CHANNEL_WRITE', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-stale',
        name: { 'en-US': 'Stale' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    // First successful PATCH bumps version 1 → 2.
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/sales-channels/serwis-stale',
      cookies: adminCookie,
      payload: { expectedVersion: 1, name: { 'en-US': 'Renamed' } },
    });
    // Second PATCH with stale expectedVersion=1 must refuse.
    const r = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/sales-channels/serwis-stale',
      cookies: adminCookie,
      payload: { expectedVersion: 1, name: { 'en-US': 'Renamed Again' } },
    });
    expect(r.statusCode).toBe(412);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.STALE_SALES_CHANNEL_WRITE,
    );
  });

  it('PATCH version increments by exactly 1 on every success', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-vbump',
        name: { 'en-US': 'V' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    for (let i = 1; i <= 3; i++) {
      const r = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/sales-channels/serwis-vbump',
        cookies: adminCookie,
        payload: { expectedVersion: i, themeCode: `theme-${i}` },
      });
      expect(r.statusCode).toBe(200);
      expect((r.json() as { version: number }).version).toBe(i + 1);
    }
  });

  // -- T031: deactivate / activate / delete --------------------------------

  it('POST /:code/deactivate then /activate is idempotent', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-life',
        name: { 'en-US': 'L' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });

    let r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels/serwis-life/deactivate',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { active: boolean }).active).toBe(false);

    // Deactivating again is idempotent.
    r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels/serwis-life/deactivate',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);

    r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels/serwis-life/activate',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { active: boolean }).active).toBe(true);
  });

  it('DELETE refuses the system-default channel → CANNOT_MODIFY_SYSTEM_DEFAULT', async () => {
    const r = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/sales-channels/default',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
    );
  });

  it('POST /default/deactivate → CANNOT_MODIFY_SYSTEM_DEFAULT', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels/default/deactivate',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(422);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
    );
  });

  it('DELETE empty channel succeeds with 204', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'serwis-empty',
        name: { 'en-US': 'E' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    const r = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/sales-channels/serwis-empty',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(204);
    const detail = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels/serwis-empty',
      cookies: adminCookie,
    });
    expect(detail.statusCode).toBe(404);
  });

  // -- Auth gate ------------------------------------------------------------

  it('GET without admin cookie → 401 UNAUTHORIZED', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels',
    });
    expect(r.statusCode).toBe(401);
  });
});
