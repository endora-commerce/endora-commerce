import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
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
  createCrmOpportunity,
  defineCrmCustomField,
  linkCrmOrder,
  removeCrmCustomFields,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmCountingStatuses,
} from '../../helpers/seed-crm.js';

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
});
