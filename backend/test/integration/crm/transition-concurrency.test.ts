import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityTransitionResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  createCrmOpportunity,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmForwardMappings,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import {
  CrmOpportunity,
  CrmOpportunityStatusHistory,
  CrmStatusPropagation,
  Order,
} from '../../helpers/package-entities.js';

/**
 * Two transitions of one Opportunity at once
 * (`specs/143-crm-sales-opportunities/research.md` R-3, step 4).
 *
 * The write takes the Opportunity's row lock and re-checks the status it read.
 * The loser of the race abandons its write and is evaluated again as a fresh
 * call would be: for the same target that is "already there", for a target the
 * workflow no longer reaches from the new status it is a refusal. Either way
 * the transition is recorded once and the Orders are asked once.
 */
describe('crm concurrent transitions', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    expect((await setCrmForwardMappings(h, { qualified: 'paid' })).statusCode).toBe(200);
  });

  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  const rowsFor = async (opportunityId: string) => ({
    history: await h
      .em()
      .find(CrmOpportunityStatusHistory, { opportunityId, cause: 'manual' }, { filters: false }),
    propagations: await h.em().find(CrmStatusPropagation, { opportunityId }, { filters: false }),
    audit: await h.auditLogService.query({ action: 'crm.opportunity.transition', objectId: opportunityId }),
  });

  it('two requests for the same target: one applies, the other finds the Opportunity already there', async () => {
    // Repeated, because a race that is lost one way round proves nothing about
    // the other; every round must come out the same.
    for (let round = 0; round < 5; round += 1) {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

      const responses = await Promise.all([
        transitionCrmOpportunity(h, opportunity.id, 'qualified'),
        transitionCrmOpportunity(h, opportunity.id, 'qualified'),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      const bodies = responses.map((response) => OpportunityTransitionResponseSchema.parse(response.json()).data);
      // Exactly one of them moved it; the other answers "already there".
      expect(bodies.map((body) => body.from).sort(), `round ${round}`).toEqual(['new', 'qualified']);
      const applied = bodies.find((body) => body.from === 'new')!;
      const repeat = bodies.find((body) => body.from === 'qualified')!;
      expect(applied.propagation).toHaveLength(1);
      expect(applied.propagation[0]).toMatchObject({ orderId: order.id, outcome: 'applied' });
      expect(repeat).toMatchObject({ to: 'qualified', propagation: [] });

      const rows = await rowsFor(opportunity.id);
      expect(rows.history, `round ${round}`).toHaveLength(1);
      expect(rows.history[0]).toMatchObject({ fromStatusCode: 'new', toStatusCode: 'qualified' });
      expect(rows.propagations, `round ${round}`).toHaveLength(1);
      expect(rows.audit, `round ${round}`).toHaveLength(1);
      const stored = await h.em().findOneOrFail(CrmOpportunity, { id: opportunity.id }, { filters: false });
      expect(stored).toMatchObject({ statusCode: 'qualified', version: opportunity.version + 1 });
      expect((await h.em().findOneOrFail(Order, { id: order.id }, { filters: false })).status).toBe('paid');
    }
  });

  it('two requests for targets that exclude each other: one applies, the other is refused, one row is written', async () => {
    for (let round = 0; round < 5; round += 1) {
      const opportunity = await createCrmOpportunity(h);
      // From `negotiation` both `won` and `lost` are reachable, and neither
      // reaches the other: whichever lands second has no edge left.
      for (const to of ['qualified', 'proposal', 'negotiation']) {
        expect((await transitionCrmOpportunity(h, opportunity.id, to)).statusCode).toBe(200);
      }
      const before = (await rowsFor(opportunity.id)).history.length;

      const responses = await Promise.all([
        transitionCrmOpportunity(h, opportunity.id, 'won'),
        transitionCrmOpportunity(h, opportunity.id, 'lost'),
      ]);
      const statuses = responses.map((response) => response.statusCode).sort();
      expect(statuses, `round ${round}`).toEqual([200, 409]);
      const refused = responses.find((response) => response.statusCode === 409)!;
      // Re-evaluated once against the status the winner left: no such edge.
      expect(['CRM_INVALID_TRANSITION', 'CRM_TRANSITION_CONFLICT']).toContain(refused.json().error.code);

      const rows = await rowsFor(opportunity.id);
      expect(rows.history.length - before, `round ${round}`).toBe(1);
      const stored = await h.em().findOneOrFail(CrmOpportunity, { id: opportunity.id }, { filters: false });
      const winner = responses.find((response) => response.statusCode === 200)!;
      expect(stored.statusCode).toBe(OpportunityTransitionResponseSchema.parse(winner.json()).data.to);
      expect(stored.closedKind).toBe(stored.statusCode);
    }
  });
});
