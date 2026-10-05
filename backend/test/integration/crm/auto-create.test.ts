import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityDetailResponseSchema, OpportunityListResponseSchema } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Order } from '../../helpers/package-entities.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import {
  assignCrmSalesRep,
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  linkCrmOrder,
  linkCrmQuoteRequest,
  placeCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  setCrmSetting,
  submitCrmQuoteRequest,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';

/**
 * User Story 9 — Opportunities created automatically from placed Orders and
 * Quote Requests (`specs/143-crm-sales-opportunities/spec.md`, FR-060, FR-061;
 * research R-8).
 *
 * The Orders are **placed through the storefront API** — a cart, then
 * `POST /api/v1/orders` — because the thing measured is what the subscriber of
 * the real `order.created.v1` does, and that event is announced from inside the
 * placing transaction.
 */
describe('crm automatic creation (US9)', () => {
  let h: BackendServerHandle;
  let channel: { id: string; code: string };
  let rep: { adminUserId: string; undo: () => void };

  const list = async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/opportunities?organizationId=${TEST_ORGANIZATION_ID}&limit=200`,
      cookies: CRM_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityListResponseSchema.parse(response.json()).data;
  };

  const detail = async (id: string) => {
    const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}`, cookies: CRM_ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  /** The Opportunities that exist after `act` and did not before it. */
  const createdBy = async <T>(act: () => Promise<T>) => {
    const before = new Set((await list()).map((row) => row.id));
    const result = await act();
    const created = (await list()).filter((row) => !before.has(row.id));
    return { result, created };
  };

  const placeOrder = () => whenCrmEventSettled(h, 'order.created.v1', () => true, () => placeCrmOrder(h));

  const submitQuoteRequest = () =>
    whenCrmEventSettled(h, 'rfq.created.v1', () => true, () => submitCrmQuoteRequest(h));

  const announceOrder = (orderId: string) =>
    whenCrmEventSettled(h, 'order.created.v1', (payload) => payload['orderId'] === orderId, async () => {
      h.eventBus.emit('order.created.v1' as never, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        orderId,
        organizationId: TEST_ORGANIZATION_ID,
      } as never);
    });

  const setChannelOverride = async (code: string, value: unknown) => {
    await h.settings.adminService.setValueForSubset(code, [channel.code], value, null, { actorAdminUserId: null });
    await h.settings.cache.invalidate(code);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    const systemDefault = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channel = { id: systemDefault.id, code: systemDefault.code };
    await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
    // The Organization's Sales Rep — whom the default-assignee rule picks for
    // an Opportunity nobody created by hand.
    rep = await seedCrmAdmin(h.em(), 'auto-rep', ['crm:read', 'crm:write', 'orders:read']);
    await assignCrmSalesRep(h.em(), TEST_ORGANIZATION_ID, rep.adminUserId);
  });

  afterAll(async () => {
    rep.undo();
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('creates nothing while both settings are off — the default', async () => {
    const { created } = await createdBy(async () => {
      await placeOrder();
      await submitQuoteRequest();
    });
    expect(created).toEqual([]);
  });

  describe('from Orders', () => {
    beforeAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
    });

    afterAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    });

    it('an Order placed through the storefront yields one Opportunity, linked to it', async () => {
      const events: Array<Record<string, unknown>> = [];
      const offCreated = h.eventBus.on('crm.opportunity.created.v1', (payload: unknown) => {
        events.push({ name: 'created', ...(payload as Record<string, unknown>) });
      });
      const offLinked = h.eventBus.on('crm.opportunity.document_linked.v1', (payload: unknown) => {
        events.push({ name: 'linked', ...(payload as Record<string, unknown>) });
      });
      let outcome: Awaited<ReturnType<typeof createdBy<{ id: string; businessId: string }>>>;
      try {
        outcome = await createdBy(placeOrder);
      } finally {
        offCreated();
        offLinked();
      }
      const order = outcome.result;
      expect(outcome.created).toHaveLength(1);

      const row = await h.em().findOneOrFail(Order, { id: order.id }, { filters: false });
      const opportunity = await detail(outcome.created[0]?.id ?? '');
      expect(opportunity).toMatchObject({
        organization: { id: TEST_ORGANIZATION_ID },
        status: { code: 'new' },
        source: 'order',
        valueMode: 'computed',
        currency: row.currency,
        salesChannelId: row.salesChannelId,
        assignee: { id: rep.adminUserId },
      });
      expect(row.salesChannelId).toBe(channel.id);
      expect(opportunity.title).toBe(`${order.businessId} — ${opportunity.organization.name}`);
      expect(opportunity.organization.name).not.toBe('');
      expect(opportunity.links).toHaveLength(1);
      expect(opportunity.links[0]).toMatchObject({
        documentKind: 'order',
        documentId: order.id,
        linkSource: 'auto',
        available: true,
      });

      expect(events).toEqual([
        expect.objectContaining({ name: 'created', opportunityId: opportunity.id, source: 'order' }),
        expect.objectContaining({
          name: 'linked',
          opportunityId: opportunity.id,
          documentKind: 'order',
          documentId: order.id,
          linkSource: 'auto',
        }),
      ]);
      // One audit entry, with nobody behind it: the system created it.
      const entries = await h.auditLogService.query({ action: 'crm.opportunity.create', objectId: opportunity.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.actorAdminUserId ?? null).toBeNull();
    });

    it('the same event delivered again creates nothing more', async () => {
      const first = await createdBy(placeOrder);
      expect(first.created).toHaveLength(1);
      const again = await createdBy(async () => {
        await announceOrder(first.result.id);
        await announceOrder(first.result.id);
      });
      expect(again.created).toEqual([]);
      expect((await detail(first.created[0]?.id ?? '')).links).toHaveLength(1);
    });

    it('an Order that is already linked to an Opportunity gets no second one', async () => {
      const holder = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, holder.id, order.id)).statusCode).toBe(201);
      const { created } = await createdBy(() => announceOrder(order.id));
      expect(created).toEqual([]);
    });

    it('an Order placed from a linked Quote Request joins that Opportunity and creates none', async () => {
      const holder = await createCrmOpportunity(h);
      const rfq = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, holder.id, rfq.id)).statusCode).toBe(201);
      const order = await seedCrmOrder(h.em(), { sourceQuoteRequestId: rfq.id });

      const { created } = await createdBy(() => announceOrder(order.id));
      expect(created).toEqual([]);
      const links = (await detail(holder.id)).links;
      expect(links.find((link) => link.documentId === order.id)).toMatchObject({ linkSource: 'quote_conversion' });
    });

    it('an event naming an Order that never committed creates nothing', async () => {
      const { created } = await createdBy(() => announceOrder(randomUUID()));
      expect(created).toEqual([]);
    });

    it('leaves Quote Requests alone — the other setting is still off', async () => {
      const { created } = await createdBy(submitQuoteRequest);
      expect(created).toEqual([]);
    });
  });

  describe('from Quote Requests', () => {
    beforeAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, true);
    });

    afterAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
    });

    it('a Quote Request submitted through the customer API yields one Opportunity, linked to it', async () => {
      const { result: rfq, created } = await createdBy(submitQuoteRequest);
      expect(created).toHaveLength(1);
      const opportunity = await detail(created[0]?.id ?? '');
      expect(opportunity).toMatchObject({
        organization: { id: TEST_ORGANIZATION_ID },
        status: { code: 'new' },
        source: 'quote_request',
        valueMode: 'computed',
        currency: 'PLN',
        assignee: { id: rep.adminUserId },
      });
      expect(opportunity.title).toBe(`${rfq.businessId} — ${opportunity.organization.name}`);
      expect(opportunity.links).toHaveLength(1);
      expect(opportunity.links[0]).toMatchObject({
        documentKind: 'quote_request',
        documentId: rfq.id,
        linkSource: 'auto',
        available: true,
      });
    });

    it('the same event delivered again creates nothing more', async () => {
      const { result: rfq, created } = await createdBy(submitQuoteRequest);
      expect(created).toHaveLength(1);
      const again = await createdBy(() =>
        whenCrmEventSettled(h, 'rfq.created.v1', (payload) => payload['rfqId'] === rfq.id, async () => {
          h.eventBus.emit('rfq.created.v1' as never, {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            rfqId: rfq.id,
            organizationId: TEST_ORGANIZATION_ID,
          } as never);
        }),
      );
      expect(again.created).toEqual([]);
    });

    it('leaves Orders alone — the other setting is off', async () => {
      const { created } = await createdBy(placeOrder);
      expect(created).toEqual([]);
    });
  });

  describe('a per-channel override of the setting', () => {
    afterAll(async () => {
      await setChannelOverride(CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    });

    it('switched on for the Order’s channel while the platform value is off — an Opportunity is created', async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
      await setChannelOverride(CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
      const { created } = await createdBy(placeOrder);
      expect(created).toHaveLength(1);
      expect(created[0]?.salesChannelId).toBe(channel.id);
    });

    it('switched off for the Order’s channel while the platform value is on — nothing is created', async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
      await setChannelOverride(CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
      const { created } = await createdBy(placeOrder);
      expect(created).toEqual([]);
    });
  });
});
