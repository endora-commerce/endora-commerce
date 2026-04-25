import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T168 — `POST /organizations/invitations/:token/accept` consumes a pending
 * invitation, creates a CustomerAccount with role='regular_user' (or whatever
 * the invitation specified), and 200s with the new account.
 */

interface CustomerAccount {
  id: string;
  email: string;
  role: 'regular_user' | 'organization_admin';
  organizationId: string;
}

describe('POST /api/v1/organizations/invitations/:token/accept', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a regular_user account from a pending invitation', async () => {
    // 1. Org admin invites.
    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: {
        email: 'invited-user@example.com',
        role: 'regular_user',
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(invite.statusCode).toBe(201);

    // 2. Test probe surfaces the raw token (real flow: token arrives by email).
    const probe = await h.app.inject({
      method: 'GET',
      url: '/api/v1/_test/latest-invitation-token',
    });
    expect(probe.statusCode).toBe(200);
    const { token } = probe.json() as { token: string };

    // 3. Anonymous accept.
    const accept = await h.app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${token}/accept`,
      payload: {
        password: 'invited-strong-password-12!',
        firstName: 'Inv',
        lastName: 'Itee',
      },
    });
    expect(accept.statusCode).toBe(200);
    const body = accept.json() as { data: { customerAccount: CustomerAccount } };
    expect(body.data.customerAccount.role).toBe('regular_user');
    expect(body.data.customerAccount.email).toBe('invited-user@example.com');
  });
});
