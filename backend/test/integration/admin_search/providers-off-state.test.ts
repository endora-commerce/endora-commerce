import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { createCrmOpportunity } from '../../helpers/seed-crm.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { GS_COOKIES, runToken, seedCustomer, seedOrganization } from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` SC-005 (T052) — each switchable owner off in
 * turn, while the platform still offers it: its group and its capability entry
 * are gone, the other groups are not, and no restart is needed either way —
 * the registry answers presence at enumeration (FR-013).
 */
describe('admin global search — record types follow their module’s presence (spec 150, SC-005)', () => {
  let h: BackendServerHandle;
  const T = runToken();
  const q = `off${T}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    let orgId = '';
    await withSystemScope('test seed: global search providers off-state', async () => {
      const em = h.em();
      const org = await seedOrganization(em, { name: `OFF${T} Org` });
      orgId = org.id;
      const customer = await seedCustomer(em, org.id, { email: `off${T}@example.com` });
      await em.persist(
        em.create(QuoteRequest, { organizationId: org.id, customerAccountId: customer.id, businessId: `OFF${T}-rfq` } as never),
      ).flush();
    });
    await createCrmOpportunity(h, { organizationId: orgId, title: `OFF${T} deal` });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function groupTypes(): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=${q}&language=en`,
      cookies: GS_COOKIES.admin,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { groups: Array<{ entityType: string }> } }).data.groups.map((g) => g.entityType);
  }

  async function offered(): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/global-search/capability?language=en',
      cookies: GS_COOKIES.admin,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { entityTypes: Array<{ entityType: string }> } }).data.entityTypes.map((e) => e.entityType);
  }

  /**
   * On, off while the platform still offers the module, on again. `switchOff`
   * names the module literally at each call so `check:off-state-coverage` can
   * read which module each case proves.
   */
  async function expectGroupFollowsPresence(
    entityType: string,
    switchOff: (body: () => Promise<void>) => Promise<void>,
  ): Promise<void> {
    // Positive control: present, alongside the organization that matches too.
    expect(await groupTypes()).toEqual(expect.arrayContaining([entityType, 'organizations.organization']));
    expect(await offered()).toContain(entityType);

    await switchOff(async () => {
      const types = await groupTypes();
      expect(types).not.toContain(entityType);
      expect(types).toContain('organizations.organization');
      expect(await offered()).not.toContain(entityType);
    });

    expect(await groupTypes()).toContain(entityType);
    expect(await offered()).toContain(entityType);
  }

  it('crm off: no Sales Opportunities group or capability entry; back on: both return', async () => {
    await expectGroupFollowsPresence('crm.opportunity', (body) => withModuleOff('crm', 'deactivated', body));
  });

  it('quote_requests off: no Quote Requests group or capability entry; back on: both return', async () => {
    await expectGroupFollowsPresence('quote_requests.quote_request', (body) =>
      withModuleOff('quote_requests', 'deactivated', body),
    );
  });

  it('customers off: no Customers group or capability entry; back on: both return', async () => {
    await expectGroupFollowsPresence('customers.customer', (body) => withModuleOff('customers', 'deactivated', body));
  });
});
