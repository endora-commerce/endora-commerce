import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  expectModuleAbsent,
  withModuleOff,
  type OffStateAxis,
  type OffStateProbe,
} from '../../helpers/off-state.js';
import { CrmOpportunity, CrmOpportunityLink, CrmStatusPropagation } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import {
  changeOrderStatusAsOperator,
  createCrmOpportunity,
  linkCrmOrder,
  linkCrmQuoteRequest,
  placeCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmCountingStatuses,
  setCrmMappings,
  setCrmSetting,
  submitCrmQuoteRequest,
  whenCrmEventSettled,
  writeCrmSetting,
} from '../../helpers/seed-crm.js';

/**
 * `crm` off-state — Constitution XVII item 6
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §6).
 *
 * The module is operator-toggleable: `crm.enabled` is its activation control,
 * and every route it owns is registered through `ctx.routes`, so the gate is
 * applied at the registration seam. This file is what turns that sentence into
 * a measurement, on both axes — deactivated while platform-available, and
 * platform-unavailable — with full restoration after each.
 *
 * **Storefront absence** is answered here rather than probed: the module has no
 * storefront route and contributes no storefront element, by design — a Sales
 * Opportunity is an internal record and nothing customer-facing reads it.
 *
 * The configuration half is driven over `crm.auto_create_from_orders`, an
 * ordinary module setting, because the activation control itself is the one
 * setting that must stay writable while the module is off.
 *
 * Each story that adds a subscriber adds its own case below, positive control
 * first: without one, a subscriber that never worked reads as a successful
 * absence.
 */
