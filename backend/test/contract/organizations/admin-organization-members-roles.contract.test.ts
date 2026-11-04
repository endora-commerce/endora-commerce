import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, organizationRoleRefSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import {
  ADMIN_COOKIES,
  OTHER_TEST_ORGANIZATION_ID,
  TEST_CUSTOMER_EMPTY_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { dropOrganizationRoleCache, holdCustomRole } from './organization-role-fixtures.js';

/**
 * The operator's member endpoints (`specs/170-organization-roles/` WP-03, T057;
 * `contracts/operator-api.md` §3; FR-062, FR-065, FR-073; spec *Impersonation*).
 *
 * Inviting and directly creating a member take `roleId?` (default *Member*);
 * changing a member's role takes `{ roleId, expectedUpdatedAt? }` and runs
 * `customer_account.change_role` under `customers:manage` **alone** — no role
 * code is needed to assign one (FR-062). The break-glass *recover administrator
 * access* assigns the administrator role through the same Command. The members
 * the Organization detail embeds, and the impersonation start, name the role as
 * `organizationRole`; an impersonating operator acts with exactly the
 * impersonated member's permissions.
 */

const CUSTOMERS_ONLY = 'stub-members-customers-only-session';
const base = `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`;

interface Member {
  id: string;
  organizationRole?: unknown;
  role?: unknown;
}

describe('operator member endpoints name roles by id (FR-062)', () => {
  let h: BackendServerHandle;
  let memberRoleId: string;
  let administratorRoleId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedOtherTestOrganization(h.em());
    memberRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member');
    administratorRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'administrator');
    const stamp = randomUUID().slice(0, 8);
    await withSystemScope('170 WP-03: an operator holding customers:manage alone', async () => {
      const fork = h.orm.em.fork();
      const role = fork.create(AdminRole, {
        code: `members_customers_only_${stamp}`,
        name: 'Customers only',
        permissions: ['customers:read', 'customers:manage'],
      });
      await fork.persistAndFlush(role);
      const operator = fork.create(AdminUser, {
        email: `members-customers-only-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: 'Customers',
        lastName: 'Only',
      });
      await fork.persistAndFlush(operator);
      ADMIN_COOKIES[CUSTOMERS_ONLY] = { adminUserId: operator.id };
    });
  }, 90_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[CUSTOMERS_ONLY];
    await assignOrganizationRole(h.em(), TEST_CUSTOMER_RFQ_ID, memberRoleId);
    await assignOrganizationRole(h.em(), TEST_CUSTOMER_EMPTY_ID, memberRoleId);
    await teardownBackendServer(h);
  });

  async function invitationRoleId(invitationId: string): Promise<string> {
    const [row] = (await h.em().execute(
      `select "organization_role_id" from "organization_invitations" where "id" = ?`,
      [invitationId],
    )) as Array<{ organization_role_id: string }>;
    return row!.organization_role_id;
  }

  it('invites with roleId, Member by default; the legacy role is 400', async () => {
    const byDefault = await h.app.inject({
      method: 'POST',
      url: `${base}/members/invite`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { email: `op-invite-${randomUUID().slice(0, 8)}@example.com` },
    });
    expect(byDefault.statusCode, byDefault.body).toBe(201);
    expect(await invitationRoleId((byDefault.json() as { data: { invitationId: string } }).data.invitationId)).toBe(memberRoleId);

    const named = await h.app.inject({
      method: 'POST',
      url: `${base}/members/invite`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { email: `op-invite-${randomUUID().slice(0, 8)}@example.com`, roleId: administratorRoleId },
    });
    expect(named.statusCode, named.body).toBe(201);
    expect(await invitationRoleId((named.json() as { data: { invitationId: string } }).data.invitationId)).toBe(administratorRoleId);

    const legacy = await h.app.inject({
      method: 'POST',
      url: `${base}/members/invite`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { email: `op-invite-${randomUUID().slice(0, 8)}@example.com`, role: 'regular_user' },
    });
    expect(legacy.statusCode).toBe(400);
  });

  it('creates a member directly with roleId, Member by default; another Organization’s role is 404', async () => {
    const payload = () => ({
      email: `op-direct-${randomUUID().slice(0, 8)}@example.com`,
      firstName: 'Direct',
      lastName: 'Member',
      password: 'direct-member-password-1!',
    });
    const byDefault = await h.app.inject({ method: 'POST', url: `${base}/members`, cookies: { b2b_session: CUSTOMERS_ONLY }, payload: payload() });
    expect(byDefault.statusCode, byDefault.body).toBe(201);
    const created = (byDefault.json() as { data: Member }).data;
    expect(created).not.toHaveProperty('role');
    expect(organizationRoleRefSchema.parse(created.organizationRole)).toEqual({ id: memberRoleId, kind: 'member', name: 'Member' });

    const asAdministrator = await h.app.inject({
      method: 'POST',
      url: `${base}/members`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { ...payload(), roleId: administratorRoleId },
    });
    expect(asAdministrator.statusCode, asAdministrator.body).toBe(201);
    expect((asAdministrator.json() as { data: Member }).data.organizationRole).toMatchObject({ kind: 'administrator' });

    const crossTenant = await h.app.inject({
      method: 'POST',
      url: `${base}/members`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { ...payload(), roleId: await predefinedRoleIdOf(h.em(), OTHER_TEST_ORGANIZATION_ID, 'member') },
    });
    expect(crossTenant.statusCode).toBe(404);
  });

  it('changes a member’s role by id under customers:manage alone, through customer_account.change_role', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `${base}/members/${TEST_CUSTOMER_RFQ_ID}/role`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { roleId: administratorRoleId },
    });
    expect(res.statusCode, res.body).toBe(200);
    const member = (res.json() as { data: Member }).data;
    expect(member).not.toHaveProperty('role');
    expect(member.organizationRole).toEqual({ id: administratorRoleId, kind: 'administrator', name: 'Administrator' });

    const entries = (await h.em().execute(
      `select "object_type", "object_id", "actor_admin_user_id" from "audit_log_entries"
        where "action" = 'customer_account.change_role' and "state_after"->>'customerAccountId' = ?
        order by "acted_at" desc limit 1`,
      [TEST_CUSTOMER_RFQ_ID],
    )) as Array<{ object_type: string; object_id: string; actor_admin_user_id: string }>;
    expect(entries[0]).toMatchObject({ object_type: 'organization', object_id: TEST_ORGANIZATION_ID });
    expect(entries[0]!.actor_admin_user_id, 'the audit entry names the operator').toBe(ADMIN_COOKIES[CUSTOMERS_ONLY]!.adminUserId);

    const back = await h.app.inject({
      method: 'PATCH',
      url: `${base}/members/${TEST_CUSTOMER_RFQ_ID}/role`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { roleId: memberRoleId },
    });
    expect(back.statusCode, back.body).toBe(200);

    const legacy = await h.app.inject({
      method: 'PATCH',
      url: `${base}/members/${TEST_CUSTOMER_RFQ_ID}/role`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { role: 'organization_admin' },
    });
    expect(legacy.statusCode).toBe(400);

    const crossTenant = await h.app.inject({
      method: 'PATCH',
      url: `${base}/members/${TEST_CUSTOMER_RFQ_ID}/role`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { roleId: await predefinedRoleIdOf(h.em(), OTHER_TEST_ORGANIZATION_ID, 'administrator') },
    });
    expect(crossTenant.statusCode).toBe(404);
    expect((crossTenant.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('recovers administrator access through customer_account.change_role', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `${base}/recover-admin-access`,
      cookies: { b2b_session: CUSTOMERS_ONLY },
      payload: { promoteCustomerAccountId: TEST_CUSTOMER_EMPTY_ID },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Member }).data.organizationRole).toMatchObject({ id: administratorRoleId, kind: 'administrator' });
    const entries = (await h.em().execute(
      `select count(*)::int as n from "audit_log_entries"
        where "action" = 'customer_account.change_role' and "state_after"->>'customerAccountId' = ?`,
      [TEST_CUSTOMER_EMPTY_ID],
    )) as Array<{ n: number }>;
    expect(entries[0]!.n).toBeGreaterThanOrEqual(1);
    await assignOrganizationRole(h.em(), TEST_CUSTOMER_EMPTY_ID, memberRoleId);
  });

  it('embeds members with organizationRole on the Organization detail', async () => {
    const res = await h.app.inject({ method: 'GET', url: base, cookies: { b2b_session: CUSTOMERS_ONLY } });
    expect(res.statusCode, res.body).toBe(200);
    const detail = (res.json() as { data: { members: Member[]; predefinedRoles: unknown[] } }).data;
    const members = detail.members;
    // `contracts/operator-api.md` §5 — the two predefined roles, for an operator who cannot read the role list.
    expect(detail.predefinedRoles).toEqual([
      { id: administratorRoleId, kind: 'administrator', name: 'Administrator' },
      { id: memberRoleId, kind: 'member', name: 'Member' },
    ]);
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(member).not.toHaveProperty('role');
      expect(organizationRoleRefSchema.safeParse(member.organizationRole).success).toBe(true);
    }
  });

  it('impersonation names the member’s role, and the member’s permissions apply', async () => {
    await holdCustomRole(h.em(), {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_CUSTOMER_RFQ_ID,
      permissions: [],
      name: `No addresses ${randomUUID().slice(0, 6)}`,
    });
    dropOrganizationRoleCache(h, TEST_ORGANIZATION_ID);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${TEST_CUSTOMER_RFQ_ID}/impersonate`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { reason: '170 WP-03' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const impersonated = (res.json() as { data: { impersonatedCustomerAccount: Member } }).data.impersonatedCustomerAccount;
    expect(impersonated).not.toHaveProperty('role');
    expect(organizationRoleRefSchema.parse(impersonated.organizationRole)).toMatchObject({ kind: 'custom' });

    const raw = String(res.headers['set-cookie']);
    const cookie = decodeURIComponent(/b2b_session=([^;]+)/.exec(raw)![1]!);
    const write = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/addresses',
      cookies: { b2b_session: cookie },
      payload: { kind: 'delivery', recipientName: 'X', street: 'Y 1', city: 'Z', postalCode: '00-001', country: 'PL' },
    });
    expect(write.statusCode, 'the operator acts with exactly the member’s permissions').toBe(403);
    expect((write.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
  });
});
