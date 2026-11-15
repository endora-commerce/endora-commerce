import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, CartItem, CustomerAccount } from '../../helpers/package-entities.js';
import {
  customerOAuthStartUrl,
  exchangeHandoff,
  oauthBinding,
  sessionOf,
  storefrontBinding,
} from '../../helpers/oauth-binding.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  seedTwoChannelBasket,
  type TwoChannelBasket,
} from '../../helpers/two-channel-basket-fixture.js';

/**
 * Issue #1188 — a federated (Google / Microsoft) customer sign-in carries the
 * signed-out basket over, as the password sign-in does and, since #368, the
 * second step.
 *
 * The sign-in used to establish the session without merging the anonymous
 * basket: the buyer landed signed in with the basket they had filled gone. It
 * now runs `organizations`' `customerSignInCompletionPort` — the step every
 * other sign-in runs — over the browser's `b2b_cart_anon`, on the channel the
 * sign-in was **started** on.
 *
 * Issue #1279 — the step runs in the storefront's exchange, not in the
 * provider's redirect to the API: that is the request that carries the
 * storefront host's `b2b_cart_anon`. The exchange clears the drained cookie and
 * answers `cartMerge`; the merge notice is the storefront's to write from it,
 * so the backend writes no `b2b_cart_merge_flash`.
 *
 * Writes are this file's own rows: the accounts are created by the sign-ins
 * themselves (unique addresses), and the channels and product come from the
 * two-channel fixture's random suffix. The two settings it switches on are
 * restored to their shipped `false` afterwards.
 *
 * Off-state: `carts` is `nonDeactivatable`, so its off state is the platform
 * axis — a deployment that never installed it. The sign-in must still complete.
 */

const STOREFRONT = 'http://localhost:3000';
const ANON_COOKIE = 'b2b_cart_anon';
const FLASH_COOKIE = 'b2b_cart_merge_flash';

async function setSetting(h: BackendServerHandle, code: string, value: boolean): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(code, value, null, { actorAdminUserId: null });
}

function anonCleared(res: LightMyRequestResponse): boolean {
  return res.cookies.some(
    (c) =>
      c.name === ANON_COOKIE &&
      c.value === '' &&
      (c.maxAge === 0 || (c.expires !== undefined && c.expires.getTime() <= Date.now())),
  );
}

function flashOf(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === FLASH_COOKIE)?.value;
}

function cartMergeOf(res: LightMyRequestResponse): string | null {
  return (res.json().data as { cartMerge: { outcome: string } | null }).cartMerge?.outcome ?? null;
}

