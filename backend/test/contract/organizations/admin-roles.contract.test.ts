import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  organizationPermissionCatalogueResponseSchema,
  organizationRoleListResponseSchema,
  organizationRoleResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES, TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * The operator role routes (`specs/170-organization-roles/` WP-02a, T028;
 * `contracts/operator-api.md` §1–§2; owner ruling OR-7; FR-060, FR-061, FR-065).
 *
 * `organizations:read-roles` reads, `organizations:manage-roles` writes, and a
 * role holding neither is refused `403`. The same Commands serve the storefront;
 * the actor comes from the ambient context, so the audit entry names the
 * operator. A personal Organization answers `404`.
 */

const PLATFORM_ADMIN = { b2b_session: 'stub-admin-session' };
const READER = 'stub-org-roles-reader-session';
const NOBODY = 'stub-org-roles-nobody-session';

describe('operator organization roles', () => {
  let h: BackendServerHandle;
  let personalOrganizationId: string;

  const base = `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const stamp = randomUUID().slice(0, 8);
    await withSystemScope('170 WP-02a: operators holding one role code, or none', async () => {
      const fork = h.orm.em.fork();
      const readerRole = fork.create(AdminRole, {
        code: `org_roles_reader_${stamp}`,
        name: 'Organization roles reader',
        permissions: ['organizations:read-roles'],
      });
      const nobodyRole = fork.create(AdminRole, {
        code: `org_roles_nobody_${stamp}`,
        name: 'Customers only',
        permissions: ['customers:manage'],
      });
      await fork.persistAndFlush([readerRole, nobodyRole]);
      const reader = fork.create(AdminUser, {
        email: `org-roles-reader-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: readerRole.id,
        firstName: 'Roles',
        lastName: 'Reader',
      });
      const nobody = fork.create(AdminUser, {
        email: `org-roles-nobody-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: nobodyRole.id,
        firstName: 'No',
        lastName: 'Roles',
      });
      await fork.persistAndFlush([reader, nobody]);
      ADMIN_COOKIES[READER] = { adminUserId: reader.id };
      ADMIN_COOKIES[NOBODY] = { adminUserId: nobody.id };
    });

    personalOrganizationId = randomUUID();
    await h.em().getConnection().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","is_personal","created_at","updated_at")
       values (?, 'Personal operator roles test', ?, 'active', 'vat_payer', '{}'::jsonb, ?, true, now(), now())`,
      [personalOrganizationId, `personal-${personalOrganizationId.slice(0, 13)}`, `/${personalOrganizationId}/`],
    );
  }, 90_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[READER];
    delete ADMIN_COOKIES[NOBODY];
    await teardownBackendServer(h);
  });

  it('reads the roles and the catalogue with organizations:read-roles', async () => {
    for (const url of [`${base}/roles`, `${base}/permission-catalogue`]) {
      const res = await h.app.inject({ method: 'GET', url, cookies: { b2b_session: READER } });
      expect(res.statusCode, `${url} ${res.body}`).toBe(200);
    }
    const roles = await h.app.inject({ method: 'GET', url: `${base}/roles`, cookies: { b2b_session: READER } });
    expect(organizationRoleListResponseSchema.parse(roles.json()).data.slice(0, 2).map((r) => r.kind)).toEqual([
      'administrator',
      'member',
    ]);
    const catalogue = await h.app.inject({ method: 'GET', url: `${base}/permission-catalogue`, cookies: { b2b_session: READER } });
    organizationPermissionCatalogueResponseSchema.parse(catalogue.json());
  });

  it('refuses writes to a reader, and everything to an operator holding neither code (FR-060, FR-061)', async () => {
    const write = await h.app.inject({
      method: 'POST',
      url: `${base}/roles`,
      cookies: { b2b_session: READER },
      payload: { name: 'Nope', permissions: [] },
    });
    expect(write.statusCode).toBe(403);
    for (const url of [`${base}/roles`, `${base}/permission-catalogue`]) {
      const res = await h.app.inject({ method: 'GET', url, cookies: { b2b_session: NOBODY } });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('creates, edits and deletes with organizations:manage-roles, audited as the operator (FR-065)', async () => {
    const name = `Operator role ${randomUUID().slice(0, 6)}`;
    const created = await h.app.inject({
      method: 'POST',
      url: `${base}/roles`,
      cookies: PLATFORM_ADMIN,
      payload: { name, permissions: [] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const role = organizationRoleResponseSchema.parse(created.json()).data;

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `${base}/roles/${role.id}`,
      cookies: PLATFORM_ADMIN,
      payload: { expectedVersion: role.version, name: `${name} renamed` },
    });
    expect(patched.statusCode, patched.body).toBe(200);

    const deleted = await h.app.inject({
      method: 'DELETE',
      url: `${base}/roles/${role.id}`,
      cookies: PLATFORM_ADMIN,
      payload: { expectedVersion: role.version + 1 },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);

    const entries = (await h.em().getConnection().execute(
      `select "action","object_type","object_id","actor_admin_user_id","actor_customer_account_id"
         from "audit_log_entries" where "object_id" = ? and "action" like 'organization_role.%'
        order by "acted_at"`,
      [TEST_ORGANIZATION_ID],
    )) as Array<{ action: string; object_type: string; actor_admin_user_id: string | null; actor_customer_account_id: string | null }>;
    const mine = entries.filter((e) => e.actor_admin_user_id === TEST_ADMIN_ID).map((e) => e.action);
    expect(mine).toEqual(expect.arrayContaining(['organization_role.create', 'organization_role.update', 'organization_role.delete']));
    for (const entry of entries.filter((e) => e.actor_admin_user_id === TEST_ADMIN_ID)) {
      expect(entry).toMatchObject({ object_type: 'organization', actor_customer_account_id: null });
    }
  });

  it('answers 404 for a personal Organization and for an unknown one', async () => {
    for (const id of [personalOrganizationId, randomUUID()]) {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${id}/roles`, cookies: PLATFORM_ADMIN });
      expect(res.statusCode, id).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
    }
  });

  it('refuses a body that still sends `role` (FR-073)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `${base}/roles`,
      cookies: PLATFORM_ADMIN,
      payload: { name: 'Legacy', permissions: [], role: 'organization_admin' },
    });
    expect(res.statusCode).toBe(400);
  });
});
