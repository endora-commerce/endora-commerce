import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { oauthBinding } from '../../helpers/oauth-binding.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Issue #773 — a first federated (OAuth) sign-in creates an account only where
 * `customers.allow_registration_without_organization` allows it for the
 * channel the sign-in was **started on**, exactly as `POST
 * /api/v1/customers/register` does. `customer_accounts`' `autoCreate` was
 * handed that channel by `SocialIdentityService` and read the system-default
 * channel's value instead, so enabling the setting on the default channel
 * opened federated sign-up on every store, and enabling it elsewhere had no
 * effect.
 *
 * The setting is off for all channels and on only for `orpc-on`.
 */

const SETTING = 'customers.allow_registration_without_organization';
const ON = 'orpc-on';
const OFF = 'orpc-off';

describe('federated sign-up follows the B2C registration setting per channel (issue #773)', () => {
  let h: BackendServerHandle;
  let settingVersion: string | null = null;

  async function signIn(channelCode: string, email: string) {
    const started = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
      headers: { 'x-sales-channel': channelCode },
    });
    expect(started.statusCode, started.body).toBe(302);
    const state = new URL(started.headers['location'] as string).searchParams.get('state')!;
    // The fake OIDC client reads the code as the verified e-mail.
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(email)}&state=${encodeURIComponent(state)}`,
      cookies: oauthBinding(started),
    });
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
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.google_enabled',
      true,
      null,
      actor,
    );
    const off = await h.settings.adminService.setValueForAllChannels(SETTING, false, null, actor);
    const on = await h.settings.adminService.setValueForSubset(
      SETTING,
      [ON],
      true,
      off.newVersion,
      actor,
    );
    settingVersion = on.newVersion;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates the account on the channel that allows it', async () => {
    const email = `orpc-on-${Date.now()}@example.test`;
    const res = await signIn(ON, email);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location'] ?? '').not.toContain('error=');
    expect(res.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();
    expect(await h.em().findOne(CustomerAccount, { email })).not.toBeNull();
  });

  it('answers registration_disabled_in_channel on the channel that does not, creating no account', async () => {
    const email = `orpc-off-${Date.now()}@example.test`;
    const res = await signIn(OFF, email);
    expect(res.statusCode).toBe(302);
    // The code of this refusal (issue #789), so a refusal for any other reason
    // (a closed store, an unverified address) does not pass for this one.
    expect(res.headers['location']).toContain('/login?error=registration_disabled_in_channel');
    expect(res.cookies.find((c) => c.name === 'b2b_session' && c.value)).toBeUndefined();
    expect(await h.em().findOne(CustomerAccount, { email })).toBeNull();
  });

  /**
   * Last, because it also opens the setting on the default channel: a caller
   * that names no channel gets no account, rather than the system-default
   * channel's answer.
   */
  it('creates no account for a caller that names no channel', async () => {
    const defaultChannel = await h.salesChannels.resolver.getSystemDefault();
    await h.settings.adminService.setValueForSubset(
      SETTING,
      [defaultChannel.code],
      true,
      settingVersion,
      { actorAdminUserId: null },
    );
    const port = (
      h.container.cradle as unknown as {
        customerSocialLoginPort: {
          autoCreate(email: string, context: { salesChannelId: string | null }): Promise<unknown>;
        };
      }
    ).customerSocialLoginPort;
    const email = `orpc-none-${Date.now()}@example.test`;
    expect(await port.autoCreate(email, { salesChannelId: null })).toBeNull();
    expect(await h.em().findOne(CustomerAccount, { email })).toBeNull();
  });
});
