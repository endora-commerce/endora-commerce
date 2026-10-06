import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  CRM_EVENTS,
  OpportunityDetailResponseSchema,
  type CustomFieldValuePort,
  type OrderReadPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  changeOrderStatusAsOperator,
  createCrmOpportunity,
  CRM_CUSTOMER,
  defineCrmCustomField,
  linkCrmOrder,
  linkCrmQuoteRequest,
  removeCrmCustomFields,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  setCrmCountingStatuses,
  setCrmForwardMappings,
  setCrmMappings,
  setCrmSetting,
  submitCrmQuoteRequest,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';

/**
 * The scenarios a second independent review of the module broke it with
 * (`specs/143-crm-sales-opportunities/research.md` N-S1 …), each kept as the
 * sequence that showed the defect.
 */
describe('crm second review regressions', () => {
  let h: BackendServerHandle;

  const detail = async (id: string, cookies: Record<string, string> = CRM_ADMIN) => {
    const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}`, cookies });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  const storedComputedValue = async (id: string): Promise<string> => {
    const rows = (await h.em().execute(`select "computed_value" from "crm_opportunities" where "id" = ?`, [
      id,
    ])) as Array<{ computed_value: string }>;
    return rows[0]?.computed_value ?? '';
  };

  const valueService = () =>
    h.container.resolve('crmOpportunityValueService') as { recalculate(id: string): Promise<boolean> };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await removeCrmCustomFields(h).catch(() => undefined);
    await setCrmCountingStatuses(h, { order: [], quoteRequest: [] });
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  // --- N-S1: a recalculation holds no transaction while it asks another module ---
  describe('a value recalculation reads the documents outside its transaction', () => {
    /**
     * `orders`' read port as the value service is handed it, with one call
     * intercepted: `during` runs once the first read has answered, while the
     * recalculation that asked is still between its read and its write.
     */
    const duringTheFirstOrderRead = (during: () => Promise<void>) => {
      const port = h.container.resolve('orderReadPort') as OrderReadPort;
      const original = port.findByIds.bind(port);
      let intercepted = false;
      vi.spyOn(port, 'findByIds').mockImplementation(async (ids) => {
        const answer = await original(ids);
        if (!intercepted) {
          intercepted = true;
          await during();
        }
        return answer;
      });
    };

    it(
      'more concurrent recalculations than the pool has connections all finish',
      async () => {
        expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
        const ids: string[] = [];
        for (let index = 0; index < 14; index += 1) {
          const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
          const order = await seedCrmOrder(h.em(), { status: 'paid', total: '10.00' });
          expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
          ids.push(opportunity.id);
        }
        // Make every figure wrong, so each recalculation has a write to make.
        await h.em().execute(`update "crm_opportunities" set "computed_value" = '1.00' where "id" in (?)`, [ids]);

        const started = Date.now();
        const settled = await Promise.allSettled(
          ids.map((id) => enterSystemScope('test: concurrent recalculation', () => valueService().recalculate(id))),
        );
        const elapsedMs = Date.now() - started;

        expect(settled.filter((outcome) => outcome.status === 'rejected')).toHaveLength(0);
        // A transaction waiting for a second connection gives up after 60 s.
        expect(elapsedMs).toBeLessThan(15_000);
        for (const id of ids) expect(await storedComputedValue(id)).toBe('10.00');
      },
      180_000,
    );

    it('a link that joins while the documents are being read is in the figure that is stored', async () => {
      expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const first = await seedCrmOrder(h.em(), { status: 'paid', total: '10.00' });
      const second = await seedCrmOrder(h.em(), { status: 'paid', total: '32.00' });
      expect((await linkCrmOrder(h, opportunity.id, first.id)).statusCode).toBe(201);
      expect(await storedComputedValue(opportunity.id)).toBe('10.00');

      // Written straight to the table: nothing else asks for a recalculation,
      // so the one under test is alone in having to notice.
      duringTheFirstOrderRead(async () => {
        await h.em().execute(
          `insert into "crm_opportunity_links"
             ("id", "opportunity_id", "document_kind", "document_id", "sync_status", "link_source", "created_at")
           values (?, ?, 'order', ?, true, 'manual', now())`,
          [randomUUID(), opportunity.id, second.id],
        );
      });
      await enterSystemScope('test: links change mid-recalculation', () =>
        valueService().recalculate(opportunity.id),
      );

      expect(await storedComputedValue(opportunity.id)).toBe('42.00');
    });

    it('a document that changes while it is being read does not leave the older figure behind', async () => {
      expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const order = await seedCrmOrder(h.em(), { status: 'new', total: '55.00' });
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      expect(await storedComputedValue(opportunity.id)).toBe('0.00');
      await h.em().execute(`update "orders" set "status" = 'paid' where "id" = ?`, [order.id]);

      // The read answered "paid"; the Order stops counting before the write.
      duringTheFirstOrderRead(async () => {
        await h.em().execute(`update "orders" set "status" = 'canceled' where "id" = ?`, [order.id]);
      });
      await enterSystemScope('test: a document changes mid-recalculation', () =>
        valueService().recalculate(opportunity.id),
      );

      expect(await storedComputedValue(opportunity.id)).toBe('0.00');
      expect((await detail(opportunity.id)).value).toBe('0.00');
    });
  });

  // --- N-S1: the same rule for the other port a Command of this module asked ---
  describe('an Opportunity write validates its custom fields outside its transaction', () => {
    /**
     * `custom_fields`' value port with every call recorded beside whether a
     * create or an update Command of this module was running when it was made.
     */
    const watchValidation = (during?: () => Promise<void>) => {
      const bus = h.container.resolve('commandBus') as { run(command: { action: string }): Promise<unknown> };
      const run = bus.run.bind(bus);
      let inside = 0;
      vi.spyOn(bus, 'run').mockImplementation(async (command) => {
        const watched = command.action === 'crm.opportunity.create' || command.action === 'crm.opportunity.update';
        if (watched) inside += 1;
        try {
          return await run(command);
        } finally {
          if (watched) inside -= 1;
        }
      });
      const port = h.container.resolve('customFieldValueService') as CustomFieldValuePort;
      const validate = port.validateAndMerge.bind(port);
      const calls: boolean[] = [];
      vi.spyOn(port, 'validateAndMerge').mockImplementation(async (entityType, current, patch) => {
        calls.push(inside > 0);
        const merged = await validate(entityType, current, patch);
        if (during && calls.length === 1) await during();
        return merged;
      });
      return calls;
    };

    it('neither a create nor an edit asks the port while its Command runs', async () => {
      await defineCrmCustomField(h, { key: 'review2_segment', valueType: 'text' });
      const calls = watchValidation();

      const created = await createCrmOpportunity(h, { customFieldValues: { review2_segment: 'smb' } });
      const edited = await h.app.inject({
        method: 'PATCH',
        url: `${CRM_API}/opportunities/${created.id}`,
        cookies: CRM_ADMIN,
        payload: { customFieldValues: { review2_segment: 'enterprise' } },
      });
      expect(edited.statusCode, edited.body).toBe(200);

      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls).not.toContain(true);
      expect((await detail(created.id)).customFieldValues).toEqual({ review2_segment: 'enterprise' });
    });

    it('an edit merges into the values the Opportunity has when it is locked, not the ones first read', async () => {
      await defineCrmCustomField(h, { key: 'review2_region', valueType: 'text' });
      const created = await createCrmOpportunity(h, { customFieldValues: { review2_segment: 'smb' } });
      // Somebody else's edit commits between this edit's validation and its lock.
      watchValidation(async () => {
        await h.em().execute(
          `update "crm_opportunities" set "custom_field_values" = '{"review2_segment":"smb","review2_region":"north"}'::jsonb where "id" = ?`,
          [created.id],
        );
      });

      const edited = await h.app.inject({
        method: 'PATCH',
        url: `${CRM_API}/opportunities/${created.id}`,
        cookies: CRM_ADMIN,
        payload: { customFieldValues: { review2_segment: 'enterprise' } },
      });
      expect(edited.statusCode, edited.body).toBe(200);

      expect((await detail(created.id)).customFieldValues).toEqual({
        review2_segment: 'enterprise',
        review2_region: 'north',
      });
    });
  });

  // --- N-S2: the announcement of a win says what the Opportunity is worth ---------
  describe('an Order whose status both counts and closes the Opportunity', () => {
    it('crm.opportunity.closed.v1 carries the value the Opportunity has once the Order counted', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
      const edge = await h.app.inject({
        method: 'PUT',
        url: `${CRM_API}/transitions`,
        cookies: CRM_ADMIN,
        payload: { add: [{ fromStatusCode: 'new', toStatusCode: 'won' }] },
      });
      expect(edge.statusCode, edge.body).toBe(200);
      const mapped = await setCrmMappings(h, [
        { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'won' },
      ]);
      expect(mapped.statusCode, mapped.body).toBe(200);

      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const order = await seedCrmOrder(h.em(), { total: '123.00' });
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      expect((await detail(opportunity.id)).value).toBe('0.00');

      const closed: Array<Record<string, unknown>> = [];
      const off = h.eventBus.on(CRM_EVENTS.CLOSED as never, (payload: unknown) => {
        const event = payload as Record<string, unknown>;
        if (event['opportunityId'] === opportunity.id) closed.push(event);
      });
      try {
        await changeOrderStatusAsOperator(h, order.id, 'paid');
      } finally {
        off();
      }

      const after = await detail(opportunity.id);
      expect(after.status.code).toBe('won');
      expect(after.value).toBe('123.00');
      // The payload an outbound webhook sends whole: what the win is worth.
      expect(closed).toHaveLength(1);
      expect(closed[0]?.['value']).toBe('123.00');
      await restoreDefaultCrmWorkflow(h.em());
    });

    it('the value announced is the one read after the commit, whatever the transition itself held', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const order = await seedCrmOrder(h.em(), { status: 'paid', total: '77.00' });
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      // The stored figure moves after the transition's own commit and before
      // its announcement — where the linked Orders are asked to follow, and
      // where their answers recalculate it.
      const propagation = h.container.resolve('crmOrderStatusPropagationService') as {
        resolve(...args: unknown[]): Promise<unknown>;
      };
      const resolve = propagation.resolve.bind(propagation);
      vi.spyOn(propagation, 'resolve').mockImplementation(async (...args) => {
        await h.em().execute(`update "crm_opportunities" set "computed_value" = '91.00' where "id" = ?`, [
          opportunity.id,
        ]);
        return resolve(...args);
      });
      const closed: Array<Record<string, unknown>> = [];
      const offClosed = h.eventBus.on(CRM_EVENTS.CLOSED as never, (payload: unknown) => {
        const event = payload as Record<string, unknown>;
        if (event['opportunityId'] === opportunity.id) closed.push(event);
      });
      try {
        const moved = await h.app.inject({
          method: 'POST',
          url: `${CRM_API}/opportunities/${opportunity.id}/transition`,
          cookies: CRM_ADMIN,
          payload: { to: 'lost' },
        });
        expect(moved.statusCode, moved.body).toBe(200);
      } finally {
        offClosed();
      }
      expect(closed).toHaveLength(1);
      expect(closed[0]?.['value']).toBe('91.00');
    });
  });

  // --- N-S3: a document that changes without saying so ------------------------------
  describe('a customer editing a linked Pending Quote Request', () => {
    const watchRequests = () => {
      const producer = h.container.resolve('crmValueRecalculationProducer') as {
        enqueueOne(opportunityId: string): Promise<boolean>;
      };
      return vi.spyOn(producer, 'enqueueOne');
    };

    it('the detail answers the live figure, writes nothing, and asks for that Opportunity to be recalculated', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      expect((await setCrmCountingStatuses(h, { order: [], quoteRequest: ['Pending'] })).statusCode).toBe(202);
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const rfq = await submitCrmQuoteRequest(h, { quantity: 7, desiredUnitPrice: 12 });
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);

      const requests = watchRequests();
      // In agreement: the read asks for nothing.
      expect((await detail(opportunity.id)).value).toBe('84.00');
      expect(requests).not.toHaveBeenCalled();

      // `quote_requests` announces nothing for a draft edit.
      const current = await h.app.inject({
        method: 'GET',
        url: `/api/v1/quote-requests/${rfq.id}`,
        cookies: CRM_CUSTOMER,
      });
      const version = (current.json() as { data: { version: number } }).data.version;
      const patched = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/${rfq.id}`,
        cookies: CRM_CUSTOMER,
        headers: { 'if-match': `"${version}"` },
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 100, desiredUnitPrice: 12 }] },
      });
      expect(patched.statusCode, patched.body).toBe(200);

      const after = await detail(opportunity.id);
      expect(after.links.find((link) => link.documentId === rfq.id)?.total).toBe('1200.00');
      expect(after.value).toBe('1200.00');
      expect(after.computedValue).toBe('1200.00');
      // A read is a read: the stored figure is the queue's to bring up to date.
      expect(await storedComputedValue(opportunity.id)).toBe('84.00');
      expect(requests).toHaveBeenCalledTimes(1);
      expect(requests).toHaveBeenCalledWith(opportunity.id);

      // What the job does with the request.
      await enterSystemScope('test: the requested recalculation', () => valueService().recalculate(opportunity.id));
      expect(await storedComputedValue(opportunity.id)).toBe('1200.00');
      requests.mockClear();
      expect((await detail(opportunity.id)).value).toBe('1200.00');
      expect(requests).not.toHaveBeenCalled();
    });

    it('a manual Opportunity is never asked about', async () => {
      const opportunity = await createCrmOpportunity(h, { valueMode: 'manual', manualValue: '5.00' });
      const requests = watchRequests();
      expect((await detail(opportunity.id)).value).toBe('5.00');
      expect(requests).not.toHaveBeenCalled();
    });

    it('a queue that cannot be reached does not fail the read', async () => {
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      await h.em().execute(`update "crm_opportunities" set "computed_value" = '9.00' where "id" = ?`, [
        opportunity.id,
      ]);
      watchRequests().mockRejectedValue(new Error('redis is away'));
      expect((await detail(opportunity.id)).value).toBe('0.00');
    });
  });

  // --- N-S4: a link never crosses a tenant, whatever an Order claims it came from ---
  describe('an Order of another Organization naming a linked Quote Request as its source', () => {
    it('is not linked to that Opportunity, and creates nothing', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const rfq = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);

      const organizationB = await seedCrmOrganization(h.em(), 'review2 other');
      const foreign = await seedCrmOrder(h.em(), {
        organizationId: organizationB,
        status: 'paid',
        sourceQuoteRequestId: rfq.id,
      });
      const service = h.container.resolve('crmOpportunityAutoCreateService') as {
        onOrderCreated(orderId: string): Promise<string>;
      };
      const outcome = await enterSystemScope('test: a foreign order claims a source', () =>
        service.onOrderCreated(foreign.id),
      );

      expect(outcome).not.toBe('joined');
      expect((await detail(opportunity.id)).links.map((link) => link.documentId)).toEqual([rfq.id]);
      const linked = (await h
        .em()
        .execute(`select "opportunity_id" from "crm_opportunity_links" where "document_id" = ?`, [
          foreign.id,
        ])) as unknown[];
      expect(linked).toEqual([]);
      const created = (await h
        .em()
        .execute(`select count(*)::int as n from "crm_opportunities" where "organization_id" = ?`, [
          organizationB,
        ])) as Array<{ n: number }>;
      expect(created[0]?.n).toBe(0);
    });
  });

  // --- N-S5: why an Order refused is the Order's to tell ---------------------------
  describe('a refused Order status change, for a caller without orders:read', () => {
    type Outcome = { id: string; orderNumber: string | null; detail: string | null; outcome: string };

    it('says nothing of the Order: not in the detail, the transition answer or the retry answer', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      expect((await setCrmForwardMappings(h, { lost: 'completed' })).statusCode).toBe(200);
      const writer = await seedCrmAdmin(h.em(), 'review2-writer', ['crm:read', 'crm:write']);
      try {
        const opportunity = await createCrmOpportunity(h);
        // The Order sits in a status of its own that this caller has no business knowing.
        const order = await seedCrmOrder(h.em(), { status: 'processing' });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

        const moved = await transitionCrmOpportunity(h, opportunity.id, 'lost', writer.cookies);
        expect(moved.statusCode, moved.body).toBe(200);
        const answered = (moved.json() as { data: { propagation: Outcome[] } }).data.propagation;
        expect(answered).toHaveLength(1);
        expect(answered[0]?.orderNumber).toBeNull();
        expect(answered[0]?.detail).toBeNull();
        expect(moved.body).not.toContain('processing');

        const read = await h.app.inject({
          method: 'GET',
          url: `${CRM_API}/opportunities/${opportunity.id}`,
          cookies: writer.cookies,
        });
        expect(read.statusCode, read.body).toBe(200);
        const unresolved = (read.json() as { data: { unresolvedPropagations: Outcome[] } }).data
          .unresolvedPropagations;
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]?.detail).toBeNull();
        expect(JSON.stringify(unresolved)).not.toContain('processing');

        const retried = await h.app.inject({
          method: 'POST',
          url: `${CRM_API}/opportunities/${opportunity.id}/propagations/${unresolved[0]?.id}/retry`,
          cookies: writer.cookies,
        });
        expect(retried.statusCode, retried.body).toBe(200);
        expect((retried.json() as { data: Outcome }).data.detail).toBeNull();
        expect(retried.body).not.toContain('processing');

        // Somebody who may read the Order is still told why.
        const full = (await detail(opportunity.id)).unresolvedPropagations;
        expect(full).toHaveLength(1);
        expect(full[0]?.orderNumber).not.toBeNull();
        expect(full[0]?.detail).toEqual(expect.any(String));
      } finally {
        writer.undo();
        await restoreDefaultCrmWorkflow(h.em());
      }
    });
  });

  // --- N-S7: guards a mutation used to survive -----------------------------------
  describe('guards that had no test', () => {
    const autoCreate = () =>
      h.container.resolve('crmOpportunityAutoCreateService') as {
        onOrderCreated(orderId: string): Promise<string>;
        idle(): Promise<void>;
      };

    const opportunitiesOf = async (orderId: string) =>
      (await h.em().execute(
        `select o."id", o."computed_value" from "crm_opportunities" o
           join "crm_opportunity_links" l on l."opportunity_id" = o."id"
          where l."document_id" = ?`,
        [orderId],
      )) as Array<{ id: string; computed_value: string }>;

    /** `orders`' read port answering "not there yet" to the first read of `orderId`: a commit still in flight. */
    const notReadableAtFirst = (orderId: string) => {
      const port = h.container.resolve('orderReadPort') as OrderReadPort;
      const original = port.findById.bind(port);
      let asked = false;
      vi.spyOn(port, 'findById').mockImplementation(async (id) => {
        if (id === orderId && !asked) {
          asked = true;
          return null;
        }
        return original(id);
      });
    };

    it('the same placed Order announced three times at one instant yields one Opportunity and no error', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
      try {
        const order = await seedCrmOrder(h.em());
        const outcomes = await Promise.allSettled(
          ['a', 'b', 'c'].map((delivery) =>
            enterSystemScope(`test: redelivery ${delivery}`, () => autoCreate().onOrderCreated(order.id)),
          ),
        );
        // The losers of the race are answered by the unique constraint, as a value.
        expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
        expect(await opportunitiesOf(order.id)).toHaveLength(1);
        const orphans = (await h.em().execute(
          `select count(*)::int as n from "crm_opportunities" o
            where o."source" = 'order' and o."organization_id" = ?
              and not exists (select 1 from "crm_opportunity_links" l where l."opportunity_id" = o."id")`,
          [TEST_ORGANIZATION_ID],
        )) as Array<{ n: number }>;
        expect(orphans[0]?.n).toBe(0);
      } finally {
        await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
      }
    });

    it('an Opportunity created for an Order that already counts is stored with that Order’s value', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
      try {
        const order = await seedCrmOrder(h.em(), { status: 'paid', total: '48.50' });
        const outcome = await enterSystemScope('test: a counting order is placed', () =>
          autoCreate().onOrderCreated(order.id),
        );
        expect(outcome).toBe('created');
        // The stored column, not the detail: the detail answers a live figure.
        expect((await opportunitiesOf(order.id)).map((row) => row.computed_value)).toEqual(['48.50']);
      } finally {
        await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
      }
    });

    it('a recalculation waits for whoever holds the Opportunity’s row', async () => {
      expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
      const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
      const order = await seedCrmOrder(h.em(), { status: 'paid', total: '10.00' });
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      // The figure is right already, so nothing but the lock can make it wait.
      expect(await storedComputedValue(opportunity.id)).toBe('10.00');

      let recalculation: Promise<unknown> = Promise.resolve();
      let whileHeld = '';
      await h.em().transactional(async (tx) => {
        await tx.execute(`select 1 from "crm_opportunities" where "id" = ? for update`, [opportunity.id]);
        recalculation = enterSystemScope('test: a recalculation meets a held row', () =>
          valueService().recalculate(opportunity.id),
        );
        whileHeld = await Promise.race([
          recalculation.then(() => 'finished'),
          new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 500)),
        ]);
      });
      expect(whileHeld).toBe('waiting');
      await expect(recalculation).resolves.toBe(false);
    });

    it('a placed Order read again after its commit is handled — and not at all while crm is off', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
      try {
        // The control: the deferred look does create, with the module on.
        const handled = await seedCrmOrder(h.em());
        notReadableAtFirst(handled.id);
        expect(
          await enterSystemScope('test: an order whose commit is in flight', () =>
            autoCreate().onOrderCreated(handled.id),
          ),
        ).toBe('deferred');
        await autoCreate().idle();
        expect(await opportunitiesOf(handled.id)).toHaveLength(1);
        vi.restoreAllMocks();

        // Announced while the module was on its way off: the look that was
        // deferred finds the module gone and does nothing.
        const ignored = await seedCrmOrder(h.em());
        notReadableAtFirst(ignored.id);
        await withModuleOff('crm', 'deactivated', async () => {
          expect(
            await enterSystemScope('test: an order placed while crm is off', () =>
              autoCreate().onOrderCreated(ignored.id),
            ),
          ).toBe('deferred');
          await autoCreate().idle();
        });
        expect(await opportunitiesOf(ignored.id)).toEqual([]);
      } finally {
        await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
      }
    });
  });

  // --- N-S8: read-only findings ------------------------------------------------------
  describe('findings of the second review made without a failing request', () => {
    it('a pass over every computed Opportunity goes on past one that fails, and then says so', async () => {
      expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
      const ids: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
        const order = await seedCrmOrder(h.em(), { status: 'paid', total: '20.00' });
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
        ids.push(opportunity.id);
      }
      await h.em().execute(`update "crm_opportunities" set "computed_value" = '1.00' where "id" in (?)`, [ids]);
      // The pass reads by id, ascending: the one that fails is met first.
      const [failing, ...others] = [...ids].sort();
      const service = h.container.resolve('crmOpportunityValueService') as {
        recalculate(id: string): Promise<boolean>;
        recalculateAll(): Promise<number>;
      };
      const recalculate = service.recalculate.bind(service);
      vi.spyOn(service, 'recalculate').mockImplementation(async (id) => {
        if (id === failing) throw new Error('this one cannot be read');
        return recalculate(id);
      });

      await expect(
        enterSystemScope('test: a pass meets a failure', () => service.recalculateAll()),
      ).rejects.toThrow(/1 .*could not be recalculated/);

      for (const id of others) expect(await storedComputedValue(id)).toBe('20.00');
      expect(await storedComputedValue(failing as string)).toBe('1.00');
    });

    it('a counting configuration is saved and answered 202 when the queue cannot be reached', async () => {
      const producer = h.container.resolve('crmValueRecalculationProducer') as { enqueue(): Promise<boolean> };
      const enqueue = vi.spyOn(producer, 'enqueue').mockRejectedValue(new Error('redis is away'));

      const saved = await setCrmCountingStatuses(h, { order: ['completed'], quoteRequest: [] });

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(saved.statusCode, saved.body).toBe(202);
      const stored = (await h
        .em()
        .execute(`select "status_code" from "crm_value_counting_statuses" where "document_kind" = 'order'`)) as Array<{
        status_code: string;
      }>;
      expect(stored.map((row) => row.status_code)).toEqual(['completed']);
    });

    it('a placed Order whose commit is awaited is left alone once crm is switched off meanwhile', async () => {
      await restoreDefaultCrmWorkflow(h.em());
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
      const autoCreate = h.container.resolve('crmOpportunityAutoCreateService') as {
        onOrderCreated(orderId: string): Promise<string>;
        idle(): Promise<void>;
      };
      try {
        const order = await seedCrmOrder(h.em());
        // Not readable until the module has been switched off: the look that
        // was deferred while it was on is still waiting between two reads.
        const port = h.container.resolve('orderReadPort') as OrderReadPort;
        const original = port.findById.bind(port);
        let committed = false;
        vi.spyOn(port, 'findById').mockImplementation(async (id) =>
          id === order.id && !committed ? null : original(id),
        );
        expect(
          await enterSystemScope('test: an order placed just before crm goes off', () =>
            autoCreate.onOrderCreated(order.id),
          ),
        ).toBe('deferred');

        await withModuleOff('crm', 'deactivated', async () => {
          committed = true;
          await autoCreate.idle();
        });

        const linked = (await h
          .em()
          .execute(`select 1 from "crm_opportunity_links" where "document_id" = ?`, [order.id])) as unknown[];
        expect(linked).toEqual([]);
      } finally {
        await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
      }
    });
  });
});
