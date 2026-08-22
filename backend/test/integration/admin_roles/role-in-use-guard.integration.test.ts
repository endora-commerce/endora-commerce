import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The role-in-use guard counts every assignee a restore could bring back.
 *
 * **Issue #168 — the owner's ruling: a role assignment survives a soft delete.**
 * Restoring a soft-deleted admin restores their role, so the assignment is still
 * held while the account sits in the bin. The guard used to count live assignees
 * only, so once the last one was soft-deleted it passed — and the delete it let
 * through hit `admin_users_admin_role_fk` (`on delete restrict`, and the row
 * still carries `admin_role_id`) and answered **500**. The operator was told the
 * role was unused, confirmed, and got a server error.
 *
 * Both halves are asserted below, and the second matters more: the refusal names
 * its reason. `details.code` carries the token the sentence is keyed on and the
 * count the sentence interpolates (MR !582, MR !587), so an operator reads "this
 * role is still assigned to 1 deleted account(s)" rather than "Admin Role In
 * Use." — or, before this fix, a 500.
 *
 * Feature 075, Phase C is the other half of the file's history: `admin_roles`
 * used to run `em.count(AdminUser, { adminRoleId, deletedAt: null })` against a
 * table it does not own, and the read goes through `adminUserReadPort` now.
 * That is why the two populations are counted separately here — the port's
 * `listByRoleId` returns both, and which one an operator is looking at changes
 * the sentence they need.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('admin role deletion counts every assignee a restore returns [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Create a role and one admin holding it; answer both ids. */
  async function roleWithOneAssignee(): Promise<{ roleId: string; adminUserId: string }> {
    const code = `retired_role_${randomUUID().slice(0, 8)}`;
    const upsert = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      payload: { code, name: 'Retired role', permissions: ['orders:read'] },
      ...ADMIN,
    });
    expect(upsert.statusCode).toBe(200);
    const roleId = (upsert.json() as { data: { id: string } }).data.id;

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      payload: {
        email: `retired-${randomUUID().slice(0, 8)}@example.test`,
        password: 'Sufficiently-long-password-1',
        firstName: 'Retired',
        lastName: 'Assignee',
        adminRoleId: roleId,
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);
    return { roleId, adminUserId: (created.json() as { data: { id: string } }).data.id };
  }

  it('refuses the delete while the only assignee is soft-deleted, and says why', async () => {
    const { roleId, adminUserId } = await roleWithOneAssignee();

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-users/${adminUserId}`,
      ...ADMIN,
    });
    expect(removed.statusCode).toBe(204);

    // The account is in the bin, and restoring it restores the role — so the
    // role is still in use. Before issue #168 the guard passed here and the
    // delete went on to fail on the foreign key with a 500.
    const refused = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${roleId}`,
      ...ADMIN,
    });
    expect(refused.statusCode).toBe(409);
    const error = (refused.json() as {
      error: { code: string; message: string; details?: Record<string, unknown> };
    }).error;
    expect(error.code).toBe(ERROR_CODES.ADMIN_ROLE_IN_USE);
    // The token keys the sentence and the count fills it, so the operator is
    // told which population is holding the role rather than "Admin Role In Use."
    expect(error.details?.['code']).toBe('assigned_to_deleted');
    expect(error.details?.['deleted']).toBe(1);
    expect(error.message).toContain('1');
    expect(error.message).toMatch(/deleted/i);

    // Non-destructive: the refusal left the role where it was.
    const roles = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-roles',
      ...ADMIN,
    });
    expect(roles.statusCode).toBe(200);
    expect(
      (roles.json() as { data: Array<{ id: string }> }).data.map((r) => r.id),
    ).toContain(roleId);
  });

  it('a live assignee is refused with its own sentence and count', async () => {
    const { roleId } = await roleWithOneAssignee();

    const blocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${roleId}`,
      ...ADMIN,
    });
    expect(blocked.statusCode).toBe(409);
    const error = (blocked.json() as {
      error: { code: string; message: string; details?: Record<string, unknown> };
    }).error;
    expect(error.code).toBe(ERROR_CODES.ADMIN_ROLE_IN_USE);
    expect(error.details?.['code']).toBe('assigned');
    expect(error.details?.['assigned']).toBe(1);
    expect(error.message).toContain('1');
  });

  it('deletes a role nobody has ever held', async () => {
    const code = `unheld_role_${randomUUID().slice(0, 8)}`;
    const upsert = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      payload: { code, name: 'Unheld role', permissions: ['orders:read'] },
      ...ADMIN,
    });
    expect(upsert.statusCode).toBe(200);
    const roleId = (upsert.json() as { data: { id: string } }).data.id;

    // The positive control for the two refusals above: without it, a guard that
    // refused everything would read as a correct one.
    const deleted = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${roleId}`,
      ...ADMIN,
    });
    expect(deleted.statusCode).toBe(204);
  });
});
