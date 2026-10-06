import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityDetailResponseSchema, OpportunityListResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmOrganization,
  seedCrmSalesRep,
  setCrmSetting,
  transitionCrmOpportunity,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';

const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const ORIGIN_TYPE = 'crm_opportunity';

/**
 * User Story 10 — an Order or a Quote Request created from within an
 * Opportunity (`specs/143-crm-sales-opportunities/spec.md`, FR-026;
 * `contracts/foreign-module-changes.md` §B, §C).
 *
 * The documents are created **through their owners' admin create routes**, with
 * the `origin` the create screens send, and every assertion reads the result
 * back through CRM's own API: nothing here looks at the create response for
 * the link, because the owners know nothing of one.
 */
describe('crm — documents created from an Opportunity (US10)', () => {
  let h: BackendServerHandle;
  let foreignOrganizationId: string;

  const list = async (organizationId: string = TEST_ORGANIZATION_ID) => {
    const response = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/opportunities?organizationId=${organizationId}&limit=200`,
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

  /** The Opportunities of the test Organization that exist after `act` and did not before it. */
  const createdBy = async <T>(act: () => Promise<T>) => {
    const before = new Set((await list()).map((row) => row.id));
    const result = await act();
    const created = (await list()).filter((row) => !before.has(row.id));
    return { result, created };
  };

  /** Every `crm.opportunity.document_linked.v1` announced while `act` runs. */
  const linkedEvents = async <T>(act: () => Promise<T>) => {
    const events: Array<Record<string, unknown>> = [];
    const off = h.eventBus.on('crm.opportunity.document_linked.v1' as never, (payload: unknown) => {
      events.push(payload as Record<string, unknown>);
    });
    try {
      return { result: await act(), events };
    } finally {
      off();
    }
  };

  // --- Orders ----------------------------------------------------------------

  /** `POST /api/v1/admin/orders` — the request the create-order screen sends. */
  const createOrder = (origin?: unknown) =>
    whenCrmEventSettled(h, 'order.created.v1', () => true, async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders',
        cookies: CRM_ADMIN,
        payload: {
          customerAccountId: TEST_CUSTOMER_ID,
          salesChannelId: SALES_CHANNEL_ID,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          ...(origin === undefined ? {} : { origin }),
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return (response.json() as { data: { id: string; businessId: string; organizationId: string } }).data;
    });

  const announceOrder = (orderId: string, origin: unknown) =>
    whenCrmEventSettled(h, 'order.created.v1', (payload) => payload['orderId'] === orderId, async () => {
      h.eventBus.emit('order.created.v1' as never, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        orderId,
        organizationId: TEST_ORGANIZATION_ID,
        origin,
      } as never);
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
    foreignOrganizationId = await seedCrmOrganization(h.em(), 'origin-foreign');
  });

  afterAll(async () => {
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('an Order, with automatic creation from Orders switched ON', () => {
    beforeAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
    });

    afterAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    });

    it('is linked to the Opportunity it was created from, and no second Opportunity is created', async () => {
      const opportunity = await createCrmOpportunity(h);
      const { result, events } = await linkedEvents(() =>
        createdBy(() => createOrder({ type: ORIGIN_TYPE, id: opportunity.id })),
      );
      const order = result.result;

      // Automatic creation is on and would have made one: it must not have.
      expect(result.created).toEqual([]);

      const links = (await detail(opportunity.id)).links;
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        documentKind: 'order',
        documentId: order.id,
        number: order.businessId,
        linkSource: 'created_from_opportunity',
        syncStatus: true,
        available: true,
      });
      expect(events).toEqual([
        expect.objectContaining({
          opportunityId: opportunity.id,
          organizationId: TEST_ORGANIZATION_ID,
          documentKind: 'order',
          documentId: order.id,
          linkSource: 'created_from_opportunity',
        }),
      ]);
    });

    it('links once when the event is delivered again', async () => {
      const opportunity = await createCrmOpportunity(h);
      const origin = { type: ORIGIN_TYPE, id: opportunity.id };
      const first = await createdBy(() => createOrder(origin));
      expect(first.created).toEqual([]);

      const again = await linkedEvents(() =>
        createdBy(async () => {
          await announceOrder(first.result.id, origin);
          await announceOrder(first.result.id, origin);
        }),
      );
      expect(again.result.created).toEqual([]);
      expect(again.events).toEqual([]);
      const links = (await detail(opportunity.id)).links;
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ documentId: first.result.id, linkSource: 'created_from_opportunity' });
    });

    it('an origin naming an Opportunity of another Organization links nothing there; the Order is created and handled as any other', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: foreignOrganizationId });
      const { result: order, created } = await createdBy(() => createOrder({ type: ORIGIN_TYPE, id: foreign.id }));

      expect(order.organizationId).toBe(TEST_ORGANIZATION_ID);
      expect((await detail(foreign.id)).links).toEqual([]);
      // Nothing leaked, nothing skipped: the setting is on, so the Order gets
      // the Opportunity an Order without an origin would have got.
      expect(created).toHaveLength(1);
      const automatic = await detail(created[0]?.id ?? '');
      expect(automatic).toMatchObject({ organization: { id: TEST_ORGANIZATION_ID }, source: 'order' });
      expect(automatic.links).toEqual([
        expect.objectContaining({ documentKind: 'order', documentId: order.id, linkSource: 'auto' }),
      ]);
    });

    it('an origin naming an Opportunity that does not exist is handled the same way', async () => {
      const { result: order, created } = await createdBy(() => createOrder({ type: ORIGIN_TYPE, id: randomUUID() }));
      expect(created).toHaveLength(1);
      expect((await detail(created[0]?.id ?? '')).links).toEqual([
        expect.objectContaining({ documentId: order.id, linkSource: 'auto' }),
      ]);
    });

    it('an origin of a type CRM does not know is ignored', async () => {
      const opportunity = await createCrmOpportunity(h);
      const { result: order, created } = await createdBy(() =>
        createOrder({ type: 'somebody_elses_thing', id: opportunity.id }),
      );
      expect((await detail(opportunity.id)).links).toEqual([]);
      expect(created).toHaveLength(1);
      expect((await detail(created[0]?.id ?? '')).links).toEqual([
        expect.objectContaining({ documentId: order.id, linkSource: 'auto' }),
      ]);
    });
  });

  describe('an Order, with automatic creation switched off — the default', () => {
    it('is linked to the Opportunity it was created from', async () => {
      const opportunity = await createCrmOpportunity(h);
      const { result: order, created } = await createdBy(() => createOrder({ type: ORIGIN_TYPE, id: opportunity.id }));
      expect(created).toEqual([]);
      expect((await detail(opportunity.id)).links).toEqual([
        expect.objectContaining({ documentId: order.id, linkSource: 'created_from_opportunity' }),
      ]);
    });

    it('is linked to a closed Opportunity too, which stays closed — as a link made by hand would be', async () => {
      // Decided, not incidental (research N-S9): a closed Opportunity takes a
      // document by hand, so it takes the one created from it. Nothing reopens it.
      const opportunity = await createCrmOpportunity(h);
      const closed = await transitionCrmOpportunity(h, opportunity.id, 'lost');
      expect(closed.statusCode, closed.body).toBe(200);

      const { result: order, created } = await createdBy(() => createOrder({ type: ORIGIN_TYPE, id: opportunity.id }));

      expect(created).toEqual([]);
      const after = await detail(opportunity.id);
      expect(after.status.kind).toBe('lost');
      expect(after.links).toEqual([
        expect.objectContaining({ documentId: order.id, linkSource: 'created_from_opportunity' }),
      ]);
    });

    it('an origin naming another Organization’s Opportunity, or none: the Order is created and linked nowhere', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: foreignOrganizationId });
      const foreignBefore = (await list(foreignOrganizationId)).length;
      const { created } = await linkedEvents(() =>
        createdBy(async () => {
          await createOrder({ type: ORIGIN_TYPE, id: foreign.id });
          await createOrder({ type: ORIGIN_TYPE, id: randomUUID() });
        }),
      ).then(({ result, events }) => {
        expect(events).toEqual([]);
        return result;
      });
      expect(created).toEqual([]);
      expect((await detail(foreign.id)).links).toEqual([]);
      expect(await list(foreignOrganizationId)).toHaveLength(foreignBefore);
    });

    it('an Order created without an origin is linked nowhere', async () => {
      const { events, result } = await linkedEvents(() => createdBy(() => createOrder()));
      expect(result.created).toEqual([]);
      expect(events).toEqual([]);
    });
  });

  // --- Quote Requests ----------------------------------------------------------

  /** `POST /api/v1/admin/quote-requests` — the request the create screen sends. */
  const createQuoteRequest = (origin?: unknown, cookies: Record<string, string> = CRM_ADMIN) =>
    whenCrmEventSettled(h, 'rfq.created_by_admin.v1', () => true, async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 25 }],
          ...(origin === undefined ? {} : { origin }),
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return (response.json() as { data: { id: string; businessId: string } }).data;
    });

  const announceQuoteRequest = (rfqId: string, origin: unknown, adminUserId: string = TEST_ADMIN_ID) =>
    whenCrmEventSettled(h, 'rfq.created_by_admin.v1', (payload) => payload['rfqId'] === rfqId, async () => {
      h.eventBus.emit('rfq.created_by_admin.v1' as never, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        rfqId,
        organizationId: TEST_ORGANIZATION_ID,
        adminUserId,
        origin,
      } as never);
    });

  describe('a Quote Request, with automatic creation from Quote Requests switched ON', () => {
    beforeAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, true);
    });

    afterAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
    });

    it('is linked to the Opportunity it was created from, and no second Opportunity is created', async () => {
      const opportunity = await createCrmOpportunity(h);
      const { result, events } = await linkedEvents(() =>
        createdBy(() => createQuoteRequest({ type: ORIGIN_TYPE, id: opportunity.id })),
      );
      const rfq = result.result;
      expect(result.created).toEqual([]);

      const links = (await detail(opportunity.id)).links;
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        documentKind: 'quote_request',
        documentId: rfq.id,
        number: rfq.businessId,
        linkSource: 'created_from_opportunity',
        available: true,
      });
      expect(events).toEqual([
        expect.objectContaining({
          opportunityId: opportunity.id,
          documentKind: 'quote_request',
          documentId: rfq.id,
          linkSource: 'created_from_opportunity',
        }),
      ]);
    });

    it('links once when the event is delivered again', async () => {
      const opportunity = await createCrmOpportunity(h);
      const origin = { type: ORIGIN_TYPE, id: opportunity.id };
      const first = await createdBy(() => createQuoteRequest(origin));
      expect(first.created).toEqual([]);

      const again = await linkedEvents(() =>
        createdBy(async () => {
          await announceQuoteRequest(first.result.id, origin);
          await announceQuoteRequest(first.result.id, origin);
        }),
      );
      expect(again.result.created).toEqual([]);
      expect(again.events).toEqual([]);
      expect((await detail(opportunity.id)).links).toHaveLength(1);
    });

    it('an origin naming another Organization’s Opportunity, or none, links nothing; the request is handled as any other', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: foreignOrganizationId });
      for (const id of [foreign.id, randomUUID()]) {
        const { result: rfq, created } = await createdBy(() => createQuoteRequest({ type: ORIGIN_TYPE, id }));
        expect(created).toHaveLength(1);
        const automatic = await detail(created[0]?.id ?? '');
        expect(automatic).toMatchObject({ organization: { id: TEST_ORGANIZATION_ID }, source: 'quote_request' });
        expect(automatic.links).toEqual([
          expect.objectContaining({ documentKind: 'quote_request', documentId: rfq.id, linkSource: 'auto' }),
        ]);
      }
      expect((await detail(foreign.id)).links).toEqual([]);
    });

    it('a request an administrator creates without an origin gets its Opportunity, as a submitted one does', async () => {
      const { result: rfq, created } = await createdBy(() => createQuoteRequest());
      expect(created).toHaveLength(1);
      expect((await detail(created[0]?.id ?? '')).links).toEqual([
        expect.objectContaining({ documentId: rfq.id, linkSource: 'auto' }),
      ]);
    });
  });

  describe('a Quote Request, with automatic creation switched off — the default', () => {
    it('is linked to the Opportunity it was created from', async () => {
      const opportunity = await createCrmOpportunity(h);
      const { result: rfq, created } = await createdBy(() =>
        createQuoteRequest({ type: ORIGIN_TYPE, id: opportunity.id }),
      );
      expect(created).toEqual([]);
      expect((await detail(opportunity.id)).links).toEqual([
        expect.objectContaining({ documentId: rfq.id, linkSource: 'created_from_opportunity' }),
      ]);
    });

    it('an origin that does not hold, or none: the request is created and linked nowhere', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: foreignOrganizationId });
      const { result, events } = await linkedEvents(() =>
        createdBy(async () => {
          await createQuoteRequest({ type: ORIGIN_TYPE, id: foreign.id });
          await createQuoteRequest({ type: ORIGIN_TYPE, id: randomUUID() });
          await createQuoteRequest({ type: 'somebody_elses_thing', id: foreign.id });
          await createQuoteRequest();
        }),
      );
      expect(result.created).toEqual([]);
      expect(events).toEqual([]);
      expect((await detail(foreign.id)).links).toEqual([]);
    });
  });

  describe('the administrator the event names', () => {
    it('a Sales Rep who reaches the Organization links the request they create from its Opportunity', async () => {
      const rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['rfqs:handle', 'crm:read', 'crm:write']);
      try {
        const opportunity = await createCrmOpportunity(h);
        const rfq = await createQuoteRequest({ type: ORIGIN_TYPE, id: opportunity.id }, rep.cookies);
        expect((await detail(opportunity.id)).links).toEqual([
          expect.objectContaining({ documentId: rfq.id, linkSource: 'created_from_opportunity' }),
        ]);
      } finally {
        rep.undo();
      }
    });

    it('an event naming an administrator who cannot reach the Opportunity’s Organization links nothing', async () => {
      // Confined to the other Organization: the Opportunity below is out of reach.
      const outsider = await seedCrmSalesRep(h.em(), [foreignOrganizationId], ['rfqs:handle', 'crm:read', 'crm:write']);
      try {
        const opportunity = await createCrmOpportunity(h);
        const origin = { type: ORIGIN_TYPE, id: opportunity.id };
        const rfq = await createQuoteRequest();
        const { events } = await linkedEvents(() => announceQuoteRequest(rfq.id, origin, outsider.adminUserId));
        expect(events).toEqual([]);
        expect((await detail(opportunity.id)).links).toEqual([]);

        // The same event naming somebody who does reach it: linked. The refusal
        // above was about the administrator and nothing else.
        await announceQuoteRequest(rfq.id, origin, TEST_ADMIN_ID);
        expect((await detail(opportunity.id)).links).toEqual([
          expect.objectContaining({ documentId: rfq.id, linkSource: 'created_from_opportunity' }),
        ]);
      } finally {
        outsider.undo();
      }
    });

    it('an event naming nobody who exists links nothing', async () => {
      const opportunity = await createCrmOpportunity(h);
      const rfq = await createQuoteRequest();
      await announceQuoteRequest(rfq.id, { type: ORIGIN_TYPE, id: opportunity.id }, randomUUID());
      expect((await detail(opportunity.id)).links).toEqual([]);
    });
  });

  describe('with the Quote Requests module switched off', () => {
    it('no request can be created, and an Order is still linked to the Opportunity it was created from', async () => {
      const opportunity = await createCrmOpportunity(h);
      const origin = { type: ORIGIN_TYPE, id: opportunity.id };
      await withModuleOff('quote_requests', 'deactivated', async () => {
        const refused = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/quote-requests',
          cookies: CRM_ADMIN,
          payload: {
            organizationId: TEST_ORGANIZATION_ID,
            customerAccountId: TEST_CUSTOMER_ID,
            items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 1 }],
            origin,
          },
        });
        expect(refused.statusCode, refused.body).toBe(503);
        expect((refused.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');

        const order = await createOrder(origin);
        expect((await detail(opportunity.id)).links).toEqual([
          expect.objectContaining({ documentKind: 'order', documentId: order.id, linkSource: 'created_from_opportunity' }),
        ]);
      });
    });
  });
});