describe('federated customer sign-in — the signed-out basket is carried over (#1188)', () => {
  let h: BackendServerHandle;
  let fx: TwoChannelBasket;
  const email = `fed-basket-${randomUUID().slice(0, 8)}@example.test`;

  async function fillAnonymousBasket(channelCode: string, quantity: number): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { 'x-sales-channel': channelCode, 'content-type': 'application/json' },
      payload: { productId: fx.productId, quantity },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.cookies.find((c) => c.name === ANON_COOKIE)!.value;
  }

  async function signIn(
    channelCode: string,
    signInEmail: string,
    anonToken?: string,
  ): Promise<LightMyRequestResponse> {
    const binding = storefrontBinding();
    const started = await h.app.inject({
      method: 'GET',
      url: customerOAuthStartUrl(binding),
      headers: { 'x-sales-channel': channelCode },
    });
    expect(started.statusCode).toBe(302);
    const state = new URL(started.headers['location'] as string).searchParams.get('state')!;
    // The provider's redirect to the API host: no storefront channel signal and
    // none of the storefront's cookies — only the API host's binding.
    const back = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(signInEmail)}&state=${encodeURIComponent(state)}`,
      cookies: oauthBinding(started),
    });
    expect(back.headers['location']).toMatch(new RegExp(`^${STOREFRONT}/auth/federated/complete\\?code=`));
    expect(back.cookies.some((c) => c.name === 'b2b_session' || c.name === FLASH_COOKIE)).toBe(false);
    // The storefront's exchange: its channel and its host's cookies.
    return exchangeHandoff(h.app, back, binding, {
      headers: { 'x-sales-channel': channelCode },
      ...(anonToken ? { cookies: { [ANON_COOKIE]: anonToken } } : {}),
    });
  }

  async function activeCartOf(customerAccountId: string, salesChannelId: string) {
    return h.em().fork().findOne(Cart, { customerAccountId, salesChannelId, status: 'active' });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSetting(h, 'mfa.storefront.google_enabled', true);
    await setSetting(h, 'customers.allow_registration_without_organization', true);
    fx = await seedTwoChannelBasket(h, 'fed1188');
  }, 60_000);

  afterAll(async () => {
    await setSetting(h, 'mfa.storefront.google_enabled', false);
    await setSetting(h, 'customers.allow_registration_without_organization', false);
    await teardownBackendServer(h);
  });

  it('a first sign-in adopts the basket filled on the started-on store, clears its cookie and leaves the notice', async () => {
    const anonToken = await fillAnonymousBasket(fx.a.code, 1);

    const res = await signIn(fx.a.code, email, anonToken);

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.redirectPath).toBe('/account');
    expect(sessionOf(res)).toBeTruthy();
    expect(anonCleared(res)).toBe(true);
    expect(cartMergeOf(res)).toBe('adopted');
    expect(flashOf(res)).toBeUndefined();

    const account = await h.em().fork().findOneOrFail(CustomerAccount, { email });
    const cart = await activeCartOf(account.id, fx.a.id);
    expect(cart).not.toBeNull();
    const lines = await h.em().fork().find(CartItem, { cartId: cart!.id });
    expect(lines.map((l) => [l.productId, l.quantity])).toEqual([[fx.productId, 1]]);
  });

  it('a later sign-in merges a new signed-out basket into the customer one on that store', async () => {
    const anonToken = await fillAnonymousBasket(fx.a.code, 2);

    const res = await signIn(fx.a.code, email, anonToken);

    expect(res.statusCode, res.body).toBe(200);
    expect(sessionOf(res)).toBeTruthy();
    expect(anonCleared(res)).toBe(true);
    expect(cartMergeOf(res)).toBe('merged');
    expect(flashOf(res)).toBeUndefined();

    const account = await h.em().fork().findOneOrFail(CustomerAccount, { email });
    const cart = await activeCartOf(account.id, fx.a.id);
    const lines = await h.em().fork().find(CartItem, { cartId: cart!.id });
    expect(lines.map((l) => [l.productId, l.quantity])).toEqual([[fx.productId, 3]]);
  });

  it('a sign-in with no signed-out basket merges nothing, clears nothing and shows no notice', async () => {
    const res = await signIn(fx.a.code, email);

    expect(res.statusCode, res.body).toBe(200);
    expect(sessionOf(res)).toBeTruthy();
    expect(res.cookies.some((c) => c.name === ANON_COOKIE)).toBe(false);
    expect(cartMergeOf(res)).toBeNull();
    expect(flashOf(res)).toBeUndefined();
  });

  it('a basket of another store is left as it is (basket-attribution §3)', async () => {
    const anonToken = await fillAnonymousBasket(fx.b.code, 1);
    const other = `fed-basket-other-${randomUUID().slice(0, 8)}@example.test`;

    const res = await signIn(fx.a.code, other, anonToken);

    expect(res.statusCode, res.body).toBe(200);
    expect(sessionOf(res)).toBeTruthy();
    expect(anonCleared(res)).toBe(false);
    expect(['adopted', 'merged']).not.toContain(cartMergeOf(res));
    expect(flashOf(res)).toBeUndefined();
    const anonymous = await h.em().fork().findOne(Cart, { anonymousCartToken: anonToken });
    expect(anonymous?.customerAccountId ?? null).toBeNull();
  });

  it('with carts not installed the sign-in still completes, without a merge or a notice', async () => {
    const anonToken = await fillAnonymousBasket(fx.a.code, 1);

    const res = await withModuleOff('carts', 'platform-unavailable', () => signIn(fx.a.code, email, anonToken));

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.redirectPath).toBe('/account');
    expect(sessionOf(res)).toBeTruthy();
    expect(anonCleared(res)).toBe(false);
    expect(cartMergeOf(res)).toBeNull();
    expect(flashOf(res)).toBeUndefined();
  });
});
