import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  organizationOwnRoleResponseSchema,
  organizationPermissionCatalogueResponseSchema,
  organizationRoleListResponseSchema,
  organizationRoleResponseSchema,
  type OrganizationRoleView,
} from '@endora-commerce/contracts';
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
import { seedRoleScopingFixture } from '../../helpers/seed-roles.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';

/**
 * The storefront role routes (`specs/170-organization-roles/` WP-02a, T028;
 * `contracts/storefront-api.md` §2; FR-004, FR-005, FR-008, FR-010, FR-010a,
 * FR-058, FR-073).
 *
 * Guards: `requireCustomer` plus the administrator-kind role, refused with the
 * existing `403 FORBIDDEN` — role management is a reserved capability, not a
 * permission (research R-20). A personal Organization answers `404` (spec *Edge
 * Cases*; owner ruling PR-3, R-34); another Organization's role id answers
 * `404` (Principle XI existence rule). Every request body is strict, so a body
 * still sending `role` is `400`.
 *
 * `stub-customer-session` is `TEST_ORGANIZATION_ID`'s administrator and
 * `stub-regular-user-session` its regular user (seeded below).
 */

const ADMIN = { b2b_session: 'stub-customer-session' };
const REGULAR = { b2b_session: 'stub-regular-user-session' };
const PERSONAL_COOKIE = 'stub-roles-personal-session';

