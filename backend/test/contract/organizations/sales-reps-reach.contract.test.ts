import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  AdminRole,
  AdminUser,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Issue #856 — `GET /admin/organizations/:organizationId/sales-reps` answers
 * only for an Organization the acting administrator may see.
 *
 * The route checked only that the Organization existed, so a sales
 * representative holding `organizations:assign-sales-rep` could read who is
 * assigned to an Organization **assigned to another representative** — names
 * and e-mail addresses of staff included. It now answers by the rule every
 * `/admin/organizations/:id` route answers by since #698 (PR #847): a
 * platform-wide scope sees every Organization; a representative sees one
 * assigned to them (under `organizations:rollup`, one whose nearest assigned
 * ancestor is theirs) or one nobody is assigned to (owner ruling D-3W; which
 * rule is the platform's is issue #305). Anything else is the same
 * `404 NOT_FOUND` as an unknown id.
 */
describe('GET /admin/organizations/:organizationId/sales-reps — the administrator’s reach (#856)', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-9);
  const REP = `stub-org-856-rep-${stamp}`;
  const PLATFORM = 'stub-admin-session';
  const UNKNOWN = '00000000-0000-4000-8000-00000000dead';
  const adminIds: string[] = [];
  let roleId: string;
  let rolePermissionsBefore: string[] | null = null;
  let ownOrgId: string;
  let childOrgId: string;
  /** Assigned to another representative. */
  let foreignOrgId: string;
  /** Nobody is assigned to it. */
  let unassignedOrgId: string;
  let otherRepEmail: string;

  const salesReps = (organizationId: string, session: string) =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${organizationId}/sales-reps`,
      cookies: { b2b_session: session },
    });
  const expectNotFound = (res: { statusCode: number; body: string; json: () => unknown }): void => {
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  };
  const assignedIds = (res: { json: () => unknown }): string[] =>
    (res.json() as { data: Array<{ adminUserId: string }> }).data.map((row) => row.adminUserId);

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('#856: a roll-up sales representative of one organisation tree', async () => {
      const fork = h.orm.em.fork();
      let role = await fork.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['organizations:assign-sales-rep', 'organizations:rollup'];
      if (!role) {
        role = fork.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        rolePermissionsBefore = [...role.permissions];
        role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      }
      await fork.persistAndFlush(role);
      roleId = role.id;
      const org = (label: string, parent?: Organization): Organization =>
        fork.create(Organization, {
          name: `Reps reach ${stamp} ${label}`,
          taxId: `PL856${label.slice(0, 1).toUpperCase()}${stamp}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-856', country: 'PL' },
          ...(parent ? { parentId: parent.id } : {}),
        });
      const own = org('own');
      await fork.persistAndFlush(own);
      own.path = `/${own.id}/`;
      const child = org('child', own);
      await fork.persistAndFlush(child);
      child.path = `${own.path}${child.id}/`;
      const foreign = org('foreign');
      await fork.persistAndFlush(foreign);
      foreign.path = `/${foreign.id}/`;
      const unassigned = org('unassigned');
      await fork.persistAndFlush(unassigned);
      unassigned.path = `/${unassigned.id}/`;
      const admin = (label: string): AdminUser =>
        fork.create(AdminUser, {
          email: `org-856-${label}-${stamp}@scope.local`,
          passwordHash: 'x'.repeat(60),
          adminRoleId: role!.id,
          firstName: '856',
          lastName: label,
        });
      const otherRep = admin('other');
      const rep = admin('rep');
      await fork.persistAndFlush([otherRep, rep]);
      await fork.persistAndFlush([
        fork.create(OrganizationSalesRepAssignment, { organizationId: foreign.id, adminUserId: otherRep.id }),
        fork.create(OrganizationSalesRepAssignment, { organizationId: own.id, adminUserId: rep.id }),
      ]);
      adminIds.push(otherRep.id, rep.id);
      otherRepEmail = otherRep.email;
      ownOrgId = own.id;
      childOrgId = child.id;
      foreignOrgId = foreign.id;
      unassignedOrgId = unassigned.id;
      ADMIN_COOKIES[REP] = { adminUserId: rep.id };
    });
  }, 60_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[REP];
    for (const adminUserId of adminIds) {
      await h
        .em()
        .getConnection()
        .execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [adminUserId]);
    }
    if (rolePermissionsBefore !== null) {
      const before = rolePermissionsBefore;
      await withSystemScope('#856: restore the sales representative role', async () => {
        const fork = h.orm.em.fork();
        const role = await fork.findOneOrFail(AdminRole, { id: roleId });
        role.permissions = before;
        await fork.flush();
      });
    }
    await teardownBackendServer(h);
  });

  it('answers for an Organization assigned to the representative', async () => {
    const res = await salesReps(ownOrgId, REP);
    expect(res.statusCode, res.body).toBe(200);
    expect(assignedIds(res)).toEqual([adminIds[1]]);
  });

  it('answers for a roll-up descendant of it', async () => {
    const res = await salesReps(childOrgId, REP);
    expect(res.statusCode, res.body).toBe(200);
  });

  // D-3W, issue #305 — the unassigned fallback.
  it('answers for an Organization nobody is assigned to', async () => {
    const res = await salesReps(unassignedOrgId, REP);
    expect(res.statusCode, res.body).toBe(200);
    expect(assignedIds(res)).toEqual([]);
  });

  it('answers 404 NOT_FOUND for an Organization assigned to another representative, naming nobody', async () => {
    const res = await salesReps(foreignOrgId, REP);
    expectNotFound(res);
    expect(res.body).not.toContain(otherRepEmail);
    expect(res.body).not.toContain(adminIds[0]);
  });

  it('answers the same 404 for an Organization that does not exist', async () => {
    expectNotFound(await salesReps(UNKNOWN, REP));
  });

  it('still answers a platform administrator for that Organization', async () => {
    const res = await salesReps(foreignOrgId, PLATFORM);
    expect(res.statusCode, res.body).toBe(200);
    expect(assignedIds(res)).toEqual([adminIds[0]]);
  });

  it('answers a platform administrator 404 NOT_FOUND for an Organization that does not exist', async () => {
    expectNotFound(await salesReps(UNKNOWN, PLATFORM));
  });
});
