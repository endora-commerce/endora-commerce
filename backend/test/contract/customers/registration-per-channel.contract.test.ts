import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, customerRegistrationOptionsResponseSchema } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Issue #773 — `customers.allow_registration_without_organization` is a
 * per-channel setting, and both its readers follow the request's resolved
 * sales channel (Constitution XII): the public read the storefront renders
 * `/register-customer` from, and the gate `POST /api/v1/customers/register`
 * applies. Until this issue both read the system-default channel's value, so
 * enabling B2C registration on one store had no effect, and enabling it on the
 * default channel enabled it everywhere.
 */

const SETTING = 'customers.allow_registration_without_organization';
const ON = 'rpc-on';
const OFF = 'rpc-off';
const OPTIONS_URL = '/api/v1/storefront/settings/customer-registration';

const body = (email: string) => ({
  email,
  password: 'a-very-strong-pass',
  firstName: 'Stand',
  lastName: 'Alone',
  acceptedTermsVersion: 'v1',
});

describe('B2C registration setting per sales channel (issue #773)', () => {
  let h: BackendServerHandle;

  async function read(channelCode: string | null): Promise<boolean> {
    const res = await h.app.inject({
      method: 'GET',
      url: OPTIONS_URL,
      ...(channelCode ? { headers: { 'x-sales-channel': channelCode } } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    return customerRegistrationOptionsResponseSchema.parse(res.json()).data
      .allowRegistrationWithoutOrganization;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const code of [ON, OFF]) {
      em.create(SalesChannel, {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
        anonymousAccess: true,
      });
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();

    const actor = { actorAdminUserId: null };
    const off = await h.settings.adminService.setValueForAllChannels(SETTING, false, null, actor);
    await h.settings.adminService.setValueForSubset(SETTING, [ON], true, off.newVersion, actor);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers the public read for the request channel, not the default one', async () => {
    expect(await read(ON)).toBe(true);
    expect(await read(OFF)).toBe(false);
    expect(await read(null)).toBe(false);
  });

  it('registers on the channel that allows it', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      headers: { 'x-sales-channel': ON },
      payload: body(`rpc-on-${Date.now()}@example.test`),
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('refuses on the channel that does not, creating no account', async () => {
    const email = `rpc-off-${Date.now()}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      headers: { 'x-sales-channel': OFF },
      payload: body(email),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.REGISTRATION_REQUIRES_ORGANIZATION,
    );
    expect(await h.em().findOne(CustomerAccount, { email })).toBeNull();
  });
});
