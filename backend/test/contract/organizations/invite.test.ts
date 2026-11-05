import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CUSTOMER_COOKIES,
  OTHER_TEST_ORGANIZATION_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { dropOrganizationRoleCache, seedCustomRole } from './organization-role-fixtures.js';

/**
 * T167 — `POST /organizations/mine/invitations` invites a new user by email
 * and returns 201 with the invitation id + expiresAt. The invitation row is
 * stored in `pending` state for later acceptance.
 *
 * `specs/170-organization-roles/` WP-03 (T054; `contracts/storefront-api.md`
 * §3; FR-005, FR-065, FR-073): the body is `{ email, roleId? }`, strict. An
 * absent `roleId` is the Organization's *Member*; a role of another
 * Organization is `404`, as if it did not exist; the legacy `role` key is
 * refused `400`. The invitation is created by the audited
 * `organization_invitation.create` Command, against the Organization.
 */

interface InvitationResponse {
  invitationId: string;
  expiresAt: string;
}

const ADMIN = { b2b_session: 'stub-customer-session' };

describe('POST /api/v1/organizations/mine/invitations', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedOtherTestOrganization(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function invitationRow(id: string): Promise<{ organization_role_id: string }> {
    const [row] = (await h.em().execute(
      `select "organization_role_id" from "organization_invitations" where "id" = ?`,
      [id],
    )) as Array<{ organization_role_id: string }>;
    return row!;
  }

  it('creates a pending invitation holding the Member role when no role is named', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email: 'new-member@example.com' },
      cookies: ADMIN,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: InvitationResponse };
    expect(body.data.invitationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.expiresAt).toMatch(/T.*Z/);
    const row = await invitationRow(body.data.invitationId);
    expect(row.organization_role_id).toBe(await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member'));
  });

  it('creates an invitation holding the role it names, custom roles included', async () => {
    const roleId = await seedCustomRole(h.em(), {
      organizationId: TEST_ORGANIZATION_ID,
      permissions: ['addresses.manage'],
    });
    dropOrganizationRoleCache(h, TEST_ORGANIZATION_ID);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email: `custom-${randomUUID().slice(0, 8)}@example.com`, roleId },
      cookies: ADMIN,
    });
    expect(res.statusCode, res.body).toBe(201);
    const row = await invitationRow((res.json() as { data: InvitationResponse }).data.invitationId);
    expect(row.organization_role_id).toBe(roleId);

    const administratorRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'administrator');
    const admin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email: `admin-${randomUUID().slice(0, 8)}@example.com`, roleId: administratorRoleId },
      cookies: ADMIN,
    });
    expect(admin.statusCode, admin.body).toBe(201);
    const adminRow = await invitationRow((admin.json() as { data: InvitationResponse }).data.invitationId);
    expect(adminRow).toEqual({ organization_role_id: administratorRoleId });
  });

  it('audits organization_invitation.create against the Organization (FR-065)', async () => {
    const email = `audited-${randomUUID().slice(0, 8)}@example.com`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email },
      cookies: ADMIN,
    });
    expect(res.statusCode, res.body).toBe(201);
    const invitationId = (res.json() as { data: InvitationResponse }).data.invitationId;
    const entries = (await h.em().execute(
      `select "object_type", "object_id", "state_after", "actor_admin_user_id", "actor_customer_account_id"
         from "audit_log_entries"
        where "action" = 'organization_invitation.create' and "state_after"->>'invitationId' = ?`,
      [invitationId],
    )) as Array<{
      object_type: string;
      object_id: string;
      state_after: Record<string, unknown>;
      actor_admin_user_id: string | null;
      actor_customer_account_id: string | null;
    }>;
    expect(entries).toHaveLength(1);
    // The storefront administrator who invited is the row's actor (issue #741).
    expect(entries[0]).toMatchObject({
      object_type: 'organization',
      object_id: TEST_ORGANIZATION_ID,
      actor_admin_user_id: null,
      actor_customer_account_id: CUSTOMER_COOKIES['stub-customer-session']!.customerAccountId,
    });
    expect(entries[0]!.state_after).toMatchObject({ email, role: { kind: 'member' } });
  });

  it("answers another Organization's role as not found (FR-005)", async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: {
        email: `cross-${randomUUID().slice(0, 8)}@example.com`,
        roleId: await predefinedRoleIdOf(h.em(), OTHER_TEST_ORGANIZATION_ID, 'member'),
      },
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('refuses a body that still sends the legacy role (FR-073)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email: `legacy-${randomUUID().slice(0, 8)}@example.com`, role: 'regular_user' },
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
