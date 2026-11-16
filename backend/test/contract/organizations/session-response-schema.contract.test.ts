import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerMeResponseSchema, customerSignInResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_EMPTY_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

/**
 * The buyer's session replies answer what `@endora-commerce/contracts`
 * publishes, and nothing beside it (Constitution II, issue #599 §1).
 *
 * `GET /api/v1/me` is read on every storefront page, and no published schema
 * described its envelope; its `organization` carried `legalName`, `version`,
 * `canTransact` and `moderationMessage`, which `organizationSchema` does not
 * declare. The password sign-in's published schema had no `status` and named
 * only part of the account it answers. Each reply is parsed here with a strict
 * copy of its schema: a declared field answered with a type the schema refuses,
 * a required field not answered, and a key no schema declares all red this
 * file.
 *
 * The only rows written are an impersonation session of the seeded member.
 */
describe('session responses parse with the published schemas', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET /api/v1/me — the account, its Organization and no impersonation', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { b2b_session: 'stub-customer-session' },
      headers: { 'accept-language': 'en' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { customerAccount: { id: string }; organization: unknown; impersonation: unknown } };
    expect(body.data.customerAccount.id).toBe(TEST_CUSTOMER_ID);
    expect(body.data.organization).not.toBeNull();
    expect(body.data.impersonation).toBeNull();
    expect(disagreements(deepStrict(customerMeResponseSchema), body)).toEqual([]);
  });

  it('GET /api/v1/me — an administrator impersonating a member', async () => {
    const start = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/impersonate`,
      payload: { customerAccountId: TEST_CUSTOMER_EMPTY_ID },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(start.statusCode, start.body).toBe(200);
    const raw = ([] as string[]).concat(start.headers['set-cookie'] ?? []).join('\n');
    const session = /b2b_session=([^;]+)/.exec(raw)?.[1];
    expect(session, 'the impersonation session cookie').toBeDefined();

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { b2b_session: decodeURIComponent(session!) },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { customerAccount: { id: string }; impersonation: unknown } };
    expect(body.data.customerAccount.id).toBe(TEST_CUSTOMER_EMPTY_ID);
    expect(body.data.impersonation).not.toBeNull();
    expect(disagreements(deepStrict(customerMeResponseSchema), body)).toEqual([]);
  });

  it('POST /api/v1/auth/customer/login — signed in, with no guest basket', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'stub-customer@example.com', password: STUB_CUSTOMER_PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('authenticated');
    expect(disagreements(deepStrict(customerSignInResponseSchema), res.json())).toEqual([]);
  });

  it('POST /api/v1/auth/customer/login — signed in, with a guest basket cookie that names nothing', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'stub-customer@example.com', password: STUB_CUSTOMER_PASSWORD },
      cookies: { b2b_cart_anon: 'no-such-guest-basket' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(disagreements(deepStrict(customerSignInResponseSchema), res.json())).toEqual([]);
  });
});
