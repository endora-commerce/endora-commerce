import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  customerAddressBookSchema,
  customerDefaultsSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';

/**
 * `specs/173-b2c-address-book-merge/` release 1 — the personal address book is
 * retired for everyone (OD-3), and a B2C customer's one book is their personal
 * Organization's (OD-1).
 *
 *  - **T-C1** every former personal-book endpoint answers
 *    `410 CUSTOMER_ADDRESS_BOOK_RETIRED`, with the sentence in the request's
 *    language (OD-5, OD-8, FR-005);
 *  - **T-C2** `GET /me/customer/defaults` reports the Organization book's
 *    defaults; a `PUT` carrying an address field answers as T-C1, and one
 *    carrying only method fields still works (FR-010);
 *  - **T-C3** the admin card reads `{ organization, personal }`, where
 *    `personal` holds only the rows the retirement job refused (OD-6, FR-012);
 *  - **T-C4** a personal Organization's member creates, updates and deletes on
 *    `/organizations/mine/addresses` with no new permission (OD-4, FR-011).
 *
 * The customer is registered through the storefront's own sign-up, so the
 * account stands in a real personal Organization (D-178).
 */
describe('personal address book retired; the Organization book is the one book (spec 173)', () => {
  let h: BackendServerHandle;
  let cookie: string;
  let customerId: string;
  let organizationId: string;

  function cookieFromResponse(setCookie: string | string[] | undefined): string {
    const raw = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    const m = raw.match(/b2b_session=([^;]+)/);
    if (!m) throw new Error(`no b2b_session cookie in: ${raw}`);
    return decodeURIComponent(m[1]!);
  }

  const ADDRESS = {
    kind: 'delivery',
    recipientName: 'Anna Nowak',
    street: 'ul. Długa 5',
    city: 'Gdańsk',
    postalCode: '80-001',
    country: 'PL',
  } as const;

  const SOME_ID = '00000000-0000-4000-8000-00000000c0de';

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
        email: `spec173-${Date.now()}@example.test`,
        password: 'a-very-strong-pass',
        firstName: 'Anna',
        lastName: 'Nowak',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(reg.statusCode, reg.body).toBe(201);
    cookie = cookieFromResponse(reg.headers['set-cookie']);
    const me = await h.app.inject({ method: 'GET', url: '/api/v1/me/customer', cookies: { b2b_session: cookie } });
    const profile = (me.json() as { data: { id: string; organizationId: string } }).data;
    customerId = profile.id;
    organizationId = profile.organizationId;
  });

  afterAll(async () => {
    // Leave the seeded admin on the platform default for the next file.
    await setAdminLanguage(null);
    await teardownBackendServer(h);
  });

  type Probe = {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    payload?: Record<string, unknown>;
    admin?: boolean;
  };
  const FORMER: Probe[] = [
    { method: 'GET', url: '/api/v1/me/customer/addresses' },
    { method: 'POST', url: '/api/v1/me/customer/addresses', payload: ADDRESS },
    { method: 'PATCH', url: `/api/v1/me/customer/addresses/${SOME_ID}`, payload: { city: 'Sopot' } },
    { method: 'DELETE', url: `/api/v1/me/customer/addresses/${SOME_ID}` },
    { method: 'PUT', url: `/api/v1/me/customer/addresses/${SOME_ID}/default` },
    // An id that is not a UUID is no exception: the book is gone, whatever the id.
    { method: 'DELETE', url: '/api/v1/me/customer/addresses/not-a-uuid' },
    { method: 'PUT', url: '/api/v1/me/customer/defaults', payload: { billingAddressId: SOME_ID } },
    { method: 'PUT', url: '/api/v1/me/customer/defaults', payload: { shippingAddressId: null } },
    { method: 'POST', url: 'ADMIN', payload: ADDRESS, admin: true },
  ];

  /**
   * An admin reads errors in their own preferred language, not the request's
   * `Accept-Language` (`_i18n/error-envelope-translation.contract.test.ts`).
   */
  async function setAdminLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { preferredLanguage: language },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function send(probe: Probe, language: 'en' | 'pl') {
    const url = probe.url === 'ADMIN' ? `/api/v1/admin/customers/${customerId}/addresses` : probe.url;
    if (probe.admin) await setAdminLanguage(language);
    return h.app.inject({
      method: probe.method,
      url,
      cookies: { b2b_session: probe.admin ? 'stub-admin-session' : cookie },
      headers: { 'accept-language': language },
      ...(probe.payload !== undefined ? { payload: probe.payload } : {}),
    });
  }

  describe('T-C1 — every former personal-book endpoint answers 410 CUSTOMER_ADDRESS_BOOK_RETIRED', () => {
    it.each(FORMER.map((p) => [`${p.method} ${p.url} ${JSON.stringify(p.payload ?? {})}`, p] as const))(
      '%s',
      async (_name, probe) => {
        const sentences: Record<string, string> = {};
        for (const language of ['en', 'pl'] as const) {
          const res = await send(probe, language);
          expect(res.statusCode, res.body).toBe(410);
          const body = res.json() as { error: { code: string; message: string } };
          expect(body.error.code).toBe('CUSTOMER_ADDRESS_BOOK_RETIRED');
          sentences[language] = body.error.message;
        }
        expect(sentences['en']).toMatch(/organization/i);
        expect(sentences['pl']).toMatch(/organizacji/i);
        expect(sentences['pl']).not.toBe(sentences['en']);
      },
    );
  });

  describe('T-C4 — a personal Organization member writes the Organization book', () => {
    it('creates (201), updates (200) and deletes (204)', async () => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/mine/addresses',
        cookies: { b2b_session: cookie },
        payload: { ...ADDRESS, recipientName: 'Temporary' },
      });
      expect(created.statusCode, created.body).toBe(201);
      const createdData = (created.json() as { data: { id: string; organizationId: string } }).data;
      expect(createdData.organizationId).toBe(organizationId);

      const patched = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/addresses/${createdData.id}`,
        cookies: { b2b_session: cookie },
        payload: { city: 'Sopot' },
      });
      expect(patched.statusCode, patched.body).toBe(200);
      expect((patched.json() as { data: { city: string } }).data.city).toBe('Sopot');

      const deleted = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/mine/addresses/${createdData.id}`,
        cookies: { b2b_session: cookie },
      });
      expect(deleted.statusCode, deleted.body).toBe(204);
    });
  });

  describe('T-C2 — the defaults are the Organization book’s', () => {
    it('GET reports the Organization defaults of each kind', async () => {
      const ids: Record<string, string> = {};
      for (const kind of ['delivery', 'billing'] as const) {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/organizations/mine/addresses',
          cookies: { b2b_session: cookie },
          payload: { ...ADDRESS, kind, isDefault: true },
        });
        expect(res.statusCode, res.body).toBe(201);
        ids[kind] = (res.json() as { data: { id: string } }).data.id;
      }
      const get = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/customer/defaults',
        cookies: { b2b_session: cookie },
      });
      expect(get.statusCode, get.body).toBe(200);
      const data = (get.json() as { data: unknown }).data;
      expect(disagreements(deepStrict(customerDefaultsSchema), data)).toEqual([]);
      expect(data).toMatchObject({ shippingAddressId: ids['delivery'], billingAddressId: ids['billing'] });
    });

    it('a PUT carrying only method fields still works', async () => {
      const put = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/me/customer/defaults',
        cookies: { b2b_session: cookie },
        payload: { paymentMethodId: null, deliveryMethodId: null },
      });
      expect(put.statusCode, put.body).toBe(200);
      expect((put.json() as { data: { paymentMethodId: string | null } }).data.paymentMethodId).toBeNull();
    });
  });

  describe('T-C3 — the admin card lists the Organization book and the refused rows', () => {
    it('answers { organization, personal } with only the refused rows under personal', async () => {
      const connection = h.em().fork().getConnection();
      const insert = (recipient: string, mergeRefusal: string | null, deleted: boolean) =>
        connection.execute(
          `insert into "customer_addresses"
             ("id", "customer_account_id", "kind", "recipient_name", "street", "city", "postal_code",
              "country", "phone", "is_default", "created_at", "updated_at", "deleted_at", "merge_refusal")
           values (gen_random_uuid(), ?, 'delivery', ?, 'ul. Stara 1', 'Gdańsk', '80-001', 'YU', null,
                   false, now(), now(), ?, ?)`,
          [customerId, recipient, deleted ? new Date() : null, mergeRefusal],
        );
      await insert('Refused Row', 'DICTIONARY_ENTRY_INACTIVE', false);
      await insert('Moved Row', null, true);
      await insert('Waiting Row', null, false);

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers/${customerId}/addresses`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = (res.json() as { data: unknown }).data;
      expect(disagreements(deepStrict(customerAddressBookSchema), data)).toEqual([]);
      const book = data as {
        organization: Array<{ organizationId: string }>;
        personal: Array<{ recipientName: string; mergeRefusal?: string | null }>;
      };
      expect(book.organization.length).toBeGreaterThan(0);
      expect(book.organization.every((a) => a.organizationId === organizationId)).toBe(true);
      expect(book.personal.map((p) => [p.recipientName, p.mergeRefusal])).toEqual([
        ['Refused Row', 'DICTIONARY_ENTRY_INACTIVE'],
      ]);
    });
  });
});
