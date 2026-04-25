import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T167 — `POST /organizations/mine/invitations` invites a new user by email
 * and returns 201 with the invitation id + expiresAt. The invitation row is
 * stored in `pending` state for later acceptance.
 */

interface InvitationResponse {
  invitationId: string;
  expiresAt: string;
}

describe('POST /api/v1/organizations/mine/invitations', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a pending invitation for the given email + role', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: {
        email: 'new-member@example.com',
        role: 'regular_user',
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: InvitationResponse };
    expect(body.data.invitationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.expiresAt).toMatch(/T.*Z/);
  });
});
