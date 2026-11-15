import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  customerSelfProfileSchema,
  patchCustomerPreferredLanguageResponseSchema,
} from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Issue #652 (D-292) — the buyer's e-mail language on the self-service surface.
 *
 * `PATCH /api/v1/me/customer/preferred-language` is the only write that
 * overwrites a stored value. It accepts a language the request's sales channel
 * offers, matched case-insensitively and stored as the channel spells it, and
 * refuses any other with `422 PREFERRED_LANGUAGE_NOT_OFFERED`. Both reads the
 * account page is built from — `GET /api/v1/me` and `GET /api/v1/me/customer`
 * — answer the stored value.
 *
 * The buyer is this file's own: a B2C account registered on this file's own
 * channel, so every write lands on a row nothing else reads.
 */
const PASSWORD = 'a-very-strong-pass-652';
const URL = '/api/v1/me/customer/preferred-language';

describe('customer preferred language — self-service (#652)', () => {
  let h: BackendServerHandle;
  let channelCode: string;
  let session: string;
  let accountId: string;

  const headers = (acceptLanguage = 'en-US') => ({ 'x-sales-channel': channelCode, 'accept-language': acceptLanguage });
  const asBuyer = () => ({ b2b_session: session });

  function cookieFrom(setCookie: string | string[] | undefined): string {
    const raw = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    const match = raw.match(/b2b_session=([^;]+)/);
    if (!match) throw new Error(`no b2b_session cookie in: ${raw}`);
    return decodeURIComponent(match[1]!);
  }

  async function stored(): Promise<string | null> {
    const em = h.em();
    em.clear();
    return (await em.findOneOrFail(CustomerAccount, { id: accountId })).preferredLanguage ?? null;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    channelCode = `pl652-${randomUUID().slice(0, 8)}`;
    const em = h.em();
    em.create(SalesChannel, {
      code: channelCode,
      name: { 'en-US': channelCode },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      anonymousAccess: true,
    });
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
    await h.settings.adminService.setValueForAllChannels(
      'customers.allow_registration_without_organization',
      true,
      null,
      { actorAdminUserId: null },
    );

    const email = `pl652-self-${randomUUID().slice(0, 8)}@example.test`;
    const registered = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      headers: headers('en-US,en;q=0.9'),
      payload: { email, password: PASSWORD, firstName: 'Self', lastName: 'Language', acceptedTermsVersion: 'v1' },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    session = cookieFrom(registered.headers['set-cookie']);
    accountId = (registered.json() as { data: { customerAccount: { id: string } } }).data.customerAccount.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET /api/v1/me/customer and GET /api/v1/me answer the language captured at registration', async () => {
    const profile = await h.app.inject({ method: 'GET', url: '/api/v1/me/customer', headers: headers(), cookies: asBuyer() });
    expect(profile.statusCode, profile.body).toBe(200);
    expect(customerSelfProfileSchema.parse((profile.json() as { data: unknown }).data).preferredLanguage).toBe('en-US');

    const me = await h.app.inject({ method: 'GET', url: '/api/v1/me', headers: headers(), cookies: asBuyer() });
    expect(me.statusCode, me.body).toBe(200);
    expect((me.json() as { data: { customerAccount: { preferredLanguage: string | null } } }).data.customerAccount.preferredLanguage).toBe(
      'en-US',
    );
  });

  it('stores an offered language in the channel spelling and audits names only', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: URL,
      headers: headers(),
      cookies: asBuyer(),
      payload: { preferredLanguage: ' PL-pl ' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(patchCustomerPreferredLanguageResponseSchema.parse(res.json()).data).toEqual({ preferredLanguage: 'pl-PL' });
    expect(await stored()).toBe('pl-PL');

    const entries = await h.em().find(AuditLogEntry, {
      action: 'customer_account.set_preferred_language',
      objectId: accountId,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.stateBefore ?? null).toBeNull();
    expect(entries[0]!.stateAfter).toEqual({ changedFields: ['preferredLanguage'], source: 'self_service' });
    expect(entries[0]!.actorCustomerAccountId).toBe(accountId);
  });

  it('refuses a language the channel does not offer with 422, in the request language, and keeps the value', async () => {
    for (const [acceptLanguage, message] of [
      ['en-US', 'This store does not offer that language.'],
      ['pl-PL', 'Ten sklep nie oferuje tego języka.'],
    ] as const) {
      const res = await h.app.inject({
        method: 'PATCH',
        url: URL,
        headers: headers(acceptLanguage),
        cookies: asBuyer(),
        payload: { preferredLanguage: 'de-DE' },
      });
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe(ERROR_CODES.PREFERRED_LANGUAGE_NOT_OFFERED);
      // The header decides the answer's language, not the stored preference (D-131).
      expect(body.error.message).toBe(message);
    }
    expect(await stored()).toBe('pl-PL');
  });

  it('refuses a body that is not a language tag', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: URL,
      headers: headers(),
      cookies: asBuyer(),
      payload: { preferredLanguage: null },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it('requires a customer session', async () => {
    const res = await h.app.inject({ method: 'PATCH', url: URL, headers: headers(), payload: { preferredLanguage: 'en-US' } });
    expect(res.statusCode, res.body).toBe(401);
  });

  it('answers MODULE_DISABLED while customers is off, and works again once restored', async () => {
    await withModuleOff('customers', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: URL,
        headers: headers(),
        cookies: asBuyer(),
        payload: { preferredLanguage: 'en-US' },
      });
      expect(res.statusCode, res.body).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
    });
    expect(await stored()).toBe('pl-PL');
    const restored = await h.app.inject({
      method: 'PATCH',
      url: URL,
      headers: headers(),
      cookies: asBuyer(),
      payload: { preferredLanguage: 'en-us' },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(await stored()).toBe('en-US');
  });
});
