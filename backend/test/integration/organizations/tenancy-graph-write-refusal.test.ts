import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminRole,
  AdminUser,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import {
  ADMIN_COOKIES,
  OTHER_TEST_ORGANIZATION_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * D-260 track B item 1 — the tenancy-graph writes require `mode: 'all'`.
 *
 * Host-owned under D-252: it composes a server, so it travels with the host
 * rather than into the package.
 *
 * Three routes wrote the tenancy graph behind nothing but a `requireAdmin(...)`
 * code, and two of them are self-amplifying. A `sales_representative` resolves
 * to `allowed-set` on **every** admin request it makes
 * (`orders/src/backend/index.ts:441` feeding `backend/src/composition.ts`), and
 * `Organization` / `OrganizationSalesRepAssignment` are both `@GlobalEntity` —
 * correctly, under D-259 category 2, because the assignment table is the one
 * that *defines* `allowed-set` and `@OrgScoped` would be circular. So no filter
 * narrowed these reads and no classification could:
 *
 * - `POST /admin/organizations/:organizationId/sales-reps` let the actor assign
 *   **itself** to any organization, widening its own `allowedOrganizationIds`;
 * - `POST /admin/organizations/:id/parent` let it hang a foreign organization
 *   under one it already holds, which feature 056's roll-up
 *   (`sales-rep-assignment-service.ts:110-141`) then expands into the same
 *   widening;
 * - `DELETE .../sales-reps/:adminUserId` let it strip a foreign organization's
 *   representative.
 *
 * "The scoped role does not hold `organizations:assign-sales-rep` /
 * `customers:manage`" is not a boundary: `PUT /admin/admin-roles/:code` upserts
 * an arbitrary permission array onto any role by code, and the seed that grants
 * the scoped role its codes (`admin_roles/demo/rows.ts`) is a demo fixture. The
 * `beforeAll` below therefore grants both codes rather than assuming them —
 * that is the operator's discretion, modelled.
 *
 * Each refusal is asserted **through the real routes with a real scoped
 * session**: the suite's own EM sits in `mode: 'system'`, so a direct-EM
 * assertion would prove nothing (D-259). `withSystemScope` is load-bearing only
 * where a row's survival is read back.
 *
 * Every case is paired with the platform admin (`mode: 'all'`) still
 * succeeding. A repair that refuses everybody is not a repair.
 */

const SALES_REPS_URL = (orgId: string) => `/api/v1/admin/organizations/${orgId}/sales-reps`;
const PARENT_URL = (orgId: string) => `/api/v1/admin/organizations/${orgId}/parent`;
/** The reverse listing is the actor's own allowed set, read through a route. */
const ASSIGNED_ORGS_URL = (adminUserId: string) =>
  `/api/v1/admin/sales-reps/${adminUserId}/organizations`;

interface AssignedOrgsBody {
  data: Array<{ organizationId: string }>;
}

describe('organizations — tenancy-graph writes require mode: all [D-260]', () => {
  let h: BackendServerHandle;
  let scopedCookie = '';
  let repId = '';
  let foreignRepId = '';
  const platformAdmin = { cookies: { b2b_session: 'stub-admin-session' } };

  /** The actor's own `allowedOrganizationIds`, as the resolver computes it. */
  const allowedOrganizationIdsOf = async (adminUserId: string): Promise<string[]> => {
    const listed = await h.app.inject({
      method: 'GET',
      url: ASSIGNED_ORGS_URL(adminUserId),
      ...platformAdmin,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    return (listed.json() as AssignedOrgsBody).data.map((row) => row.organizationId);
  };

  beforeAll(async () => {
    h = await setupBackendServer();

    await withSystemScope('seed org B, a scoped rep on org A only, and org B rep', async () => {
      const em = h.em();
      await seedOtherTestOrganization(em);

      // Both shared fixtures are created straight through the EM, so they carry
      // `Organization.path`'s default `''` — the tree service is what normally
      // writes it. `assertNoCycle` compares `newParent.path.startsWith(node.path)`,
      // and `''.startsWith('')` is true, so *every* pair of seeded roots refuses
      // as a cycle before any authorisation is reached. Give both the path a
      // root would have, so the re-parent below measures the gate and not the
      // fixture.
      for (const id of [TEST_ORGANIZATION_ID, OTHER_TEST_ORGANIZATION_ID]) {
        const org = await em.findOne(Organization, { id });
        if (org && org.path === '') org.path = `/${id}/`;
      }
      await em.flush();

      const codes = ['organizations:assign-sales-rep', 'customers:manage'];
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, {
          code: 'sales_representative',
          name: 'Sales Representative',
          permissions: codes,
        });
      } else {
        const missing = codes.filter((code) => !role!.permissions.includes(code));
        if (missing.length > 0) role.permissions = [...role.permissions, ...missing];
      }
      await em.persistAndFlush(role);

      const rep = em.create(AdminUser, {
        email: `d260-tenancy-graph-rep-${Date.now()}@i.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: 'D260',
        lastName: 'ScopedRep',
      });
      // A second admin, so the platform-admin fence can write the graph
      // without disturbing the actor whose escalation this file measures.
      const foreignRep = em.create(AdminUser, {
        email: `d260-tenancy-graph-foreign-${Date.now()}@i.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: 'D260',
        lastName: 'ForeignRep',
      });
      await em.persistAndFlush([rep, foreignRep]);
      repId = rep.id;
      foreignRepId = foreignRep.id;

      await em.persistAndFlush(
        em.create(OrganizationSalesRepAssignment, {
          organizationId: TEST_ORGANIZATION_ID,
          adminUserId: rep.id,
        }),
      );
      await em.persistAndFlush(
        em.create(OrganizationSalesRepAssignment, {
          organizationId: OTHER_TEST_ORGANIZATION_ID,
          adminUserId: foreignRep.id,
        }),
      );

      scopedCookie = `stub-d260-tenancy-graph-${Date.now()}`;
      ADMIN_COOKIES[scopedCookie] = { adminUserId: rep.id };
    });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a scoped admin assigning itself to a foreign organization, and its allowed set does not widen', async () => {
    const before = await allowedOrganizationIdsOf(repId);
    expect(before).toEqual([TEST_ORGANIZATION_ID]);

    const assigned = await h.app.inject({
      method: 'POST',
      url: SALES_REPS_URL(OTHER_TEST_ORGANIZATION_ID),
      cookies: { b2b_session: scopedCookie },
      payload: { adminUserId: repId },
    });
    expect(assigned.statusCode, assigned.body).toBe(403);
    expect((assigned.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    // The escalation itself, asserted directly: the actor's own authority.
    expect(await allowedOrganizationIdsOf(repId)).toEqual([TEST_ORGANIZATION_ID]);
    await withSystemScope('no assignment row was created for org B', async () => {
      const row = await h
        .em()
        .findOne(OrganizationSalesRepAssignment, {
          organizationId: OTHER_TEST_ORGANIZATION_ID,
          adminUserId: repId,
        });
      expect(row).toBeNull();
    });
  });

  it('refuses a scoped admin assigning a rep to its own organization too — the graph is not an operation inside the boundary', async () => {
    const assigned = await h.app.inject({
      method: 'POST',
      url: SALES_REPS_URL(TEST_ORGANIZATION_ID),
      cookies: { b2b_session: scopedCookie },
      payload: { adminUserId: foreignRepId },
    });
    expect(assigned.statusCode, assigned.body).toBe(403);

    await withSystemScope('org A gained no second rep', async () => {
      const row = await h
        .em()
        .findOne(OrganizationSalesRepAssignment, {
          organizationId: TEST_ORGANIZATION_ID,
          adminUserId: foreignRepId,
        });
      expect(row).toBeNull();
    });
  });

  it("refuses a scoped admin unassigning a foreign organization's representative", async () => {
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `${SALES_REPS_URL(OTHER_TEST_ORGANIZATION_ID)}/${foreignRepId}`,
      cookies: { b2b_session: scopedCookie },
    });
    expect(removed.statusCode, removed.body).toBe(403);

    await withSystemScope("org B's assignment survived", async () => {
      const row = await h
        .em()
        .findOne(OrganizationSalesRepAssignment, {
          organizationId: OTHER_TEST_ORGANIZATION_ID,
          adminUserId: foreignRepId,
        });
      expect(row).not.toBeNull();
    });
  });

  it('refuses a scoped admin re-parenting a foreign organization under one it holds', async () => {
    const reparented = await h.app.inject({
      method: 'POST',
      url: PARENT_URL(OTHER_TEST_ORGANIZATION_ID),
      cookies: { b2b_session: scopedCookie },
      payload: { parentId: TEST_ORGANIZATION_ID },
    });
    expect(reparented.statusCode, reparented.body).toBe(403);
    expect((reparented.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    await withSystemScope('org B is still a root', async () => {
      const org = await h.em().findOne(Organization, { id: OTHER_TEST_ORGANIZATION_ID });
      expect(org?.parentId ?? null).toBeNull();
    });
    expect(await allowedOrganizationIdsOf(repId)).toEqual([TEST_ORGANIZATION_ID]);
  });

  it('lets a platform admin (mode: all) still write the whole graph [the widening must not be lost]', async () => {
    const assigned = await h.app.inject({
      method: 'POST',
      url: SALES_REPS_URL(TEST_ORGANIZATION_ID),
      ...platformAdmin,
      payload: { adminUserId: foreignRepId },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `${SALES_REPS_URL(TEST_ORGANIZATION_ID)}/${foreignRepId}`,
      ...platformAdmin,
    });
    expect(removed.statusCode, removed.body).toBe(204);

    const reparented = await h.app.inject({
      method: 'POST',
      url: PARENT_URL(OTHER_TEST_ORGANIZATION_ID),
      ...platformAdmin,
      payload: { parentId: TEST_ORGANIZATION_ID },
    });
    expect(reparented.statusCode, reparented.body).toBe(200);
    expect(
      (reparented.json() as { data: { parentId: string | null } }).data.parentId,
    ).toBe(TEST_ORGANIZATION_ID);

    // Restore: the harness shares one database across files, and org B being a
    // child of org A is not this file's fixture to leave behind.
    const detached = await h.app.inject({
      method: 'POST',
      url: PARENT_URL(OTHER_TEST_ORGANIZATION_ID),
      ...platformAdmin,
      payload: { parentId: null },
    });
    expect(detached.statusCode, detached.body).toBe(200);
  });
});
