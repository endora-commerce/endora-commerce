import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * T170 — Removing the only administrator of an Organization must fail with
 * 409 CANNOT_REMOVE_LAST_ADMIN. Same protection guards moving them to another
 * role (CANNOT_DEMOTE_LAST_ADMIN).
 *
 * `specs/170-organization-roles/` WP-03 (T054): the refusals keep their codes;
 * the role is named by id (`{ roleId }`).
 */

describe('Last-admin protection', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('DELETE /members/:id of the only administrator returns 409', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_ID}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.CANNOT_REMOVE_LAST_ADMIN);
  });

  it('PATCH /members/:id/role moving the only administrator to Member returns 409', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_ID}/role`,
      payload: { roleId: await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member') },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.CANNOT_DEMOTE_LAST_ADMIN);
  });
});
