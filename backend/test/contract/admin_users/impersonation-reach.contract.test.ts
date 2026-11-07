import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Issue #856 — `POST /admin/organizations/:id/impersonate` refuses a sales
 * representative a member of an Organization assigned to another
 * representative.
 *
 * The route names the Organization in its path and the member in its body, and
 * reads the member through `CustomerAccount`, which is `@OrgScoped`: the
 * representative's request scope is the set of Organizations assigned to them,
 * so the tenant filter answers that member as absent. This file pins that
 * answer — `404 CUSTOMER_NOT_FOUND`, the same as an unknown member (issue #814)
 * — with no impersonation session and no `impersonation.start` audit row, and
 * pins beside it that a member of the representative's own Organization is
 * still impersonated, so the refusal is about reach and not about the role.
 */
describe('POST /admin/organizations/:id/impersonate — the representative’s reach (#856)', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-9);
  const REP = `stub-imp-856-rep-${stamp}`;
  const adminIds: string[] = [];
  let roleId: string;
  let rolePermissionsBefore: string[] | null = null;
  let ownOrgId: string;
  let ownMemberId: string;
  /** Assigned to another representative. */
  let foreignOrgId: string;
  let foreignMemberId: string;

  const impersonate = (organizationId: string, customerAccountId: string, session: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organizationId}/impersonate`,
      payload: { customerAccountId, reason: 'issue #856' },
      cookies: { b2b_session: session },
    });
  const startRows = (customerAccountId: string) =>
    h.em().fork().count(AuditLogEntry, {
      action: 'impersonation.start',
      impersonatedCustomerAccountId: customerAccountId,
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('#856: a sales representative who may impersonate', async () => {
      const fork = h.orm.em.fork();
      let role = await fork.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['customers:read', 'customers:impersonate'];
      if (!role) {
        role = fork.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        rolePermissionsBefore = [...role.permissions];
        role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      }
      await fork.persistAndFlush(role);
      roleId = role.id;
      const org = (label: string): Organization =>
        fork.create(Organization, {
          name: `Impersonation reach ${stamp} ${label}`,
          taxId: `PL856I${label.slice(0, 1).toUpperCase()}${stamp}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-856', country: 'PL' },
        });
      const own = org('own');
      const foreign = org('foreign');
      await fork.persistAndFlush([own, foreign]);
      own.path = `/${own.id}/`;
      foreign.path = `/${foreign.id}/`;
      const member = (label: string, organizationId: string): CustomerAccount =>
        fork.create(CustomerAccount, {
          organizationId,
          email: `imp-856-${label}-${stamp}@example.test`,
          passwordHash: 'x'.repeat(60),
          firstName: 'Imp',
          lastName: label,
        });
      const ownMember = member('own', own.id);
      const foreignMember = member('foreign', foreign.id);
      const admin = (label: string): AdminUser =>
        fork.create(AdminUser, {
          email: `imp-856-${label}-${stamp}@scope.local`,
          passwordHash: 'x'.repeat(60),
          adminRoleId: role!.id,
          firstName: '856',
          lastName: label,
        });
      const otherRep = admin('other');
      const rep = admin('rep');
      await fork.persistAndFlush([ownMember, foreignMember, otherRep, rep]);
      await fork.persistAndFlush([
        fork.create(OrganizationSalesRepAssignment, { organizationId: foreign.id, adminUserId: otherRep.id }),
        fork.create(OrganizationSalesRepAssignment, { organizationId: own.id, adminUserId: rep.id }),
      ]);
      adminIds.push(otherRep.id, rep.id);
      ownOrgId = own.id;
      ownMemberId = ownMember.id;
      foreignOrgId = foreign.id;
      foreignMemberId = foreignMember.id;
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

  it('refuses a member of an Organization assigned to another representative: 404, no session, no audit row', async () => {
    const res = await impersonate(foreignOrgId, foreignMemberId, REP);
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CUSTOMER_NOT_FOUND);
    expect(res.body).not.toContain(`imp-856-foreign-${stamp}`);
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain('admin_shadow_session=');
    expect(await startRows(foreignMemberId)).toBe(0);
  });

  it('refuses that member named under the representative’s own Organization as well', async () => {
    const res = await impersonate(ownOrgId, foreignMemberId, REP);
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CUSTOMER_NOT_FOUND);
    expect(await startRows(foreignMemberId)).toBe(0);
  });

  it('impersonates a member of the representative’s own Organization', async () => {
    const res = await impersonate(ownOrgId, ownMemberId, REP);
    expect(res.statusCode, res.body).toBe(200);
    expect(await startRows(ownMemberId)).toBe(1);
  });
});
