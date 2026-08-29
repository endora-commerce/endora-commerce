import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T170 — Removing the only `organization_admin` of an Organization must fail
 * with 409 CANNOT_REMOVE_LAST_ADMIN. Same protection guards a role downgrade
 * to `regular_user` (CANNOT_DEMOTE_LAST_ADMIN).
 */

describe('Last-admin protection', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('DELETE /members/:id of the only organization_admin returns 409', async () => {
    const adminId = '00000000-0000-4000-8000-0000000000a1';
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/mine/members/${adminId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.CANNOT_REMOVE_LAST_ADMIN);
  });

  it('PATCH /members/:id/role demoting the only admin returns 409', async () => {
    const adminId = '00000000-0000-4000-8000-0000000000a1';
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/mine/members/${adminId}/role`,
      payload: { role: 'regular_user' },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.CANNOT_DEMOTE_LAST_ADMIN);
  });
});
