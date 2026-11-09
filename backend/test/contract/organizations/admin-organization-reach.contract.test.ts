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
import {
  ADMIN_COOKIES,
  TEST_CUSTOMER_EMPTY_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Issue #698 — the admin Organization `/:id` routes answer only for an
 * Organization the acting administrator may see.
 *
 * `Organization` is a global entity, so no tenant filter narrows its reads: the
 * `/:id` routes checked only that the Organization existed, and a sales
 * representative could open and — holding `customers:manage` — edit, block and
 * delete an Organization **assigned to another representative**. Every `/:id`
 * route now answers such an Organization exactly as one that does not exist,
 * `404 NOT_FOUND`.
 *
 * The rule is the sales-representative visibility rule
 * (`SalesRepAssignmentPort.canSeeOrganization`), per the architect's ruling on
 * PR #847: an Organization assigned to the representative — under
 * `organizations:rollup`, one whose nearest assigned ancestor is theirs — **or
 * one nobody is assigned to** (owner ruling D-3W). A pending registration is
 * unassigned by construction, so a representative still moderates it (D-87).
 * Since issue #305 (owner ruling 2026-11-07) the list narrows to the same rule,
 * so no row of it opens a 404. A platform administrator reaches every
 * Organization, and gets the same 404 for an unknown id on every route.
 */
describe('admin Organization routes — the administrator’s reach (#698)', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-9);
  const REP = `stub-org-698-rep-${stamp}`;
  const OTHER_REP_ID = { value: '' };
  const PLATFORM = 'stub-admin-session';
  const UNKNOWN = '00000000-0000-4000-8000-00000000dead';
  let ownOrgId: string;
  let childOrgId: string;
  /** Assigned to another representative. */
  let foreignOrgId: string;
  /** Nobody is assigned to it. */
  let unassignedOrgId: string;
  /** A registration awaiting approval, nobody assigned to it. */
  let pendingOrgId: string;
  let roleId: string;
  let rolePermissionsBefore: string[] | null = null;
  let foreignMemberRoleId: string;

  const base = (id: string): string => `/api/v1/admin/organizations/${id}`;
  const get = (url: string, session: string) =>
    h.app.inject({ method: 'GET', url, cookies: { b2b_session: session } });
  const send = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    h.app.inject({
      method,
      url,
      cookies: { b2b_session: REP },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const listIds = async (query: string, session: string): Promise<string[]> => {
    const res = await get(`/api/v1/admin/organizations?${query}`, session);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((o) => o.id);
  };
  const expectNotFound = (res: { statusCode: number; body: string; json: () => unknown }): void => {
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  };
  const organizationRow = async (id: string) =>
    (
      await h.em().getConnection().execute<
        Array<{ name: string; status: string; deleted_at: Date | null; version: number }>
      >('select name, status, deleted_at, version from organizations where id = ?', [id])
    )[0]!;

  beforeAll(async () => {
    h = await setupBackendServer();
    foreignMemberRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member');
    await withSystemScope('#698: a roll-up sales representative of one organisation tree', async () => {
      const fork = h.orm.em.fork();
      let role = await fork.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['customers:read', 'customers:manage', 'organizations:rollup'];
      if (!role) {
        role = fork.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        rolePermissionsBefore = [...role.permissions];
        role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      }
      await fork.persistAndFlush(role);
      roleId = role.id;
      const org = (label: string, parent?: Organization, status = 'active'): Organization =>
        fork.create(Organization, {
          name: `Reach ${stamp} ${label}`,
          taxId: `PL698${label.slice(0, 1).toUpperCase()}${stamp}`,
          status: status as 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-698', country: 'PL' },
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
      const pending = org('pending', undefined, 'pending_verification');
      await fork.persistAndFlush(pending);
      pending.path = `/${pending.id}/`;
      const otherRep = fork.create(AdminUser, {
        email: `org-698-other-rep-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '698',
        lastName: 'Other',
      });
      await fork.persistAndFlush(otherRep);
      OTHER_REP_ID.value = otherRep.id;
      // The seeded Organization is the member routes' foreign one: another
      // representative's, so its real member is refused for the Organization.
      await fork.persistAndFlush([
        fork.create(OrganizationSalesRepAssignment, { organizationId: foreign.id, adminUserId: otherRep.id }),
        fork.create(OrganizationSalesRepAssignment, { organizationId: TEST_ORGANIZATION_ID, adminUserId: otherRep.id }),
      ]);
      const rep = fork.create(AdminUser, {
        email: `org-698-rep-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '698',
        lastName: 'Rep',
      });
      await fork.persistAndFlush(rep);
      await fork.persistAndFlush(
        fork.create(OrganizationSalesRepAssignment, { organizationId: own.id, adminUserId: rep.id }),
      );
      ownOrgId = own.id;
      childOrgId = child.id;
      foreignOrgId = foreign.id;
      unassignedOrgId = unassigned.id;
      pendingOrgId = pending.id;
      ADMIN_COOKIES[REP] = { adminUserId: rep.id };
    });
  }, 60_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[REP];
    await h
      .em()
      .getConnection()
      .execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [OTHER_REP_ID.value]);
    if (rolePermissionsBefore !== null) {
      const before = rolePermissionsBefore;
      await withSystemScope('#698: restore the sales representative role', async () => {
        const fork = h.orm.em.fork();
        const role = await fork.findOneOrFail(AdminRole, { id: roleId });
        role.permissions = before;
        await fork.flush();
      });
    }
    // A refused write changes nothing; restored in case one was not refused.
    await assignOrganizationRole(h.em(), TEST_CUSTOMER_EMPTY_ID, foreignMemberRoleId);
    await teardownBackendServer(h);
  });

  // Issue #305, owner ruling 2026-11-07 — the list narrows to the reach rule
  // the `/:id` routes answer by. It used to hold every Organization (spec 150
  // owner Q2, superseded), and the foreign row opened a 404.
  describe('the list narrows to the same rule (#305)', () => {
    it('holds exactly the Organizations a sales representative reaches', async () => {
      expect((await listIds(`q=${stamp}`, REP)).sort()).toEqual(
        [ownOrgId, childOrgId, unassignedOrgId, pendingOrgId].sort(),
      );
    });

    it('holds every Organization for a platform administrator', async () => {
      expect((await listIds(`q=${stamp}`, PLATFORM)).sort()).toEqual(
        [ownOrgId, childOrgId, foreignOrgId, unassignedOrgId, pendingOrgId].sort(),
      );
    });
  });

  const reads = [
    '',
    '/addresses',
    '/restrictions',
    '/applicable-price-lists',
    '/vat-validations',
    '/subtree',
    '/ancestors',
    '/sales-channels',
  ];

  describe.each(reads)('GET /:id%s', (suffix) => {
    it('answers for an Organization assigned to the representative', async () => {
      const res = await get(`${base(ownOrgId)}${suffix}`, REP);
      expect(res.statusCode, res.body).toBe(200);
    });

    it('answers for a roll-up descendant of it', async () => {
      const res = await get(`${base(childOrgId)}${suffix}`, REP);
      expect(res.statusCode, res.body).toBe(200);
    });

    // D-3W, issue #305 — the unassigned fallback.
    it('answers for an Organization nobody is assigned to', async () => {
      const res = await get(`${base(unassignedOrgId)}${suffix}`, REP);
      expect(res.statusCode, res.body).toBe(200);
    });

    it('answers 404 NOT_FOUND for an Organization assigned to another representative', async () => {
      const res = await get(`${base(foreignOrgId)}${suffix}`, REP);
      expectNotFound(res);
      expect(res.body).not.toContain(`Reach ${stamp} foreign`);
    });

    it('answers the same 404 for an Organization that does not exist', async () => {
      expectNotFound(await get(`${base(UNKNOWN)}${suffix}`, REP));
    });

    it('still answers a platform administrator for that Organization', async () => {
      const res = await get(`${base(foreignOrgId)}${suffix}`, PLATFORM);
      expect(res.statusCode, res.body).toBe(200);
    });

    it('answers a platform administrator 404 NOT_FOUND for an Organization that does not exist', async () => {
      expectNotFound(await get(`${base(UNKNOWN)}${suffix}`, PLATFORM));
    });
  });

  describe('writes on an Organization assigned to another representative answer 404 NOT_FOUND and change nothing', () => {
    it('PATCH /:id', async () => {
      expectNotFound(await send('PATCH', base(foreignOrgId), { name: 'Hijacked' }));
      expect((await organizationRow(foreignOrgId)).name).toBe(`Reach ${stamp} foreign`);
    });

    it.each([
      ['/approve', {}],
      ['/reject', { reason: 'no' }],
      ['/block', { reason: 'no' }],
      ['/unblock', {}],
    ] as const)('POST /:id%s', async (suffix, extra) => {
      const { version } = await organizationRow(foreignOrgId);
      expectNotFound(await send('POST', `${base(foreignOrgId)}${suffix}`, { expectedVersion: version, ...extra }));
      expect((await organizationRow(foreignOrgId)).status).toBe('active');
    });

    it('PUT /:id/restrictions', async () => {
      const { version } = await organizationRow(foreignOrgId);
      expectNotFound(
        await send('PUT', `${base(foreignOrgId)}/restrictions`, {
          expectedVersion: version,
          paymentMethodIds: [],
          deliveryMethodIds: [],
          warehouseIds: [],
        }),
      );
    });

    it.each(['payment-methods', 'delivery-methods', 'warehouses'])(
      'PATCH /:id/restrictions/%s',
      async (kind) => {
        const { version } = await organizationRow(foreignOrgId);
        expectNotFound(
          await send('PATCH', `${base(foreignOrgId)}/restrictions/${kind}`, { expectedVersion: version, add: [] }),
        );
      },
    );

    it('POST /:id/vat-validations', async () => {
      expectNotFound(await send('POST', `${base(foreignOrgId)}/vat-validations`, {}));
    });

    it('POST /:id/members/invite', async () => {
      expectNotFound(
        await send('POST', `${base(foreignOrgId)}/members/invite`, { email: `invite-698-${stamp}@scope.local` }),
      );
    });

    it('POST /:id/members', async () => {
      expectNotFound(
        await send('POST', `${base(foreignOrgId)}/members`, {
          email: `member-698-${stamp}@scope.local`,
          firstName: 'Foreign',
          lastName: 'Member',
          password: 'correct-horse-battery',
        }),
      );
    });

    it('PUT /:id/sales-channels', async () => {
      expectNotFound(await send('PUT', `${base(foreignOrgId)}/sales-channels`, { salesChannelIds: [UNKNOWN] }));
    });

    // The seeded Organization is assigned to another representative, and its
    // member is a real one: these routes are refused for the Organization, not
    // because the member is missing.
    it('PATCH /:id/members/:customerAccountId/role', async () => {
      expectNotFound(
        await send('PATCH', `${base(TEST_ORGANIZATION_ID)}/members/${TEST_CUSTOMER_EMPTY_ID}/role`, {
          roleId: foreignMemberRoleId,
        }),
      );
    });

    it('PATCH /:id/members/:customerAccountId/rollup', async () => {
      expectNotFound(
        await send('PATCH', `${base(TEST_ORGANIZATION_ID)}/members/${TEST_CUSTOMER_EMPTY_ID}/rollup`, {
          subtreeRollupEnabled: false,
        }),
      );
    });

    it('PATCH /:id/members/:customerAccountId', async () => {
      expectNotFound(
        await send('PATCH', `${base(TEST_ORGANIZATION_ID)}/members/${TEST_CUSTOMER_EMPTY_ID}`, {
          firstName: 'Hijacked',
        }),
      );
    });

    it('POST /:id/recover-admin-access', async () => {
      expectNotFound(
        await send('POST', `${base(TEST_ORGANIZATION_ID)}/recover-admin-access`, {
          promoteCustomerAccountId: TEST_CUSTOMER_EMPTY_ID,
        }),
      );
    });

    // Last: were it not refused, every write above would answer 404 for a
    // deleted Organization and prove nothing.
    it('DELETE /:id', async () => {
      expectNotFound(await send('DELETE', base(foreignOrgId)));
      expect((await organizationRow(foreignOrgId)).deleted_at).toBeNull();
    });
  });

  // D-3W, issue #305 — the unassigned fallback reaches writes as well as reads.
  it('an Organization nobody is assigned to is writable by the representative', async () => {
    const res = await send('PATCH', base(unassignedOrgId), { name: `Reach ${stamp} unassigned renamed` });
    expect(res.statusCode, res.body).toBe(200);
  });

  // D-87 — a registration awaiting approval is assigned to nobody.
  it('a pending registration nobody is assigned to can be approved by the representative', async () => {
    const { version } = await organizationRow(pendingOrgId);
    const res = await send('POST', `${base(pendingOrgId)}/approve`, { expectedVersion: version });
    expect(res.statusCode, res.body).toBe(200);
    expect((await organizationRow(pendingOrgId)).status).toBe('active');
  });

  it('an Organization in reach is still writable by the representative', async () => {
    const res = await send('PATCH', base(childOrgId), { name: `Reach ${stamp} child renamed` });
    expect(res.statusCode, res.body).toBe(200);
  });
});
