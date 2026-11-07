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
 * Issue #698 — the admin Organization surface answers only for the
 * Organizations within the acting administrator's reach.
 *
 * `Organization` is a global entity, so no tenant filter narrows its reads: the
 * list and every `/:id` route checked only that the Organization existed, and a
 * sales representative confined to their assigned Organizations could list,
 * open and — holding `customers:manage` — edit any of them. The list now holds
 * only the Organizations in reach, filtered in the query so the page is full,
 * and every `/:id` route answers an Organization outside the reach exactly as
 * one that does not exist, `404 NOT_FOUND`. The reach is the representative's
 * assigned Organizations, expanded to the subtree under `organizations:rollup`.
 * A platform administrator reaches every Organization, as before.
 */
describe('admin Organization routes — the administrator’s reach (#698)', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-9);
  const REP = `stub-org-698-rep-${stamp}`;
  const PLATFORM = 'stub-admin-session';
  const UNKNOWN = '00000000-0000-4000-8000-00000000dead';
  let ownOrgId: string;
  let childOrgId: string;
  let foreignOrgId: string;
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
      const org = (label: string, parent?: Organization): Organization =>
        fork.create(Organization, {
          name: `Reach ${stamp} ${label}`,
          taxId: `PL698${label.slice(0, 1).toUpperCase()}${stamp}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-698', country: 'PL' },
          ...(parent ? { parentId: parent.id } : {}),
        });
      // Created in this order so the foreign Organization is the newest: the
      // list sorts newest first, and a page of one must still be full.
      const own = org('own');
      await fork.persistAndFlush(own);
      own.path = `/${own.id}/`;
      const child = org('child', own);
      await fork.persistAndFlush(child);
      child.path = `${own.path}${child.id}/`;
      const foreign = org('foreign');
      await fork.persistAndFlush(foreign);
      foreign.path = `/${foreign.id}/`;
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
      ADMIN_COOKIES[REP] = { adminUserId: rep.id };
    });
  }, 60_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[REP];
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

  describe('the list', () => {
    it('holds only the Organizations in the representative’s reach', async () => {
      expect((await listIds(`q=${stamp}`, REP)).sort()).toEqual([ownOrgId, childOrgId].sort());
      const all = await listIds('includePersonal=true&limit=200', REP);
      expect(all.every((id) => id === ownOrgId || id === childOrgId), JSON.stringify(all)).toBe(true);
    });

    it('filters in the query, so a page of one is full', async () => {
      expect(await listIds(`q=${stamp}&limit=1`, REP)).toEqual([childOrgId]);
    });

    it('holds every Organization for a platform administrator', async () => {
      expect((await listIds(`q=${stamp}`, PLATFORM)).sort()).toEqual(
        [ownOrgId, childOrgId, foreignOrgId].sort(),
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

    it('answers 404 NOT_FOUND for an Organization outside the reach', async () => {
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
  });

  describe('writes outside the reach answer 404 NOT_FOUND and change nothing', () => {
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

    // The seeded Organization is outside the representative's reach, and its
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

  it('an Organization in reach is still writable by the representative', async () => {
    const res = await send('PATCH', base(childOrgId), { name: `Reach ${stamp} child renamed` });
    expect(res.statusCode, res.body).toBe(200);
  });
});
