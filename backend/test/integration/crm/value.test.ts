import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  OpportunityDetailResponseSchema,
  OpportunityLinkResponseSchema,
  OpportunityWorkflowResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CrmOpportunity, QuoteRequest } from '../../helpers/package-entities.js';
import {
  changeOrderStatusAsOperator,
  CRM_ADMIN,
  CRM_API,
  CRM_CUSTOMER,
  createCrmOpportunity,
  linkCrmOrder,
  linkCrmQuoteRequest,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  setCrmCountingStatuses,
  submitCrmQuoteRequest,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';

/**
 * User Story 8 — Quote Requests and a computed Opportunity value
 * (`specs/143-crm-sales-opportunities/spec.md`, FR-020, FR-027, FR-030–FR-033),
 * against the real `orders` and `quote_requests`.
 *
 * The counting configuration for the whole file: an Order counts once `paid`;
 * a Quote Request counts while `Pending` or `Approved`.
 */
describe('crm computed value and Quote Request links (US8)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = CRM_ADMIN,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const detail = async (id: string) =>
    OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${id}`)).json()).data;

  const computed = (body: Record<string, unknown> = {}) =>
    createCrmOpportunity(h, { valueMode: 'computed', ...body });

  const rfqSettled = <T>(eventName: string, rfqId: string, act: () => Promise<T>) =>
    whenCrmEventSettled(h, eventName, (payload) => payload['rfqId'] === rfqId, act);

  /** The administrator names a price; the request stays `Pending` until the customer answers. */
  const agreePrice = async (rfq: { id: string; version: number }, quantity: number, agreedUnitPrice: number) => {
    const response = await rfqSettled('rfq.modified.v1', rfq.id, () =>
      h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${rfq.id}`,
        cookies: CRM_ADMIN,
        headers: { 'if-match': `"${rfq.version}"` },
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity, agreedUnitPrice }] },
      }),
    );
    expect(response.statusCode, response.body).toBe(200);
  };

  const acceptRevision = async (rfqId: string) => {
    const current = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${rfqId}`,
      cookies: CRM_CUSTOMER,
    });
    const { currentRevisionNumber } = (current.json() as { data: { currentRevisionNumber: number } }).data;
    const response = await rfqSettled('rfq.approved.v1', rfqId, () =>
      h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${rfqId}/accept-revision`,
        cookies: CRM_CUSTOMER,
        payload: { expectedRevisionNumber: currentRevisionNumber },
      }),
    );
    expect(response.statusCode, response.body).toBe(200);
  };

  /** What the quote desk shows for a request: `Σ agreed unit price × quantity` over its lines. */
  const quoteDeskTotal = async (rfqId: string): Promise<number> => {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${rfqId}`,
      cookies: CRM_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    const { items } = (
      response.json() as { data: { items: Array<{ agreedUnitPrice: number | null; quantity: number }> } }
    ).data;
    expect(items.every((item) => item.agreedUnitPrice !== null)).toBe(true);
    return items.reduce((sum, item) => sum + (item.agreedUnitPrice ?? 0) * item.quantity, 0);
  };

  /** The body of the recalculation job, as its consumer runs it. */
  const runRecalculationJob = () =>
    enterSystemScope('test: crm value recalculation job', () =>
      (
        h.container.resolve('crmOpportunityValueService') as { recalculateAll(): Promise<number> }
      ).recalculateAll(),
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Value other');
    const configured = await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: ['Pending', 'Approved'] });
    expect(configured.statusCode, configured.body).toBe(202);
  });

  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('linking a Quote Request', () => {
    it('links one of the same Organization and lists it with its number, status and value', async () => {
      const opportunity = await createCrmOpportunity(h);
      const rfq = await submitCrmQuoteRequest(h, { quantity: 7, desiredUnitPrice: 12 });

      const response = await linkCrmQuoteRequest(h, opportunity.id, rfq.id);
      expect(response.statusCode, response.body).toBe(201);
      const link = OpportunityLinkResponseSchema.parse(response.json()).data;
      expect(link).toMatchObject({
        documentKind: 'quote_request',
        documentId: rfq.id,
        available: true,
        number: rfq.businessId,
        status: 'Pending',
        total: '84.00',
        currency: 'PLN',
        linkSource: 'manual',
      });

      const read = await detail(opportunity.id);
      expect(read.links).toHaveLength(1);
      expect(read.links[0]).toMatchObject({ id: link.id, documentKind: 'quote_request', total: '84.00' });
    });

    it('takes several Quote Requests and several Orders on one Opportunity', async () => {
      const opportunity = await createCrmOpportunity(h);
      const first = await submitCrmQuoteRequest(h);
      const second = await submitCrmQuoteRequest(h);
      const order = await seedCrmOrder(h.em());
      const otherOrder = await seedCrmOrder(h.em());
      for (const rfq of [first, second]) {
        expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
      }
      for (const linked of [order, otherOrder]) {
        expect((await linkCrmOrder(h, opportunity.id, linked.id)).statusCode).toBe(201);
      }
      const kinds = (await detail(opportunity.id)).links.map((link) => link.documentKind);
      expect(kinds.filter((kind) => kind === 'quote_request')).toHaveLength(2);
      expect(kinds.filter((kind) => kind === 'order')).toHaveLength(2);
    });

    it('refuses a Quote Request that is already linked — 409, naming the Opportunity that holds it', async () => {
      const holder = await createCrmOpportunity(h);
      const other = await createCrmOpportunity(h);
      const rfq = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, holder.id, rfq.id)).statusCode).toBe(201);

      const refused = await linkCrmQuoteRequest(h, other.id, rfq.id);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.code).toBe('CRM_DOCUMENT_ALREADY_LINKED');
      expect(refused.json().error.details.opportunityId).toBe(holder.id);
    });

    it('refuses a Quote Request of another Organization — 422 CRM_LINK_ORGANIZATION_MISMATCH', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: otherOrganizationId });
      const rfq = await submitCrmQuoteRequest(h);
      const refused = await linkCrmQuoteRequest(h, foreign.id, rfq.id);
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe('CRM_LINK_ORGANIZATION_MISMATCH');
    });

    it('answers 404 CRM_DOCUMENT_NOT_FOUND for a Quote Request that does not exist', async () => {
      const opportunity = await createCrmOpportunity(h);
      const refused = await linkCrmQuoteRequest(h, opportunity.id, randomUUID());
      expect(refused.statusCode, refused.body).toBe(404);
      expect(refused.json().error.code).toBe('CRM_DOCUMENT_NOT_FOUND');
    });

    it('answers the same 404 for a Quote Request outside the caller’s Organizations', async () => {
      // A Sales Representative confined to the other Organization: the request
      // of the test Organization does not exist for them.
      const rep = await seedCrmSalesRep(h.em(), [otherOrganizationId], ['crm:read', 'crm:write', 'orders:read']);
      try {
        const own = await createCrmOpportunity(h, { organizationId: otherOrganizationId });
        const rfq = await submitCrmQuoteRequest(h);
        const refused = await linkCrmQuoteRequest(h, own.id, rfq.id, rep.cookies);
        expect(refused.statusCode, refused.body).toBe(404);
        expect(refused.json().error.code).toBe('CRM_DOCUMENT_NOT_FOUND');
        // The positive control: the platform administrator is told it exists
        // and belongs elsewhere.
        const asAdmin = await linkCrmQuoteRequest(h, own.id, rfq.id);
        expect(asAdmin.statusCode, asAdmin.body).toBe(422);
      } finally {
        rep.undo();
      }
    });
  });

  describe('value mode', () => {
    it('manual: the value stays what was typed, whatever is linked or changes', async () => {
      const opportunity = await createCrmOpportunity(h, { manualValue: '500.00' });
      const order = await seedCrmOrder(h.em(), { status: 'paid' });
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      const rfq = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);

      const read = await detail(opportunity.id);
      expect(read).toMatchObject({ valueMode: 'manual', value: '500.00', manualValue: '500.00' });
      expect(read.excludedDocuments).toEqual([]);
    });

    it('switching to computed recalculates; switching back restores the typed figure', async () => {
      const opportunity = await createCrmOpportunity(h, { manualValue: '500.00' });
      const order = await seedCrmOrder(h.em(), { status: 'paid' });
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

      const toComputed = await call('PATCH', `/opportunities/${opportunity.id}`, { valueMode: 'computed' });
      expect(toComputed.statusCode, toComputed.body).toBe(200);
      expect(OpportunityDetailResponseSchema.parse(toComputed.json()).data).toMatchObject({
        valueMode: 'computed',
        value: '123.00',
        computedValue: '123.00',
        manualValue: '500.00',
      });

      const toManual = await call('PATCH', `/opportunities/${opportunity.id}`, { valueMode: 'manual' });
      expect(OpportunityDetailResponseSchema.parse(toManual.json()).data).toMatchObject({
        valueMode: 'manual',
        value: '500.00',
      });
    });
  });

  describe('computed: the value follows the linked documents', () => {
    it('link and unlink', async () => {
      const opportunity = await computed();
      expect((await detail(opportunity.id)).value).toBe('0.00');

      const order = await seedCrmOrder(h.em(), { status: 'paid' });
      const linked = await linkCrmOrder(h, opportunity.id, order.id);
      expect(linked.statusCode, linked.body).toBe(201);
      expect((await detail(opportunity.id)).value).toBe('123.00');

      const second = await seedCrmOrder(h.em(), { status: 'paid', total: '0.10' });
      expect((await linkCrmOrder(h, opportunity.id, second.id)).statusCode).toBe(201);
      expect((await detail(opportunity.id)).value).toBe('123.10');

      const linkId = OpportunityLinkResponseSchema.parse(linked.json()).data.id;
      expect((await call('DELETE', `/opportunities/${opportunity.id}/links/${linkId}`)).statusCode).toBe(204);
      expect((await detail(opportunity.id)).value).toBe('0.10');
    });

    it('an Order entering and leaving a counting status (order.status_changed.v1)', async () => {
      const opportunity = await computed();
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      expect((await detail(opportunity.id)).value).toBe('0.00');

      await changeOrderStatusAsOperator(h, order.id, 'paid');
      expect((await detail(opportunity.id)).value).toBe('123.00');

      await changeOrderStatusAsOperator(h, order.id, 'processing');
      expect((await detail(opportunity.id)).value).toBe('0.00');
    });

    it('a Quote Request modified, then approved — and the figure is the quote desk’s', async () => {
      const opportunity = await computed();
      const rfq = await submitCrmQuoteRequest(h, { quantity: 7, desiredUnitPrice: 12 });
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
      // Pending counts in this file, at the price the customer asked for.
      expect((await detail(opportunity.id)).value).toBe('84.00');

      await agreePrice(rfq, 7, 11.25);
      expect((await detail(opportunity.id)).value).toBe('78.75');

      await acceptRevision(rfq.id);
      const read = await detail(opportunity.id);
      expect(read.links[0]).toMatchObject({ status: 'Approved', total: '78.75' });
      expect(read.value).toBe('78.75');
      expect(Number(read.value)).toBe(await quoteDeskTotal(rfq.id));
    });

    it('a Quote Request canceled', async () => {
      const opportunity = await computed();
      const rfq = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
      expect((await detail(opportunity.id)).value).toBe('84.00');

      const canceled = await rfqSettled('rfq.canceled.v1', rfq.id, () =>
        h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/quote-requests/${rfq.id}/cancel`,
          cookies: CRM_ADMIN,
          headers: { 'if-match': `"${rfq.version}"` },
          payload: { reason: 'Out of stock for the requested volume' },
        }),
      );
      expect(canceled.statusCode, canceled.body).toBe(200);
      expect((await detail(opportunity.id)).value).toBe('0.00');
    });

    it('a Quote Request expired', async () => {
      const opportunity = await computed();
      const rfq = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
      expect((await detail(opportunity.id)).value).toBe('84.00');

      // What the expiry worker does to a request past its deadline, and the
      // event it announces it with.
      await h
        .em()
        .getConnection()
        .execute(`update "quote_requests" set "status" = 'Expired', "expired_at" = now() where "id" = ?`, [rfq.id]);
      await rfqSettled('rfq.expired.v1', rfq.id, async () => {
        h.eventBus.emit('rfq.expired.v1' as never, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          rfqId: rfq.id,
        } as never);
      });
      expect((await detail(opportunity.id)).value).toBe('0.00');
    });

    it('leaves out and names a document in another currency', async () => {
      const opportunity = await computed();
      const euro = await seedCrmOrder(h.em(), { status: 'paid', currency: 'EUR', total: '40.00' });
      const zloty = await seedCrmOrder(h.em(), { status: 'paid', total: '60.00' });
      for (const order of [euro, zloty]) {
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      }
      const read = await detail(opportunity.id);
      expect(read.value).toBe('60.00');
      expect(read.excludedDocuments).toEqual([{ kind: 'order', id: euro.id, reason: 'currency_mismatch' }]);
    });

    it('writes no audit entry for a recalculation and does not bump the version', async () => {
      const opportunity = await computed();
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      const before = await detail(opportunity.id);

      await changeOrderStatusAsOperator(h, order.id, 'paid');
      const after = await detail(opportunity.id);
      expect(after.value).toBe('123.00');
      expect(after.version).toBe(before.version);
      const entries = await h.auditLogService.query({ objectType: 'crm_opportunity', objectId: opportunity.id });
      expect(entries.map((entry) => entry.action)).toContain('crm.opportunity.link_add');
      expect(entries.map((entry) => entry.action)).not.toContain('crm.opportunity.value_recalculate');
    });
  });

  describe('an Order placed from a linked Quote Request', () => {
    it('joins the Opportunity automatically, as a quote conversion, and is counted once', async () => {
      const opportunity = await computed();
      const rfq = await submitCrmQuoteRequest(h, { quantity: 7, desiredUnitPrice: 12 });
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
      expect((await detail(opportunity.id)).value).toBe('84.00');

      // The Order is written directly, naming the request it came from, and
      // announced — the fixture `quote_requests`' own completion test uses.
      const order = await seedCrmOrder(h.em(), { status: 'paid', total: '96.86', sourceQuoteRequestId: rfq.id });
      await whenCrmEventSettled(
        h,
        'order.created.v1',
        (payload) => payload['orderId'] === order.id,
        async () => {
          h.eventBus.emit('order.created.v1' as never, {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            orderId: order.id,
            organizationId: TEST_ORGANIZATION_ID,
          } as never);
        },
      );

      const read = await detail(opportunity.id);
      const orderLink = read.links.find((link) => link.documentKind === 'order');
      expect(orderLink).toMatchObject({ documentId: order.id, linkSource: 'quote_conversion', available: true });
      // The request and the Order are one piece of business: the Order's
      // figure, not the two added together.
      expect(read.value).toBe('96.86');
      const quote = await h.em().findOneOrFail(QuoteRequest, { id: rfq.id }, { filters: false });
      expect(quote.convertedOrderId).toBe(order.id);
    });

    it('announcing the same Order twice links it once', async () => {
      const opportunity = await computed();
      const rfq = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
      const order = await seedCrmOrder(h.em(), { status: 'paid', sourceQuoteRequestId: rfq.id });
      for (let delivery = 0; delivery < 2; delivery += 1) {
        await whenCrmEventSettled(
          h,
          'order.created.v1',
          (payload) => payload['orderId'] === order.id,
          async () => {
            h.eventBus.emit('order.created.v1' as never, {
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),
              orderId: order.id,
              organizationId: TEST_ORGANIZATION_ID,
            } as never);
          },
        );
      }
      const links = (await detail(opportunity.id)).links.filter((link) => link.documentKind === 'order');
      expect(links).toHaveLength(1);
    });
  });

  describe('PUT /value-counting-statuses', () => {
    it('answers 202 with the saved set, and every computed Opportunity follows once the job has run', async () => {
      const first = await computed();
      const second = await computed();
      const manual = await createCrmOpportunity(h, { manualValue: '9.00' });
      for (const opportunity of [first, second, manual]) {
        const order = await seedCrmOrder(h.em(), { status: 'paid' });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      }
      expect((await detail(first.id)).value).toBe('123.00');

      try {
        const saved = await setCrmCountingStatuses(h, { order: ['completed'], quoteRequest: [] });
        expect(saved.statusCode, saved.body).toBe(202);
        expect(OpportunityWorkflowResponseSchema.parse(saved.json()).data.valueCountingStatuses).toEqual({
          order: ['completed'],
          quoteRequest: [],
        });
        // Saved, not yet applied: the endpoint only enqueues.
        expect((await detail(first.id)).value).toBe('123.00');

        expect(await runRecalculationJob()).toBeGreaterThanOrEqual(2);
        expect((await detail(first.id)).value).toBe('0.00');
        expect((await detail(second.id)).value).toBe('0.00');
        expect((await detail(manual.id)).value).toBe('9.00');
        // Idempotent: a second pass has nothing left to change.
        expect(await runRecalculationJob()).toBe(0);
      } finally {
        const restored = await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: ['Pending', 'Approved'] });
        expect(restored.statusCode, restored.body).toBe(202);
        await runRecalculationJob();
      }
      expect((await detail(first.id)).value).toBe('123.00');
    });

    it('is audited as crm.value_counting.set', async () => {
      const saved = await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: ['Pending', 'Approved'] });
      expect(saved.statusCode, saved.body).toBe(202);
      const entries = await h.auditLogService.query({ action: 'crm.value_counting.set' });
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => entry.objectType === 'crm_value_counting')).toBe(true);
    });

    it('keeps the stored figure of an Opportunity the job cannot improve on', async () => {
      // The stored column is what the list and the board sort and add by.
      const opportunity = await computed();
      const order = await seedCrmOrder(h.em(), { status: 'paid', total: '10.50' });
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      const row = await h.em().findOneOrFail(CrmOpportunity, { id: opportunity.id }, { filters: false });
      expect(row.computedValue).toBe('10.50');
    });
  });
});