describe('storefront organization roles', () => {
  let h: BackendServerHandle;
  let otherOrgMemberRoleId: string;

  async function list(cookies = ADMIN, language = 'en'): Promise<OrganizationRoleView[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/organizations/mine/roles',
      cookies,
      headers: { 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return organizationRoleListResponseSchema.parse(res.json()).data;
  }

  async function create(name: string, permissions: string[] = []): Promise<OrganizationRoleView> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/roles',
      cookies: ADMIN,
      payload: { name, permissions },
    });
    expect(res.statusCode, res.body).toBe(201);
    return organizationRoleResponseSchema.parse(res.json()).data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await seedRoleScopingFixture(em);
    await seedOtherTestOrganization(em);
    const [row] = (await em.getConnection().execute(
      `select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'member'`,
      [OTHER_TEST_ORGANIZATION_ID],
    )) as Array<{ id: string }>;
    otherOrgMemberRoleId = row!.id;

    // A personal Organization whose sole member is its administrator.
    const personalOrg = randomUUID();
    const personalAccount = randomUUID();
    await em.getConnection().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","is_personal","created_at","updated_at")
       values (?, 'Personal roles test', ?, 'active', 'vat_payer', '{}'::jsonb, ?, true, now(), now())`,
      [personalOrg, `personal-${personalOrg.slice(0, 13)}`, `/${personalOrg}/`],
    );
    await em.getConnection().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Per', 'Sonal', now(), now())`,
      [personalAccount, personalOrg, `${personalAccount.slice(0, 8)}@roles-personal.example`],
    );
    // Feature 154 — an Organization with no sales channel may not use the store at all.
    await bindOrganizationsToFixtureChannelsSql(em, [personalOrg]);
    CUSTOMER_COOKIES[PERSONAL_COOKIE] = { customerAccountId: personalAccount, organizationId: personalOrg };
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[PERSONAL_COOKIE];
    await teardownBackendServer(h);
  });

  describe('GET /api/v1/organizations/mine/roles', () => {
    it('lists the predefined roles first, named in the request language (FR-001, FR-003, FR-008)', async () => {
      const en = await list(ADMIN, 'en');
      expect(en.slice(0, 2).map((r) => [r.kind, r.name])).toEqual([
        ['administrator', 'Administrator'],
        ['member', 'Member'],
      ]);
      const pl = await list(ADMIN, 'pl');
      expect(pl.slice(0, 2).map((r) => r.kind)).toEqual(['administrator', 'member']);
      expect(pl[1]!.name).not.toBe('Member');
    });

    it('counts the members holding each predefined role', async () => {
      const roles = await list();
      const admin = roles.find((r) => r.kind === 'administrator')!;
      const member = roles.find((r) => r.kind === 'member')!;
      expect(admin.memberCount).toBeGreaterThanOrEqual(1);
      expect(member.memberCount).toBeGreaterThanOrEqual(1);
    });

    it('counts pending invitations only — not accepted, revoked or expired (FR-010a, PR-7)', async () => {
      const em = h.em();
      const role = await create(`Invitees ${randomUUID().slice(0, 6)}`);
      const day = 24 * 60 * 60 * 1000;
      const states: Array<[Date, Date | null, Date | null]> = [
        [new Date(Date.now() + 7 * day), null, null], // pending
        [new Date(Date.now() - day), null, null], // expired
        [new Date(Date.now() + 7 * day), new Date(), null], // accepted
        [new Date(Date.now() + 7 * day), null, new Date()], // revoked
      ];
      for (const [expiresAt, consumedAt, revokedAt] of states) {
        const id = randomUUID();
        await em.getConnection().execute(
          `insert into "organization_invitations"
             ("id","organization_id","email","organization_role_id","token_hash","expires_at",
              "consumed_at","revoked_at","created_at","updated_at")
           values (?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
          [id, TEST_ORGANIZATION_ID, `${id.slice(0, 8)}@roles-pending.example`, role.id, `h-${id}`, expiresAt, consumedAt, revokedAt],
        );
      }
      const listed = (await list()).find((r) => r.id === role.id)!;
      expect(listed.pendingInvitationCount).toBe(1);
      expect(listed.memberCount).toBe(0);
    });

    it('refuses a member who is not an administrator with 403 FORBIDDEN (FR-010)', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/roles', cookies: REGULAR });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('refuses a visitor with no session with 401', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/roles' });
      expect(res.statusCode).toBe(401);
    });

    it('answers 404 for a personal Organization (PR-3)', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/organizations/mine/roles',
        cookies: { b2b_session: PERSONAL_COOKIE },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST, GET :id, PATCH, DELETE', () => {
    it('creates, reads, edits and deletes a custom role', async () => {
      const created = await create(`Buyers ${randomUUID().slice(0, 6)}`);
      expect(created).toMatchObject({ kind: 'custom', version: 1, memberCount: 0, pendingInvitationCount: 0 });

      const read = await h.app.inject({ method: 'GET', url: `/api/v1/organizations/mine/roles/${created.id}`, cookies: ADMIN });
      expect(read.statusCode).toBe(200);
      expect(organizationRoleResponseSchema.parse(read.json()).data.id).toBe(created.id);

      const patched = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/roles/${created.id}`,
        cookies: ADMIN,
        payload: { expectedVersion: 1, description: 'They buy' },
      });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(organizationRoleResponseSchema.parse(patched.json()).data).toMatchObject({ description: 'They buy', version: 2 });

      const stale = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/roles/${created.id}`,
        cookies: ADMIN,
        payload: { expectedVersion: 1, description: 'Again' },
      });
      expect(stale.statusCode).toBe(409);
      expect((stale.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_ROLE_STALE);

      const deleted = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/mine/roles/${created.id}`,
        cookies: ADMIN,
        payload: { expectedVersion: 2 },
      });
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(deleted.json()).toEqual({ data: { reassignedMembers: 0, reassignedInvitations: 0 } });

      const gone = await h.app.inject({ method: 'GET', url: `/api/v1/organizations/mine/roles/${created.id}`, cookies: ADMIN });
      expect(gone.statusCode).toBe(404);
    });

    it('audits a storefront administrator’s change against the Organization, naming the member (FR-065, R-21, R-32)', async () => {
      const created = await create(`Audited ${randomUUID().slice(0, 6)}`);
      const rows = (await h.em().getConnection().execute(
        `select "action","object_type","object_id","actor_customer_account_id","state_after"
           from "audit_log_entries" where "action" = 'organization_role.create' and "object_id" = ?
          order by "acted_at" desc limit 5`,
        [TEST_ORGANIZATION_ID],
      )) as Array<{ object_type: string; actor_customer_account_id: string | null; state_after: { role: { id: string } } }>;
      const entry = rows.find((r) => r.state_after?.role?.id === created.id);
      expect(entry).toMatchObject({ object_type: 'organization', actor_customer_account_id: CUSTOMER_COOKIES['stub-customer-session']!.customerAccountId });
    });

    it('refuses a duplicate name and a predefined label (FR-004)', async () => {
      const name = `Dupes ${randomUUID().slice(0, 6)}`;
      await create(name);
      for (const taken of [name.toUpperCase(), 'member', 'Administrator']) {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/organizations/mine/roles',
          cookies: ADMIN,
          payload: { name: taken, permissions: [] },
        });
        expect(res.statusCode).toBe(409);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_ROLE_NAME_TAKEN);
      }
    });

    it('refuses a code outside the vocabulary with 422 ORGANIZATION_PERMISSION_UNKNOWN', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/mine/roles',
        cookies: ADMIN,
        payload: { name: `Unknown ${randomUUID().slice(0, 6)}`, permissions: ['carts.teleport'] },
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_UNKNOWN);
    });

    it('protects the predefined roles (US 6.3)', async () => {
      const roles = await list();
      const admin = roles.find((r) => r.kind === 'administrator')!;
      const member = roles.find((r) => r.kind === 'member')!;
      const attempts = [
        { method: 'PATCH' as const, id: admin.id, payload: { expectedVersion: admin.version, permissions: [] } },
        { method: 'PATCH' as const, id: member.id, payload: { expectedVersion: member.version, name: 'Staff' } },
        { method: 'DELETE' as const, id: member.id, payload: { expectedVersion: member.version } },
        { method: 'DELETE' as const, id: admin.id, payload: { expectedVersion: admin.version } },
      ];
      for (const attempt of attempts) {
        const res = await h.app.inject({
          method: attempt.method,
          url: `/api/v1/organizations/mine/roles/${attempt.id}`,
          cookies: ADMIN,
          payload: attempt.payload,
        });
        expect(res.statusCode, `${attempt.method} ${res.body}`).toBe(409);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORGANIZATION_ROLE_PROTECTED);
      }
    });

    it("answers 404 for another Organization's role, on every verb (FR-005)", async () => {
      const verbs = [
        { method: 'GET' as const },
        { method: 'PATCH' as const, payload: { expectedVersion: 1, permissions: [] } },
        { method: 'DELETE' as const, payload: { expectedVersion: 1 } },
      ];
      for (const verb of verbs) {
        const res = await h.app.inject({
          method: verb.method,
          url: `/api/v1/organizations/mine/roles/${otherOrgMemberRoleId}`,
          cookies: ADMIN,
          ...(verb.payload ? { payload: verb.payload } : {}),
        });
        expect(res.statusCode, `${verb.method} ${res.body}`).toBe(404);
      }
    });

    it('refuses a body that still sends the legacy `role` with 400 (FR-073, R-24)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/mine/roles',
        cookies: ADMIN,
        payload: { name: 'Legacy', permissions: [], role: 'regular_user' },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('refuses every write to a member who is not an administrator, before validation', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/mine/roles',
        cookies: REGULAR,
        payload: { name: 'Sneaky', permissions: [] },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/organizations/mine/permission-catalogue', () => {
    it('answers the present codes grouped by module, for administrators only', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/permission-catalogue', cookies: ADMIN });
      expect(res.statusCode).toBe(200);
      organizationPermissionCatalogueResponseSchema.parse(res.json());

      const refused = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/permission-catalogue', cookies: REGULAR });
      expect(refused.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/organizations/mine/role (FR-058)', () => {
    it('answers every member their own role', async () => {
      const mine = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/role', cookies: REGULAR });
      expect(mine.statusCode, mine.body).toBe(200);
      expect(organizationOwnRoleResponseSchema.parse(mine.json()).data.role).toMatchObject({ kind: 'member', name: 'Member' });

      const admin = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/role', cookies: ADMIN });
      expect(organizationOwnRoleResponseSchema.parse(admin.json()).data.role.kind).toBe('administrator');
    });
  });
});