describe('crm off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/crm';
  const WORKFLOW_URL = `${API}/workflow`;
  const ID = '00000000-0000-4000-8000-00000000c0de';
  const CHILD = '00000000-0000-4000-8000-00000000c0df';

  /**
   * Every route the module owns, as registered. The gate is applied where the
   * routes are registered, so each of them is refused before its handler, its
   * permission check or its body schema is reached — which is why the ids and
   * bodies the probes carry need not name anything that exists.
   */
  const REGISTERED: ReadonlyArray<{ method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; route: string; payload?: unknown }> = [
    { method: 'GET', route: `${API}/workflow` },
    { method: 'GET', route: `${API}/board` },
    { method: 'GET', route: `${API}/lookups/organizations` },
    { method: 'GET', route: `${API}/lookups/sales-channels` },
    { method: 'GET', route: `${API}/lookups/assignees` },
    { method: 'GET', route: `${API}/lookups/contacts` },
    { method: 'GET', route: `${API}/lookups/quote-requests` },
    { method: 'POST', route: `${API}/statuses`, payload: { code: 'off_state', defaultName: 'Off', kind: 'open' } },
    { method: 'PATCH', route: `${API}/statuses/:code`, payload: { defaultName: 'Renamed' } },
    { method: 'DELETE', route: `${API}/statuses/:code` },
    { method: 'PUT', route: `${API}/transitions`, payload: { add: [] } },
    { method: 'PUT', route: `${API}/order-status-mappings`, payload: { mappings: [] } },
    { method: 'PUT', route: `${API}/value-counting-statuses`, payload: { order: [], quoteRequest: [] } },
    { method: 'GET', route: `${API}/opportunities` },
    { method: 'POST', route: `${API}/opportunities`, payload: { title: 'Off', organizationId: ID, currency: 'PLN' } },
    { method: 'GET', route: `${API}/opportunities/:id` },
    { method: 'PATCH', route: `${API}/opportunities/:id`, payload: { title: 'Off' } },
    { method: 'DELETE', route: `${API}/opportunities/:id` },
    { method: 'POST', route: `${API}/opportunities/:id/transition`, payload: { to: 'qualified' } },
    { method: 'POST', route: `${API}/opportunities/:id/assign`, payload: { adminUserId: null } },
    { method: 'GET', route: `${API}/opportunities/:id/history` },
    { method: 'GET', route: `${API}/opportunities/:id/attachments` },
    { method: 'POST', route: `${API}/opportunities/:id/attachments`, payload: { assetId: CHILD } },
    { method: 'DELETE', route: `${API}/opportunities/:id/attachments/:attachmentId` },
    { method: 'GET', route: `${API}/opportunities/:id/comments` },
    { method: 'POST', route: `${API}/opportunities/:id/comments`, payload: { kind: 'note', body: 'Off' } },
    { method: 'PATCH', route: `${API}/opportunities/:id/comments/:commentId`, payload: { body: 'Off' } },
    { method: 'DELETE', route: `${API}/opportunities/:id/comments/:commentId` },
    { method: 'PUT', route: `${API}/opportunities/:id/tags`, payload: { tagIds: [] } },
    { method: 'GET', route: `${API}/tags` },
    { method: 'POST', route: `${API}/tags`, payload: { name: 'Off' } },
    { method: 'PATCH', route: `${API}/tags/:id`, payload: { name: 'Off' } },
    { method: 'DELETE', route: `${API}/tags/:id` },
    { method: 'POST', route: `${API}/opportunities/:id/links`, payload: { documentKind: 'order', documentId: CHILD } },
    { method: 'PATCH', route: `${API}/opportunities/:id/links/:linkId`, payload: { syncStatus: false } },
    { method: 'DELETE', route: `${API}/opportunities/:id/links/:linkId` },
    { method: 'POST', route: `${API}/opportunities/:id/propagations/:propagationId/retry` },
    { method: 'POST', route: `${API}/opportunities/:id/propagations/:propagationId/dismiss` },
  ];

  const ROUTES: OffStateProbe[] = REGISTERED.map(({ method, route, payload }) => ({
    method,
    url: route
      .replace(':id', ID)
      .replace(':linkId', CHILD)
      .replace(':commentId', CHILD)
      .replace(':attachmentId', CHILD)
      .replace(':propagationId', CHILD)
      .replace(':code', 'new'),
    cookies: admin,
    ...(payload === undefined ? {} : { payload }),
  }));

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers while on — the positive control', async () => {
    const response = await h.app.inject({ method: 'GET', url: WORKFLOW_URL, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { data: { statuses: Array<{ code: string }> } };
    expect(body.data.statuses.map((status) => status.code)).toContain('new');
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'crm', {
      routes: ROUTES,
      adminPresence: { cookies: admin },
      settingWrite: {
        code: 'crm.auto_create_from_orders',
        value: true,
        cookies: admin,
      },
    });
  });

  /** The command-palette entries the server advertises for this module, in id order. */
  const paletteActionIds = async (): Promise<string[]> => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
      cookies: admin,
    });
    expect(response.statusCode, 'the palette registry must answer').toBe(200);
    const body = response.json() as { data: { data: { actionId: string; moduleId: string }[] } };
    return body.data.data
      .filter((action) => action.moduleId === 'crm')
      .map((action) => action.actionId)
      .sort();
  };

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'advertises its palette actions while on and none while %s',
    async (axis) => {
      // The palette's Actions group is resolved by the server, from the
      // manifests, against the effective enabled-set — no admin-side test can
      // see it. Positive control first: a registry answering nothing to anybody
      // would otherwise pass.
      const declared = ['new-opportunity', 'open-opportunities', 'open-opportunity-board'];
      expect(await paletteActionIds()).toEqual(declared);
      await withModuleOff('crm', axis, async () => {
        expect(await paletteActionIds()).toEqual([]);
      });
      expect(await paletteActionIds()).toEqual(declared);
    },
  );

  it('answers again once restored', async () => {
    const response = await h.app.inject({ method: 'GET', url: WORKFLOW_URL, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
    const list = await h.app.inject({ method: 'GET', url: `${API}/opportunities`, cookies: admin });
    expect(list.statusCode, list.body).toBe(200);
  });

  describe('the reverse-mapping subscriber (order.status_changed.v1)', () => {
    const statusOf = async (opportunityId: string) =>
      (await h.em().findOneOrFail(CrmOpportunity, { id: opportunityId }, { filters: false })).statusCode;

    const linkedPair = async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      return { opportunityId: opportunity.id, orderId: order.id };
    };

    beforeAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
      const mapped = await setCrmMappings(h, [
        { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
      ]);
      expect(mapped.statusCode, mapped.body).toBe(200);
    });

    afterAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
    });

    it('moves the Opportunity while on — the positive control', async () => {
      const { opportunityId, orderId } = await linkedPair();
      await changeOrderStatusAsOperator(h, orderId, 'paid');
      expect(await statusOf(opportunityId)).toBe('qualified');
    });

    it('moves nothing and records nothing while deactivated, and moves again once reactivated', async () => {
      const whileOff = await linkedPair();
      await withModuleOff('crm', 'deactivated', async () => {
        await changeOrderStatusAsOperator(h, whileOff.orderId, 'paid');
        expect(await statusOf(whileOff.opportunityId)).toBe('new');
        expect(
          await h.em().count(CrmStatusPropagation, { opportunityId: whileOff.opportunityId }, { filters: false }),
        ).toBe(0);
      });
      // Nothing is replayed: the change made while off stays unanswered.
      expect(await statusOf(whileOff.opportunityId)).toBe('new');

      const after = await linkedPair();
      await changeOrderStatusAsOperator(h, after.orderId, 'paid');
      expect(await statusOf(after.opportunityId)).toBe('qualified');
    });

    it('moves nothing while platform-unavailable', async () => {
      const pair = await linkedPair();
      await withModuleOff('crm', 'platform-unavailable', async () => {
        await changeOrderStatusAsOperator(h, pair.orderId, 'paid');
        expect(await statusOf(pair.opportunityId)).toBe('new');
      });
    });
  });

  describe('the value subscribers (order.status_changed.v1, rfq.*, order.created.v1)', () => {
    const storedValue = async (opportunityId: string) =>
      (await h.em().findOneOrFail(CrmOpportunity, { id: opportunityId }, { filters: false })).computedValue;

    const linksOf = async (opportunityId: string) =>
      h.em().count(CrmOpportunityLink, { opportunityId }, { filters: false });

    const computedWithOrder = async () => {
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      return { opportunityId: opportunity.id, orderId: order.id };
    };

    const computedWithQuoteRequest = async () => {
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const rfq = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
      return { opportunityId: opportunity.id, rfq };
    };

    const cancelQuoteRequest = (rfq: { id: string; version: number }) =>
      whenCrmEventSettled(h, 'rfq.canceled.v1', (payload) => payload['rfqId'] === rfq.id, async () => {
        const response = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/quote-requests/${rfq.id}/cancel`,
          cookies: admin,
          headers: { 'if-match': `"${rfq.version}"` },
          payload: { reason: 'Off-state probe' },
        });
        expect(response.statusCode, response.body).toBe(200);
      });

    const announceOrder = (orderId: string) =>
      whenCrmEventSettled(h, 'order.created.v1', (payload) => payload['orderId'] === orderId, async () => {
        h.eventBus.emit('order.created.v1' as never, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          orderId,
          organizationId: TEST_ORGANIZATION_ID,
        } as never);
      });

    beforeAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
      const configured = await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: ['Pending'] });
      expect(configured.statusCode, configured.body).toBe(202);
    });

    afterAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
    });

    it('recalculate while on — the positive controls', async () => {
      const withOrder = await computedWithOrder();
      await changeOrderStatusAsOperator(h, withOrder.orderId, 'paid');
      expect(await storedValue(withOrder.opportunityId)).toBe('123.00');

      const withQuote = await computedWithQuoteRequest();
      expect(await storedValue(withQuote.opportunityId)).toBe('84.00');
      await cancelQuoteRequest(withQuote.rfq);
      expect(await storedValue(withQuote.opportunityId)).toBe('0.00');

      const conversion = await computedWithQuoteRequest();
      const placed = await seedCrmOrder(h.em(), { sourceQuoteRequestId: conversion.rfq.id });
      await announceOrder(placed.id);
      expect(await linksOf(conversion.opportunityId)).toBe(2);
    });

    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'recalculate nothing and link nothing while %s, and nothing is replayed afterwards',
      async (axis) => {
        const withOrder = await computedWithOrder();
        const withQuote = await computedWithQuoteRequest();
        const conversion = await computedWithQuoteRequest();
        const placed = await seedCrmOrder(h.em(), { sourceQuoteRequestId: conversion.rfq.id });

        await withModuleOff('crm', axis, async () => {
          await changeOrderStatusAsOperator(h, withOrder.orderId, 'paid');
          expect(await storedValue(withOrder.opportunityId)).toBe('0.00');
          await cancelQuoteRequest(withQuote.rfq);
          expect(await storedValue(withQuote.opportunityId)).toBe('84.00');
          await announceOrder(placed.id);
          expect(await linksOf(conversion.opportunityId)).toBe(1);
        });

        expect(await storedValue(withOrder.opportunityId)).toBe('0.00');
        expect(await storedValue(withQuote.opportunityId)).toBe('84.00');
        expect(await linksOf(conversion.opportunityId)).toBe(1);
      },
    );
  });

  describe('automatic creation (order.created.v1, rfq.created.v1) and its two settings', () => {
    const SETTINGS = [
      CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS,
      CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS,
    ] as const;

    const opportunityCount = () => h.em().count(CrmOpportunity, {}, { filters: false });

    const placeOrder = () => whenCrmEventSettled(h, 'order.created.v1', () => true, () => placeCrmOrder(h));

    const submitQuoteRequest = () =>
      whenCrmEventSettled(h, 'rfq.created.v1', () => true, () => submitCrmQuoteRequest(h));

    beforeAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
      await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
      for (const code of SETTINGS) await setCrmSetting(h, code, true);
    });

    afterAll(async () => {
      for (const code of SETTINGS) await setCrmSetting(h, code, false);
      await restoreDefaultCrmWorkflow(h.em());
    });

    it('creates an Opportunity per placed document while on — the positive control', async () => {
      const before = await opportunityCount();
      await placeOrder();
      await submitQuoteRequest();
      expect(await opportunityCount()).toBe(before + 2);
    });

    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'creates nothing while %s with both settings on, and nothing retroactively afterwards',
      async (axis) => {
        const before = await opportunityCount();
        let orderId = '';
        await withModuleOff('crm', axis, async () => {
          orderId = (await placeOrder()).id;
          await submitQuoteRequest();
          expect(await opportunityCount()).toBe(before);
        });
        // Back on: the documents placed meanwhile stay without an Opportunity.
        expect(await opportunityCount()).toBe(before);
        expect(
          await h.em().count(CrmOpportunityLink, { documentKind: 'order', documentId: orderId }, { filters: false }),
        ).toBe(0);
        // And the next one placed gets its own again.
        await placeOrder();
        expect(await opportunityCount()).toBe(before + 1);
      },
    );

    it.each(SETTINGS)('%s is writable while on and refused while off', async (code) => {
      // The positive control, with the body the Settings screen sends: a
      // malformed write is refused in every state and would prove nothing.
      const whileOn = await writeCrmSetting(h, code, true);
      expect(whileOn.statusCode, whileOn.body).toBe(200);
      for (const axis of ['deactivated', 'platform-unavailable'] as const) {
        await withModuleOff('crm', axis, async () => {
          const refused = await writeCrmSetting(h, code, false);
          // By name: a body the schema refuses is a 400 as well.
          expect(refused.statusCode, `${axis}: ${refused.body}`).toBe(400);
          expect(refused.json().error.code, `${axis}: ${refused.body}`).toBe('MODULE_SETTING_READ_ONLY');
        });
      }
      // Nothing was written through the refused calls.
      const after = await writeCrmSetting(h, code, true);
      expect(after.statusCode, after.body).toBe(200);
    });
  });

  describe('documents created from an Opportunity (order.created.v1 and rfq.created_by_admin.v1 with an origin)', () => {
    /** `POST /api/v1/admin/orders`, as the create-order screen sends it. */
    const createOrder = (origin?: { type: string; id: string }) =>
      whenCrmEventSettled(h, 'order.created.v1', () => true, async () => {
        const events: Array<Record<string, unknown>> = [];
        const off = h.eventBus.on('order.created.v1' as never, (payload: unknown) => {
          events.push(payload as Record<string, unknown>);
        });
        try {
          const response = await h.app.inject({
            method: 'POST',
            url: '/api/v1/admin/orders',
            cookies: admin,
            payload: {
              customerAccountId: TEST_CUSTOMER_ID,
              salesChannelId: '00000000-0000-4000-8000-0000000000c1',
              items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
              deliveryMethodId: SEED_DELIVERY_METHOD_ID,
              paymentMethodId: SEED_PAYMENT_METHOD_ID,
              deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
              billingAddressId: SEED_ADDRESS_BILLING_ID,
              ...(origin ? { origin } : {}),
            },
          });
          expect(response.statusCode, response.body).toBe(201);
          const data = (response.json() as { data: Record<string, unknown> & { id: string } }).data;
          return { data, events };
        } finally {
          off();
        }
      });

    /** `POST /api/v1/admin/quote-requests`, as the create screen sends it. */
    const createQuoteRequest = (origin?: { type: string; id: string }) =>
      whenCrmEventSettled(h, 'rfq.created_by_admin.v1', () => true, async () => {
        const events: Array<Record<string, unknown>> = [];
        const off = h.eventBus.on('rfq.created_by_admin.v1' as never, (payload: unknown) => {
          events.push(payload as Record<string, unknown>);
        });
        try {
          const response = await h.app.inject({
            method: 'POST',
            url: '/api/v1/admin/quote-requests',
            cookies: admin,
            payload: {
              organizationId: TEST_ORGANIZATION_ID,
              customerAccountId: TEST_CUSTOMER_ID,
              items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 10 }],
              ...(origin ? { origin } : {}),
            },
          });
          expect(response.statusCode, response.body).toBe(201);
          const data = (response.json() as { data: Record<string, unknown> & { id: string } }).data;
          await new Promise((resolve) => setImmediate(resolve));
          return { data, events };
        } finally {
          off();
        }
      });

    const linksOf = (documentId: string) =>
      h.em().count(CrmOpportunityLink, { documentId }, { filters: false });
    const opportunityCount = () => h.em().count(CrmOpportunity, {}, { filters: false });

    beforeAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
      await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
    });

    it('links the Order while on — the positive control', async () => {
      const opportunity = await createCrmOpportunity(h);
      const { data } = await createOrder({ type: 'crm_opportunity', id: opportunity.id });
      expect(
        await h.em().count(
          CrmOpportunityLink,
          { opportunityId: opportunity.id, documentKind: 'order', documentId: data.id },
          { filters: false },
        ),
      ).toBe(1);
    });

    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'while %s `orders` accepts the origin, answers and announces as it does without CRM, and nothing is linked — then or afterwards',
      async (axis) => {
        const opportunity = await createCrmOpportunity(h);
        const origin = { type: 'crm_opportunity', id: opportunity.id };
        const plain = await createOrder();
        const before = await opportunityCount();
        let orderId = '';
        await withModuleOff('crm', axis, async () => {
          const created = await createOrder(origin);
          orderId = created.data.id;
          // The response is the one an Order without an origin gets.
          expect(Object.keys(created.data).sort()).toEqual(Object.keys(plain.data).sort());
          expect(created.data).not.toHaveProperty('origin');
          // The event is `orders`' own, whoever listens: the origin is echoed.
          expect(created.events).toEqual([
            expect.objectContaining({ orderId, organizationId: TEST_ORGANIZATION_ID, origin }),
          ]);
          expect(await linksOf(orderId)).toBe(0);
          expect(await opportunityCount()).toBe(before);
        });
        // Back on: an Order created meanwhile is not linked retroactively.
        expect(await linksOf(orderId)).toBe(0);
        expect(await opportunityCount()).toBe(before);
      },
    );

    it('links the Quote Request while on — the positive control', async () => {
      const opportunity = await createCrmOpportunity(h);
      const { data } = await createQuoteRequest({ type: 'crm_opportunity', id: opportunity.id });
      expect(
        await h.em().count(
          CrmOpportunityLink,
          { opportunityId: opportunity.id, documentKind: 'quote_request', documentId: data.id },
          { filters: false },
        ),
      ).toBe(1);
    });

    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'while %s `quote_requests` accepts the origin, answers and announces as it does without CRM, and nothing is linked — then or afterwards',
      async (axis) => {
        const opportunity = await createCrmOpportunity(h);
        const origin = { type: 'crm_opportunity', id: opportunity.id };
        const plain = await createQuoteRequest();
        // With both automatic-creation settings on, to show that nothing creates either.
        await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, true);
        const before = await opportunityCount();
        let quoteRequestId = '';
        try {
          await withModuleOff('crm', axis, async () => {
            const created = await createQuoteRequest(origin);
            quoteRequestId = created.data.id;
            expect(Object.keys(created.data).sort()).toEqual(Object.keys(plain.data).sort());
            expect(created.data).not.toHaveProperty('origin');
            expect(created.events).toEqual([
              expect.objectContaining({ rfqId: quoteRequestId, organizationId: TEST_ORGANIZATION_ID, origin }),
            ]);
            expect(await linksOf(quoteRequestId)).toBe(0);
            expect(await opportunityCount()).toBe(before);
          });
          expect(await linksOf(quoteRequestId)).toBe(0);
          expect(await opportunityCount()).toBe(before);
        } finally {
          await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
        }
      },
    );
  });

  it('probes routes that exist — a refused path the module never registered would prove nothing', () => {
    // The positive control for the whole list, without running a single write:
    // every probed method and path is one the composed application routes.
    for (const { method, route } of REGISTERED) {
      expect(h.app.hasRoute({ method, url: route }), `${method} ${route}`).toBe(true);
    }
  });
});
