import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../src/modules/customers/manifest.js';

/**
 * Feature 040, US2 — contract test for the self-service address book and
 * default payment/delivery/address preferences. Uses a freshly-registered
 * org-less customer so the personal-address eligibility path (R5/T034) is
 * exercised end-to-end.
 */
describe('Customer address book + defaults (US2)', () => {
  let h: BackendServerHandle;
  let cookie: string;

  function cookieFromResponse(setCookie: string | string[] | undefined): string {
    const raw = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    const m = raw.match(/b2b_session=([^;]+)/);
    if (!m) throw new Error(`no b2b_session cookie in: ${raw}`);
    return decodeURIComponent(m[1]!);
  }

  const addr = (over: Partial<Record<string, unknown>> = {}) => ({
    kind: 'delivery',
    recipientName: 'Jan Kowalski',
    street: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
    ...over,
  });

  beforeAll(async () => {
    h = await setupBackendServer();
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: true },
    });
    const reg = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: `us2-${Date.now()}@example.test`,
        password: 'a-very-strong-pass',
        firstName: 'Us',
        lastName: 'Two',
        acceptedTermsVersion: 'v1',
      },
    });
    cookie = cookieFromResponse(reg.headers['set-cookie']);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates addresses, enforces one default per kind, and lists them', async () => {
    const a = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/customer/addresses',
      cookies: { b2b_session: cookie },
      payload: addr({ isDefault: true }),
    });
    expect(a.statusCode).toBe(201);
    const b = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/customer/addresses',
      cookies: { b2b_session: cookie },
      payload: addr({ isDefault: true }),
    });
    expect(b.statusCode).toBe(201);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer/addresses',
      cookies: { b2b_session: cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: { personal: Array<{ id: string; isDefault: boolean }>; organization: unknown[] };
    };
    expect(body.data.personal).toHaveLength(2);
    expect(body.data.personal.filter((x) => x.isDefault)).toHaveLength(1);
    // Org-less customer → no shared org addresses.
    expect(body.data.organization).toEqual([]);
  });

  it('sets a personal address as a default preference (eligibility honors personal addresses)', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/customer/addresses',
      cookies: { b2b_session: cookie },
      payload: addr({ kind: 'billing' }),
    });
    const addressId = (created.json() as { data: { id: string } }).data.id;

    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/me/customer/defaults',
      cookies: { b2b_session: cookie },
      payload: { billingAddressId: addressId },
    });
    expect(put.statusCode).toBe(200);

    const get = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer/defaults',
      cookies: { b2b_session: cookie },
    });
    expect(get.statusCode).toBe(200);
    // The personal billing address resolves as eligible (R5/T034), not dropped.
    expect((get.json() as { data: { billingAddressId: string | null } }).data.billingAddressId).toBe(addressId);
  });

  it('deletes an address (204) and removes it from the list', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/customer/addresses',
      cookies: { b2b_session: cookie },
      payload: addr({ kind: 'billing' }),
    });
    const id = (created.json() as { data: { id: string } }).data.id;
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/me/customer/addresses/${id}`,
      cookies: { b2b_session: cookie },
    });
    expect(del.statusCode).toBe(204);
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer/addresses',
      cookies: { b2b_session: cookie },
    });
    const ids = (list.json() as { data: { personal: Array<{ id: string }> } }).data.personal.map((x) => x.id);
    expect(ids).not.toContain(id);
  });
});
