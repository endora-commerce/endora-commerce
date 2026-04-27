import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T177 — `GET /api/v1/organizations/mine/invitations` lists pending
 * invitations and `DELETE /api/v1/organizations/mine/invitations/:id`
 * revokes one. Both gated by Org Admin role.
 */

describe('Organization invitations — list + revoke', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists pending invitations and revokes one', async () => {
    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { email: 'pending-invitee@example.com', role: 'regular_user' },
    });
    expect(invite.statusCode).toBe(201);
    const invitationId = (invite.json() as { data: { invitationId: string } }).data
      .invitationId;

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/organizations/mine/invitations',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ id: string; email: string; role: string }>;
    };
    expect(body.data.some((row) => row.id === invitationId)).toBe(true);

    const revoke = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/mine/invitations/${invitationId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(revoke.statusCode).toBe(204);

    // After revoke, the row drops off the pending list.
    const list2 = await h.app.inject({
      method: 'GET',
      url: '/api/v1/organizations/mine/invitations',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const body2 = list2.json() as { data: Array<{ id: string }> };
    expect(body2.data.some((row) => row.id === invitationId)).toBe(false);
  });

  it('rejects non-admin members', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/organizations/mine/invitations',
      cookies: { b2b_session: 'stub-regular-user-session' },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
