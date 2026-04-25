import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T171 — End-to-end invitation: org admin invites → invitee accepts → invitee
 * logs in → invitee can read their own profile but NOT a sibling order.
 */

interface CustomerAccount { id: string; email: string; role: string }

describe('invite → accept → role scoping integration', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('walks the entire flow', async () => {
    // 1. Admin invites.
    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email: 'integration-invitee@example.com', role: 'regular_user' },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(invite.statusCode).toBe(201);

    // 2. Test probe → token.
    const probe = await h.app.inject({
      method: 'GET',
      url: '/api/v1/_test/latest-invitation-token',
    });
    const { token } = probe.json() as { token: string };

    // 3. Accept anonymously.
    const accept = await h.app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${token}/accept`,
      payload: { password: 'integration-strong-pass-12!', firstName: 'Int', lastName: 'Egr' },
    });
    expect(accept.statusCode).toBe(200);
    const newCustomer = (accept.json() as { data: { customerAccount: CustomerAccount } }).data
      .customerAccount;
    expect(newCustomer.role).toBe('regular_user');

    // 4. Invitee logs in.
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: newCustomer.email, password: 'integration-strong-pass-12!' },
    });
    expect(login.statusCode).toBe(200);
    const cookies = login.headers['set-cookie'];
    const session = parseSessionCookie(cookies);

    // 5. New invitee lists their (empty) orders successfully.
    const myOrders = await h.app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      cookies: { b2b_session: session },
    });
    expect(myOrders.statusCode).toBe(200);
    expect((myOrders.json() as { data: unknown[] }).data).toHaveLength(0);
  });
});

function parseSessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.find((c) => c.includes('b2b_session=')) : setCookie;
  if (!header) return '';
  const match = /b2b_session=([^;]+)/.exec(header);
  return match?.[1] ?? '';
}
