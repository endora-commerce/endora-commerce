import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SalesChannelAttributionRegistryPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ensureSalesChannel } from '../../helpers/sales-channel-fixtures.js';
import {
  CRM_ADMIN,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

/**
 * A Sales Channel an Opportunity is attributed to is reported as attributed
 * (`specs/143-crm-sales-opportunities/research.md` R-13).
 *
 * `crm_opportunities.sales_channel_id` is a foreign key with `on delete
 * restrict`. The counter CRM contributes to `salesChannelAttributionRegistry`
 * is what lets `sales_channels` refuse a delete by naming what still points at
 * the channel, instead of surfacing a raw constraint violation.
 */
describe('crm sales channel attribution', () => {
  let h: BackendServerHandle;
  let registry: SalesChannelAttributionRegistryPort;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    registry = h.container.resolve<SalesChannelAttributionRegistryPort>('salesChannelAttributionRegistry');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const crmCount = async (salesChannelId: string) =>
    (await registry.countForChannel(salesChannelId)).find((entry) => entry.ownerModuleId === 'crm');

  it('contributes a counter at boot', () => {
    expect(registry.owners()).toContain('crm');
  });

  it('reports a channel with Opportunities as attributed, and one without as not', async () => {
    const used = await ensureSalesChannel(h.em(), 'crm_attr_used');
    const unused = await ensureSalesChannel(h.em(), 'crm_attr_unused');
    await createCrmOpportunity(h, { salesChannelId: used.id });
    await createCrmOpportunity(h, { salesChannelId: used.id });
    await createCrmOpportunity(h);

    expect(await crmCount(used.id)).toEqual({
      ownerModuleId: 'crm',
      consumer: 'sales opportunity(ies)',
      tableName: 'crm_opportunities',
      columnName: 'sales_channel_id',
      count: 2,
    });
    // A zero count is dropped by the registry, not reported as zero.
    expect(await crmCount(unused.id)).toBeUndefined();
  });

  it('refuses to delete a channel an Opportunity is attributed to, and names what points at it', async () => {
    const channel = await ensureSalesChannel(h.em(), 'crm_attr_guarded');
    await createCrmOpportunity(h, { salesChannelId: channel.id });

    const response = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/sales-channels/crm_attr_guarded',
      cookies: CRM_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error).toMatchObject({
      code: 'SALES_CHANNEL_HAS_ATTRIBUTIONS',
      details: [{ path: 'sales opportunity(ies)', issue: '1' }],
    });
    const [row] = (await h.em().getConnection().execute(
      `select count(*)::int as n from "sales_channels" where "id" = ?`,
      [channel.id],
    )) as Array<{ n: number }>;
    expect(row?.n).toBe(1);
  });

  it('counts platform-wide — the answer does not shrink to the Organizations the asker reaches', async () => {
    const channel = await ensureSalesChannel(h.em(), 'crm_attr_tenants');
    const mine = await seedCrmOrganization(h.em(), 'Attr mine');
    const theirs = await seedCrmOrganization(h.em(), 'Attr theirs');
    await createCrmOpportunity(h, { organizationId: mine, salesChannelId: channel.id });
    await createCrmOpportunity(h, { organizationId: theirs, salesChannelId: channel.id });
    const rep = await seedCrmSalesRep(h.em(), [mine], ['crm:read', 'sales_channels:write', 'sales_channels:read']);
    try {
      // Asked on a request scoped to one Organization: the delete is still
      // refused on the strength of both Opportunities.
      const response = await h.app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/sales-channels/crm_attr_tenants',
        cookies: rep.cookies,
      });
      expect(response.statusCode, response.body).toBe(422);
      // Two, counted inside a request that reaches one of the two Organizations.
      expect(response.json().error).toMatchObject({
        code: 'SALES_CHANNEL_HAS_ATTRIBUTIONS',
        details: [{ path: 'sales opportunity(ies)', issue: '2' }],
      });
    } finally {
      rep.undo();
    }
  });
});
