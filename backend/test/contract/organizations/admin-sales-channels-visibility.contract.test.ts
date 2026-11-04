import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
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
import { assignOrganizationChannels } from '../../helpers/sales-channel-access.js';

/**
 * Issue #515 — `GET` and `PUT /api/v1/admin/organizations/:id/sales-channels`
 * answer only for an Organization the acting administrator can see.
 *
 * `Organization` is a global entity, so no tenant filter narrows the read: the
 * routes checked only that the Organization existed, and a sales representative
 * confined to their own Organizations could read — and, holding
 * `customers:manage`, replace — any Organization's channel assignment. An
 * Organization outside the administrator's reach now answers exactly as one
 * that does not exist, `404 NOT_FOUND`, so the answer is no existence probe
 * either. A platform administrator reaches every Organization, as before.
 */
describe('admin Organization sales channels — Organization visibility (#515)', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-9);
  const REP = `stub-orgsc-515-rep-${stamp}`;
  let ownOrgId: string;
  let foreignOrgId: string;
  let channelA: string;
  let channelB: string;
  let channelACode: string;

  const url = (id: string): string => `/api/v1/admin/organizations/${id}/sales-channels`;
  const get = (id: string, session: string) =>
    h.app.inject({ method: 'GET', url: url(id), cookies: { b2b_session: session } });
  const put = (id: string, salesChannelIds: string[], session: string) =>
    h.app.inject({ method: 'PUT', url: url(id), cookies: { b2b_session: session }, payload: { salesChannelIds } });
  const assigned = async (orgId: string): Promise<string[]> =>
    (
      await h.em().getConnection().execute<Array<{ sales_channel_id: string }>>(
        'select sales_channel_id from sales_channel_organizations where organization_id = ? order by sales_channel_id',
        [orgId],
      )
    ).map((r) => r.sales_channel_id);

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const make = (code: string): SalesChannel =>
      em.create(SalesChannel, {
        code,
        name: { en: code },
        defaultLanguage: 'en',
        languages: ['en'],
        defaultCurrency: 'PLN',
        currencies: ['PLN'],
        active: true,
      });
    const a = make(`orgsc515-a-${stamp}`);
    const b = make(`orgsc515-b-${stamp}`);
    await em.persistAndFlush([a, b]);
    channelA = a.id;
    channelB = b.id;
    channelACode = a.code;

    await withSystemScope('#515: a sales representative of one organisation', async () => {
      const fork = h.orm.em.fork();
      let role = await fork.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['customers:read', 'customers:manage'];
      if (!role) {
        role = fork.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      }
      await fork.persistAndFlush(role);
      const org = (label: string) =>
        fork.create(Organization, {
          name: `#515 ${label} ${stamp}`,
          taxId: `PL515${label === 'own' ? 'O' : 'F'}${stamp}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-515', country: 'PL' },
        });
      const own = org('own');
      const foreign = org('foreign');
      const rep = fork.create(AdminUser, {
        email: `orgsc-515-rep-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '515',
        lastName: 'Rep',
      });
      await fork.persistAndFlush([own, foreign, rep]);
      await fork.persistAndFlush(
        fork.create(OrganizationSalesRepAssignment, { organizationId: own.id, adminUserId: rep.id }),
      );
      ownOrgId = own.id;
      foreignOrgId = foreign.id;
      ADMIN_COOKIES[REP] = { adminUserId: rep.id };
    });
    await assignOrganizationChannels(h, ownOrgId, [channelACode]);
    await assignOrganizationChannels(h, foreignOrgId, [channelACode]);
  }, 60_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[REP];
    await teardownBackendServer(h);
  });

  it('GET answers a sales representative for an Organization assigned to them', async () => {
    const res = await get(ownOrgId, REP);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { assignedSalesChannelIds: string[] } }).data.assignedSalesChannelIds).toEqual([
      channelA,
    ]);
  });

  it('GET answers 404 NOT_FOUND for an Organization outside the representative\'s reach', async () => {
    const res = await get(foreignOrgId, REP);
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(res.body).not.toContain(channelA);
  });

  it('GET answers the same 404 for an Organization that does not exist', async () => {
    const res = await get('00000000-0000-4000-8000-00000000dead', REP);
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('PUT answers 404 NOT_FOUND outside the representative\'s reach, and changes nothing', async () => {
    const res = await put(foreignOrgId, [channelB], REP);
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(await assigned(foreignOrgId)).toEqual([channelA]);
  });

  it('PUT replaces the set for an Organization assigned to the representative', async () => {
    const res = await put(ownOrgId, [channelA, channelB], REP);
    expect(res.statusCode, res.body).toBe(200);
    expect(await assigned(ownOrgId)).toEqual([channelA, channelB].sort());
  });

  it('a platform administrator still reads every Organization', async () => {
    const res = await get(foreignOrgId, 'stub-admin-session');
    expect(res.statusCode, res.body).toBe(200);
  });
});
