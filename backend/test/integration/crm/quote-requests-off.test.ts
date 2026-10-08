import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS,
  OpportunityBoardCardConfigResponseSchema,
  OpportunityBoardResponseSchema,
  OpportunityDetailResponseSchema,
  OpportunityListResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  linkCrmOrder,
  linkCrmQuoteRequest,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmCountingStatuses,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

/**
 * `crm` with `quote_requests` switched off — the `degrades-without` edge of
 * the manifest, measured (`specs/143-crm-sales-opportunities/research.md` R-17,
 * the owner's decision of 2026-10-05).
 *
 * The quote desk is the operator's to switch off, and CRM must not hold its
 * switch: Opportunities and their Orders keep working, a linked Quote Request
 * shows as unavailable and adds nothing to a computed value, and linking one is
 * refused with the answer the quote desk's own routes give. Every case below
 * has its positive control beside it — the same call while the module is on.
 */
describe('crm with quote_requests off (degrades-without)', () => {
  let h: BackendServerHandle;

  const detail = async (id: string) => {
    const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}`, cookies: CRM_ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  /** A computed Opportunity with one counting Quote Request (84.00) linked. */
  const withLinkedQuoteRequest = async () => {
    const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
    const rfq = await submitCrmQuoteRequest(h, { quantity: 7, desiredUnitPrice: 12 });
    expect((await linkCrmQuoteRequest(h, opportunity.id, rfq.id)).statusCode).toBe(201);
    return { opportunityId: opportunity.id, quoteRequestId: rfq.id };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    const configured = await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: ['Pending'] });
    expect(configured.statusCode, configured.body).toBe(202);
  });

  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('the quote desk can be switched off while crm is on — the edge binds no operator', async () => {
    // A `dependencies` entry would make this flip a refusal naming `crm`.
    await withModuleOff('quote_requests', 'deactivated', async () => {
      const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/workflow`, cookies: CRM_ADMIN });
      expect(response.statusCode, response.body).toBe(200);
    });
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'Opportunities list and open while quote_requests is %s; a linked Quote Request shows as unavailable',
    async (axis) => {
      const { opportunityId, quoteRequestId } = await withLinkedQuoteRequest();
      // The positive control: while on, the link renders the document.
      const on = await detail(opportunityId);
      expect(on.links[0]).toMatchObject({ documentId: quoteRequestId, available: true, status: 'Pending', total: '84.00' });

      await withModuleOff('quote_requests', axis, async () => {
        const list = await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities`, cookies: CRM_ADMIN });
        expect(list.statusCode, list.body).toBe(200);
        expect(
          OpportunityListResponseSchema.parse(list.json()).data.some((row) => row.id === opportunityId),
        ).toBe(true);

        const off = await detail(opportunityId);
        expect(off.links).toHaveLength(1);
        expect(off.links[0]).toMatchObject({
          documentKind: 'quote_request',
          documentId: quoteRequestId,
          available: false,
        });
        // Nothing of the document leaks through while its owner is off.
        expect(off.links[0]).not.toHaveProperty('number');
        expect(off.links[0]).not.toHaveProperty('status');
        expect(off.links[0]).not.toHaveProperty('total');
      });

      // Reactivation restores it.
      const again = await detail(opportunityId);
      expect(again.links[0]).toMatchObject({ available: true, status: 'Pending', total: '84.00' });
    },
  );

  it('a linked Quote Request adds nothing to a computed value while its owner is off, and counts again after', async () => {
    const { opportunityId } = await withLinkedQuoteRequest();
    expect((await detail(opportunityId)).value).toBe('84.00');

    const order = await seedCrmOrder(h.em(), { status: 'paid' });
    let orderLinkId = '';
    await withModuleOff('quote_requests', 'deactivated', async () => {
      // Linking an Order still works, and recalculates: the Order counts, the
      // Quote Request — unreadable — does not.
      const linked = await linkCrmOrder(h, opportunityId, order.id);
      expect(linked.statusCode, linked.body).toBe(201);
      orderLinkId = (linked.json() as { data: { id: string } }).data.id;
      const off = await detail(opportunityId);
      expect(off.value).toBe('123.00');
      expect(off.excludedDocuments).toEqual([]);
    });

    // Back on: the next change recalculates with the Quote Request readable again.
    const unlinked = await h.app.inject({
      method: 'DELETE',
      url: `${CRM_API}/opportunities/${opportunityId}/links/${orderLinkId}`,
      cookies: CRM_ADMIN,
    });
    expect(unlinked.statusCode, unlinked.body).toBe(204);
    expect((await detail(opportunityId)).value).toBe('84.00');
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'linking a Quote Request answers 503 MODULE_DISABLED while quote_requests is %s, and 201 after',
    async (axis) => {
      const opportunity = await createCrmOpportunity(h);
      const rfq = await submitCrmQuoteRequest(h);

      await withModuleOff('quote_requests', axis, async () => {
        const refused = await linkCrmQuoteRequest(h, opportunity.id, rfq.id);
        expect(refused.statusCode, refused.body).toBe(503);
        expect(refused.json().error.code).toBe('MODULE_DISABLED');
        expect(refused.json().error.details).toMatchObject({ module: 'quote_requests' });
        expect((await detail(opportunity.id)).links).toEqual([]);
        // An Order is linked as ever.
        const order = await seedCrmOrder(h.em());
        expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      });

      const linked = await linkCrmQuoteRequest(h, opportunity.id, rfq.id);
      expect(linked.statusCode, linked.body).toBe(201);
    },
  );

  it('a linked Quote Request can still be unlinked while its owner is off', async () => {
    const { opportunityId } = await withLinkedQuoteRequest();
    await withModuleOff('quote_requests', 'deactivated', async () => {
      const [link] = (await detail(opportunityId)).links;
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `${CRM_API}/opportunities/${opportunityId}/links/${link?.id}`,
        cookies: CRM_ADMIN,
      });
      expect(removed.statusCode, removed.body).toBe(204);
      expect((await detail(opportunityId)).links).toEqual([]);
    });
  });

  it('saving the counting configuration and running its job work while quote_requests is off', async () => {
    await withModuleOff('quote_requests', 'deactivated', async () => {
      const saved = await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: ['Pending'] });
      expect(saved.statusCode, saved.body).toBe(202);
    });
  });

  // User Story 19, review task T240: the count of linked Quote Requests is a
  // board-card field only while the quote desk is present.
  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'the linked-Quote-Requests field is neither offered, shown nor filtered by while quote_requests is %s, and a stored choice of it breaks nothing',
    async (axis) => {
      const REF = 'builtin:linkedQuoteRequests';
      const MARK = `bfqroff${axis.replace(/[^a-z]/g, '')}`;
      const config = async () => {
        const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/board/card-fields`, cookies: CRM_ADMIN });
        expect(response.statusCode, response.body).toBe(200);
        return OpportunityBoardCardConfigResponseSchema.parse(response.json()).data;
      };
      const write = (fields: readonly string[]) =>
        h.app.inject({ method: 'PUT', url: `${CRM_API}/board/card-fields`, cookies: CRM_ADMIN, payload: { fields } });
      const board = async (min?: string) => {
        const filter = min === undefined ? '' : `&fieldFilters=${encodeURIComponent(JSON.stringify({ [REF]: { min } }))}`;
        const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/board?q=${MARK}${filter}`, cookies: CRM_ADMIN });
        expect(response.statusCode, response.body).toBe(200);
        return OpportunityBoardResponseSchema.parse(response.json()).data;
      };
      const cards = (data: Awaited<ReturnType<typeof board>>) => data.columns.flatMap((column) => column.items);

      const linked = await createCrmOpportunity(h, { title: `${MARK} linked` });
      await createCrmOpportunity(h, { title: `${MARK} bare` });
      const rfq = await submitCrmQuoteRequest(h, { quantity: 1, desiredUnitPrice: 1 });
      expect((await linkCrmQuoteRequest(h, linked.id, rfq.id)).statusCode).toBe(201);
      try {
        // The control: present, the field is offered, stored, shown and filtered by.
        expect((await write([REF, 'builtin:value'])).statusCode).toBe(200);
        expect((await config()).available.map((field) => field.ref)).toContain(REF);
        const on = await board('1');
        expect(on.cardFields.map((field) => field.ref)).toEqual([REF, 'builtin:value']);
        expect(cards(on).map((card) => [card.title, card.cardValues?.[REF]])).toEqual([[`${MARK} linked`, 1]]);

        await withModuleOff('quote_requests', axis, async () => {
          const off = await config();
          expect(off.available.map((field) => field.ref)).not.toContain(REF);
          expect(off.fields.map((field) => field.ref)).toEqual(['builtin:value']);
          // The address a user saved while it was on: the filter is ignored, not refused.
          const data = await board('1');
          expect(data.cardFields.map((field) => field.ref)).toEqual(['builtin:value']);
          expect(cards(data)).toHaveLength(2);
          expect(data.columns.reduce((sum, column) => sum + column.count, 0)).toBe(2);
          for (const card of cards(data)) expect(card.cardValues).toEqual({});
          const list = await h.app.inject({
            method: 'GET',
            url: `${CRM_API}/opportunities?q=${MARK}&cardValues=true&fieldFilters=${encodeURIComponent(JSON.stringify({ [REF]: { min: '1' } }))}`,
            cookies: CRM_ADMIN,
          });
          expect(list.statusCode, list.body).toBe(200);
          expect(OpportunityListResponseSchema.parse(list.json()).data).toHaveLength(2);
          // And it cannot be chosen.
          expect((await write([REF])).statusCode).toBe(422);
        });

        // Off is not uninstall: the stored choice was never rewritten.
        expect((await config()).fields.map((field) => field.ref)).toEqual([REF, 'builtin:value']);
      } finally {
        expect((await write(OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS)).statusCode).toBe(200);
      }
    },
  );
});
