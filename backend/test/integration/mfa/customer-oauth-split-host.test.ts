import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  customerOAuthStartUrl,
  exchangeHandoff,
  handoffCodeOf,
  oauthBinding,
  sessionOf,
  storefrontBinding,
  type StorefrontBinding,
} from '../../helpers/oauth-binding.js';
import { seedTwoChannelBasket, type TwoChannelBasket } from '../../helpers/two-channel-basket-fixture.js';

/**
 * Issue #1279 — federated customer sign-in when the storefront and the API are
 * on different hosts (`deploy/nginx.example.conf`: `example.com` and
 * `api.example.com`).
 *
 * The provider returns to the API host. A cookie the callback set there would
 * be the API host's, and the storefront would never see a session. So the
 * callback sets none: it sends the browser to the **channel's own storefront**
 * (`sales_channels.storefront_url`) with a single-use code, and the storefront
 * redeems it server-to-server. The session comes back on that exchange, for the
 * storefront to set on its own host.
 *
 * Writes are this file's own: the channels come from the two-channel fixture's
 * random suffix, the account is created by the sign-in itself (a unique
 * address), and the settings switched on are restored afterwards.
 */

const SPLIT_STOREFRONT = 'https://shop.split-host.test';
const API_ORIGIN = 'http://localhost:8080';
const SIGN_IN_COOKIES = ['b2b_session', 'b2b_mfa_challenge', 'b2b_cart_merge_flash'];

async function setSetting(h: BackendServerHandle, code: string, value: boolean): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(code, value, null, { actorAdminUserId: null });
}

describe('federated customer sign-in on split hosts (#1279)', () => {
  let h: BackendServerHandle;
  let fx: TwoChannelBasket;
  const email = `split-host-${randomUUID().slice(0, 8)}@example.test`;

  async function callbackOn(
    channelCode: string,
    signInEmail = email,
  ): Promise<{ binding: StorefrontBinding; start: LightMyRequestResponse; callback: LightMyRequestResponse }> {
    const binding = storefrontBinding();
    const start = await h.app.inject({
      method: 'GET',
      url: customerOAuthStartUrl(binding, { next: '/account/orders', salesChannel: channelCode }),
    });
    expect(start.statusCode).toBe(302);
    // The provider's redirect URI is the API's, whatever host the storefront is on.
    const authorize = new URL(start.headers['location'] as string);
    expect(authorize.searchParams.get('redirect_uri') ?? API_ORIGIN).toContain(API_ORIGIN);
    const state = authorize.searchParams.get('state')!;
    const callback = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(signInEmail)}&state=${encodeURIComponent(state)}`,
      cookies: oauthBinding(start),
    });
    return { binding, start, callback };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSetting(h, 'mfa.storefront.google_enabled', true);
    await setSetting(h, 'customers.allow_registration_without_organization', true);
    fx = await seedTwoChannelBasket(h, 'split1279');
    await h.settings.adminService.setValueForSubset('sales_channels.storefront_url', [fx.a.code], SPLIT_STOREFRONT, null, {
      actorAdminUserId: null,
    });
  }, 60_000);

  afterAll(async () => {
    await h.settings.adminService.setValueForSubset('sales_channels.storefront_url', [fx.a.code], '', null, {
      actorAdminUserId: null,
    });
    await setSetting(h, 'mfa.storefront.google_enabled', false);
    await setSetting(h, 'customers.allow_registration_without_organization', false);
    await teardownBackendServer(h);
  });

  it('the callback on the API host sets no sign-in cookie and hands off to the channel’s storefront', async () => {
    const { callback } = await callbackOn(fx.a.code);

    expect(callback.statusCode).toBe(302);
    const location = new URL(callback.headers['location'] as string);
    expect(location.origin).toBe(SPLIT_STOREFRONT);
    expect(location.origin).not.toBe(API_ORIGIN);
    expect(location.pathname).toBe('/auth/federated/complete');
    expect(location.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(callback.headers['referrer-policy']).toBe('no-referrer');
    for (const name of SIGN_IN_COOKIES) {
      expect(callback.cookies.some((c) => c.name === name), name).toBe(false);
    }
  });

  it('the storefront’s exchange returns the session, which then works on that channel', async () => {
    const { binding, callback } = await callbackOn(fx.a.code);

    const exchanged = await exchangeHandoff(h.app, callback, binding, {
      headers: { 'x-sales-channel': fx.a.code },
    });
    expect(exchanged.statusCode, exchanged.body).toBe(200);
    expect(exchanged.json().data).toMatchObject({ status: 'authenticated', redirectPath: '/account/orders' });
    const session = sessionOf(exchanged);
    expect(session).toBeTruthy();

    const status = await h.app.inject({
      method: 'GET',
      url: '/api/v1/account/mfa/status',
      headers: { 'x-sales-channel': fx.a.code },
      cookies: { b2b_session: session! },
    });
    expect(status.statusCode, status.body).toBe(200);
  });

  it('a code is redeemed once', async () => {
    const { binding, callback } = await callbackOn(fx.a.code);
    const headers = { 'x-sales-channel': fx.a.code };
    expect((await exchangeHandoff(h.app, callback, binding, { headers })).statusCode).toBe(200);

    const again = await exchangeHandoff(h.app, callback, binding, { headers });
    expect(again.statusCode).toBe(400);
    expect(again.json().error?.code).toBe('MFA_FEDERATED_HANDOFF_INVALID');
    expect(sessionOf(again)).toBeUndefined();
  });

  it('is refused on another sales channel than the one it started on', async () => {
    const { binding, callback } = await callbackOn(fx.a.code);
    const res = await exchangeHandoff(h.app, callback, binding, { headers: { 'x-sales-channel': fx.b.code } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe('MFA_FEDERATED_HANDOFF_INVALID');
    expect(sessionOf(res)).toBeUndefined();
  });

  it('is refused for another browser’s binding, and the code is spent', async () => {
    const { binding, callback } = await callbackOn(fx.a.code);
    const headers = { 'x-sales-channel': fx.a.code };
    const stranger = await exchangeHandoff(h.app, callback, storefrontBinding(), { headers });
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json().error?.code).toBe('MFA_FEDERATED_HANDOFF_INVALID');
    expect((await exchangeHandoff(h.app, callback, binding, { headers })).statusCode).toBe(400);
  });

  it('a channel without a storefront URL of its own falls back to STOREFRONT_BASE_URL', async () => {
    // A buyer of that store: the account the sign-in creates belongs to it.
    const { callback } = await callbackOn(fx.b.code, `split-host-b-${randomUUID().slice(0, 8)}@example.test`);
    expect(handoffCodeOf(callback)).toBeTruthy();
    expect(new URL(callback.headers['location'] as string).origin).toBe('http://localhost:3000');
  });

  it('a refusal goes back to the channel’s storefront too', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/start?salesChannel=${encodeURIComponent(fx.a.code)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(new URL(res.headers['location'] as string).origin).toBe(SPLIT_STOREFRONT);
    expect(res.headers['location']).toContain('/login?error=sign_in_failed');
  });
});
