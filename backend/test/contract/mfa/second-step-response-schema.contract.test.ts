import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  mfaSetupTicketCompleteResponseSchema,
  mfaVerifyResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, CartItem } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_EMPTY_ID } from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

/**
 * The customer's two-step sign-in replies answer what
 * `@endora-commerce/contracts` publishes, and nothing beside it
 * (Constitution II, issue #1352).
 *
 * `POST /api/v1/auth/customer/mfa/setup-ticket/complete` (the enforced
 * enrolment) and `POST /api/v1/auth/customer/mfa/verify` (the second step)
 * establish the session the password step withheld. No published schema
 * described either reply, so the storefront read them untyped. Each is parsed
 * here with a strict copy of its schema, with and without a guest basket the
 * merge acts on: a declared field answered with a type the schema refuses, a
 * required field not answered, and a key no schema declares all red this file.
 *
 * One account walks both: the Organization requires a second factor, so the
 * unenrolled member is sent to the enforced enrolment, and is thereby enrolled
 * for every sign-in after it.
 */

const ORG_ADMIN = { b2b_session: 'stub-customer-session' };
const EMAIL = 'stub-customer-empty@example.com';

function totpCode(secret: string): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function passwordStep(h: BackendServerHandle, anonToken?: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/customer/login',
    payload: { email: EMAIL, password: STUB_CUSTOMER_PASSWORD },
    ...(anonToken ? { cookies: { b2b_cart_anon: anonToken } } : {}),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as { status: string; setupTicket?: string; challengeId?: string };
}

describe('two-step customer sign-in responses parse with the published schemas (#1352)', () => {
  let h: BackendServerHandle;
  let recoveryCodes: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const priors = await em.find(Cart, { customerAccountId: TEST_CUSTOMER_EMPTY_ID, status: 'active' });
    for (const c of priors) await em.nativeDelete(CartItem, { cartId: c.id });
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_EMPTY_ID, status: 'active' });
    const policy = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/organization/mfa-policy',
      cookies: ORG_ADMIN,
      payload: { enforceTotp: true },
    });
    expect(policy.statusCode, policy.body).toBe(200);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('POST /api/v1/auth/customer/mfa/setup-ticket/complete — enrolled, with a guest basket', async () => {
    const anonToken = `anon-1352-setup-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode, add.body).toBe(200);

    const login = await passwordStep(h, anonToken);
    expect(login.status).toBe('mfaSetupRequired');
    const begin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/setup-ticket/begin',
      payload: { setupTicket: login.setupTicket },
    });
    expect(begin.statusCode, begin.body).toBe(200);
    const secret = (begin.json().data as { secret: string }).secret;

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/setup-ticket/complete',
      payload: { setupTicket: login.setupTicket, code: totpCode(secret) },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { status: string; recoveryCodes: string[]; cartMerge?: unknown } };
    expect(body.data.status).toBe('authenticated');
    expect(body.data.cartMerge).toBeDefined();
    recoveryCodes = body.data.recoveryCodes;
    expect(disagreements(deepStrict(mfaSetupTicketCompleteResponseSchema), body)).toEqual([]);
  });

  it('POST /api/v1/auth/customer/mfa/verify — signed in, with no guest basket', async () => {
    expect(recoveryCodes.length, 'the enrolment above handed out recovery codes').toBeGreaterThan(0);
    const login = await passwordStep(h);
    expect(login.status).toBe('mfaRequired');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: login.challengeId, code: recoveryCodes[0] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { status: string; cartMerge?: unknown } };
    expect(body.data.status).toBe('authenticated');
    expect(body.data.cartMerge).toBeUndefined();
    expect(disagreements(deepStrict(mfaVerifyResponseSchema), body)).toEqual([]);
  });

  it('POST /api/v1/auth/customer/mfa/verify — signed in, with a guest basket the merge acts on', async () => {
    const anonToken = `anon-1352-verify-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode, add.body).toBe(200);
    const login = await passwordStep(h, anonToken);
    expect(login.status).toBe('mfaRequired');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: login.challengeId, code: recoveryCodes[1] },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { cartMerge?: unknown } };
    expect(body.data.cartMerge).toBeDefined();
    expect(disagreements(deepStrict(mfaVerifyResponseSchema), body)).toEqual([]);
  });
});
