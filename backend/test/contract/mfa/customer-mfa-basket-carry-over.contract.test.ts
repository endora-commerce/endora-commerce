import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, CartItem } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_EMPTY_ID } from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #368 — two-step sign-in carries the signed-out basket over.
 *
 * The password route merges the anonymous basket (`b2b_cart_anon`) into the
 * customer's in its post-sign-in step, but returns `mfaSetupRequired` /
 * `mfaRequired` before that step whenever the account needs a second one. The
 * session is then established by `mfa`'s enforced-enrolment completion or its
 * second-step verify, which ran no such step, so the basket was simply lost.
 *
 * One account walks both: an enforced, unenrolled member completes the forced
 * set-up (no prior basket → `adopted`), and is thereby enrolled, so its next
 * sign-in is the second step (a basket now exists → `merged`). A thrown merge
 * still issues the session and keeps the anonymous cookie, as at the password
 * step (feature 037 FR-007/FR-008).
 */

const ORG_ADMIN = { b2b_session: 'stub-customer-session' };
const EMAIL = 'stub-customer-empty@example.com';

interface CompletionBody {
  data: {
    status: 'authenticated';
    cartMerge?: { outcome: 'adopted' | 'merged' | 'noop'; destinationCartId: string } | null;
  };
}

function totpCode(secret: string, offsetMs = 0): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: Date.now() + offsetMs });
}

function setCookies(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function clearsAnonCookie(raw: string | string[] | undefined): boolean {
  return setCookies(raw).some(
    (h) => /b2b_cart_anon=;/.test(h) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(h),
  );
}

async function fillAnonymousBasket(h: BackendServerHandle, token: string, productId: string): Promise<void> {
  const add = await h.app.inject({
    method: 'POST',
    url: '/api/v1/cart/items',
    payload: { productId, quantity: 1 },
    cookies: { b2b_cart_anon: token },
  });
  expect(add.statusCode).toBe(200);
}

async function passwordStep(h: BackendServerHandle, anonToken?: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/customer/login',
    payload: { email: EMAIL, password: STUB_CUSTOMER_PASSWORD },
    ...(anonToken ? { cookies: { b2b_cart_anon: anonToken } } : {}),
  });
  expect(res.statusCode).toBe(200);
  return res.json().data as { status: string; setupTicket?: string; challengeId?: string };
}

describe('two-step customer sign-in — the signed-out basket is carried over (#368)', () => {
  let h: BackendServerHandle;
  let secret: string;
  let recoveryCodes: string[];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const priors = await em.find(Cart, { customerAccountId: TEST_CUSTOMER_EMPTY_ID, status: 'active' });
    for (const c of priors) await em.nativeDelete(CartItem, { cartId: c.id });
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_EMPTY_ID, status: 'active' });
    // The organization's administrator requires a second factor of its members.
    const policy = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/organization/mfa-policy',
      cookies: ORG_ADMIN,
      payload: { enforceTotp: true },
    });
    expect(policy.statusCode).toBe(200);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('the enforced-enrolment completion adopts the anonymous basket and clears its cookie', async () => {
    const anonToken = `anon-mfa-setup-${Date.now()}`;
    await fillAnonymousBasket(h, anonToken, SEED_PRODUCT_101_ID);

    const login = await passwordStep(h, anonToken);
    expect(login.status).toBe('mfaSetupRequired');
    const begin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/setup-ticket/begin',
      payload: { setupTicket: login.setupTicket },
    });
    expect(begin.statusCode).toBe(200);
    secret = (begin.json().data as { secret: string }).secret;

    const complete = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/setup-ticket/complete',
      payload: { setupTicket: login.setupTicket, code: totpCode(secret) },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(complete.statusCode).toBe(200);
    const body = complete.json() as CompletionBody & { data: { recoveryCodes: string[] } };
    recoveryCodes = body.data.recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    expect(body.data.cartMerge?.outcome).toBe('adopted');
    expect(clearsAnonCookie(complete.headers['set-cookie'])).toBe(true);

    const adopted = await h.em().fork().findOneOrFail(Cart, { id: body.data.cartMerge!.destinationCartId });
    expect(adopted.customerAccountId).toBe(TEST_CUSTOMER_EMPTY_ID);
    const lines = await h.em().fork().find(CartItem, { cartId: adopted.id });
    expect(lines.map((line) => line.productId)).toEqual([SEED_PRODUCT_101_ID]);
  });

  it('the second-step verify merges the anonymous basket into the customer one and clears its cookie', async () => {
    const anonToken = `anon-mfa-verify-${Date.now()}`;
    await fillAnonymousBasket(h, anonToken, SEED_PRODUCT_102_ID);

    const login = await passwordStep(h, anonToken);
    expect(login.status).toBe('mfaRequired');
    const verify = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: login.challengeId, code: recoveryCodes[0] },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as CompletionBody;
    expect(body.data.status).toBe('authenticated');
    expect(body.data.cartMerge?.outcome).toBe('merged');
    expect(clearsAnonCookie(verify.headers['set-cookie'])).toBe(true);
    expect(verify.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();

    const lines = await h.em().fork().find(CartItem, { cartId: body.data.cartMerge!.destinationCartId });
    expect(lines.map((line) => line.productId).sort()).toEqual([SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID].sort());
  });

  it('a second step with no anonymous basket answers no merge and clears nothing', async () => {
    const login = await passwordStep(h);
    expect(login.status).toBe('mfaRequired');
    const verify = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: login.challengeId, code: recoveryCodes[1] },
    });
    expect(verify.statusCode).toBe(200);
    expect((verify.json() as CompletionBody).data.cartMerge ?? null).toBeNull();
    expect(clearsAnonCookie(verify.headers['set-cookie'])).toBe(false);
  });

  it('a thrown merge still issues the session and keeps the anonymous cookie (037 FR-007/FR-008)', async () => {
    const cs = h.cartService();
    expect(cs).not.toBeNull();
    const spy = vi.spyOn(cs!, 'mergeAnonymousIntoCustomer').mockRejectedValueOnce(new Error('chaos'));
    try {
      const anonToken = `anon-mfa-chaos-${Date.now()}`;
      const login = await passwordStep(h, anonToken);
      expect(login.status).toBe('mfaRequired');
      const verify = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/mfa/verify',
        payload: { challengeId: login.challengeId, code: recoveryCodes[2] },
        cookies: { b2b_cart_anon: anonToken },
      });
      expect(verify.statusCode).toBe(200);
      expect(verify.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();
      expect((verify.json() as CompletionBody).data.cartMerge ?? null).toBeNull();
      expect(clearsAnonCookie(verify.headers['set-cookie'])).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
