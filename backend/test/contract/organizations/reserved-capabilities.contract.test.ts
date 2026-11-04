import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, organizationPermissionCatalogueResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  OTHER_TEST_ORGANIZATION_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { seedRoleScopingFixture, TEST_REGULAR_USER_ID } from '../../helpers/seed-roles.js';
import { assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { dropOrganizationRoleCache, holdCustomRole } from './organization-role-fixtures.js';

/**
 * Reserved administrator capabilities and the member routes
 * (`specs/170-organization-roles/` WP-03, T054; `contracts/storefront-api.md`
 * §3; FR-005, FR-010, FR-011, FR-073; US 5.1, 5.3).
 *
 * Managing members, invitations and roles, and setting the MFA policy, belong
 * to the *Administrator* role and are not grantable: a custom role holding
 * **every** present permission is still refused each of them with the
 * existing `403 FORBIDDEN`. The member routes name the role by id: `{ roleId }`,
 * strict — the legacy `role` is `400`, another Organization's role `404`.
 *
 * `stub-regular-user-session` is `TEST_REGULAR_USER_ID`, given the
 * every-permission custom role below; `stub-customer-session` is the
 * Organization's administrator; `TEST_CUSTOMER_RFQ_ID` a member whose role the
 * administrator changes.
 */

const ADMIN = { b2b_session: 'stub-customer-session' };
const HOLDS_EVERYTHING = { b2b_session: 'stub-regular-user-session' };

describe('reserved administrator capabilities (FR-010–FR-011)', () => {
  let h: BackendServerHandle;
  let memberRoleId: string;
  let administratorRoleId: string;
  let everyCode: string[];
  let pendingInvitationId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedRoleScopingFixture(h.em());
    await seedOtherTestOrganization(h.em());
    memberRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member');
    administratorRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'administrator');

    const catalogue = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/permission-catalogue', cookies: ADMIN });
    expect(catalogue.statusCode, catalogue.body).toBe(200);
    everyCode = organizationPermissionCatalogueResponseSchema
      .parse(catalogue.json())
      .data.groups.flatMap((group) => group.permissions.map((p) => p.code));
    expect(everyCode, 'at least `addresses.manage` is declared (FR-014a)').toContain('addresses.manage');
    await holdCustomRole(h.em(), {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_REGULAR_USER_ID,
      permissions: everyCode,
    });
    dropOrganizationRoleCache(h, TEST_ORGANIZATION_ID);

    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      cookies: ADMIN,
      payload: { email: `reserved-${randomUUID().slice(0, 8)}@example.com` },
    });
    expect(invite.statusCode, invite.body).toBe(201);
    pendingInvitationId = (invite.json() as { data: { invitationId: string } }).data.invitationId;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('a custom role holding every permission is still refused', () => {
    const cases: Array<{ name: string; request: () => { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'; url: string; payload?: object } }> = [
      { name: 'listing members', request: () => ({ method: 'GET', url: '/api/v1/organizations/mine/members' }) },
      {
        name: 'changing a member’s role',
        request: () => ({ method: 'PATCH', url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_RFQ_ID}/role`, payload: { roleId: memberRoleId } }),
      },
      { name: 'removing a member', request: () => ({ method: 'DELETE', url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_RFQ_ID}` }) },
      { name: 'listing invitations', request: () => ({ method: 'GET', url: '/api/v1/organizations/mine/invitations' }) },
      {
        name: 'inviting',
        request: () => ({ method: 'POST', url: '/api/v1/organizations/mine/invitations', payload: { email: 'never@example.com' } }),
      },
      { name: 'revoking an invitation', request: () => ({ method: 'DELETE', url: `/api/v1/organizations/mine/invitations/${pendingInvitationId}` }) },
      { name: 'listing roles', request: () => ({ method: 'GET', url: '/api/v1/organizations/mine/roles' }) },
      {
        name: 'setting the MFA policy (FR-011)',
        request: () => ({ method: 'PUT', url: '/api/v1/account/organization/mfa-policy', payload: { enforceTotp: false } }),
      },
    ];

    it.each(cases)('$name → 403 FORBIDDEN', async ({ request }) => {
      const res = await h.app.inject({ ...request(), cookies: HOLDS_EVERYTHING });
      expect(res.statusCode, res.body).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('is refused before its body is read: a legacy `role` body is still 403, not 400', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_RFQ_ID}/role`,
        cookies: HOLDS_EVERYTHING,
        payload: { role: 'organization_admin' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('the member routes, for the administrator', () => {
    it('lists members, each naming its role and none the legacy enum (FR-008, FR-073)', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/members', cookies: ADMIN });
      expect(res.statusCode, res.body).toBe(200);
      const members = (res.json() as { data: Array<Record<string, unknown>> }).data;
      const rfq = members.find((m) => m['id'] === TEST_CUSTOMER_RFQ_ID);
      expect(rfq).toBeDefined();
      expect(rfq).not.toHaveProperty('role');
      expect(rfq!['organizationRole']).toEqual({ id: memberRoleId, kind: 'member', name: 'Member' });
      const custom = members.find((m) => m['id'] === TEST_REGULAR_USER_ID);
      expect(custom!['organizationRole']).toMatchObject({ kind: 'custom' });
    });

    it('changes a member’s role by id, and back (FR-005, FR-065)', async () => {
      const up = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_RFQ_ID}/role`,
        cookies: ADMIN,
        payload: { roleId: administratorRoleId },
      });
      expect(up.statusCode, up.body).toBe(200);
      const promoted = (up.json() as { data: Record<string, unknown> }).data;
      expect(promoted['organizationRole']).toEqual({ id: administratorRoleId, kind: 'administrator', name: 'Administrator' });
      expect(promoted).not.toHaveProperty('role');

      const entries = (await h.em().execute(
        `select "object_type", "object_id" from "audit_log_entries"
          where "action" = 'customer_account.change_role' and "state_after"->>'customerAccountId' = ?
          order by "acted_at" desc limit 1`,
        [TEST_CUSTOMER_RFQ_ID],
      )) as Array<{ object_type: string; object_id: string }>;
      expect(entries[0]).toEqual({ object_type: 'organization', object_id: TEST_ORGANIZATION_ID });

      const down = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_RFQ_ID}/role`,
        cookies: ADMIN,
        payload: { roleId: memberRoleId },
      });
      expect(down.statusCode, down.body).toBe(200);
    });

    it("answers another Organization's role as not found (FR-005)", async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_RFQ_ID}/role`,
        cookies: ADMIN,
        payload: { roleId: await predefinedRoleIdOf(h.em(), OTHER_TEST_ORGANIZATION_ID, 'administrator') },
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('refuses a body that still sends the legacy role (FR-073)', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/members/${TEST_CUSTOMER_RFQ_ID}/role`,
        cookies: ADMIN,
        payload: { role: 'organization_admin' },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('a member returned to Member keeps nothing of the role it left', async () => {
      await assignOrganizationRole(h.em(), TEST_CUSTOMER_RFQ_ID, memberRoleId);
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/members', cookies: ADMIN });
      const rfq = (res.json() as { data: Array<Record<string, unknown>> }).data.find((m) => m['id'] === TEST_CUSTOMER_RFQ_ID);
      expect(rfq!['organizationRole']).toMatchObject({ kind: 'member' });
    });
  });
});
