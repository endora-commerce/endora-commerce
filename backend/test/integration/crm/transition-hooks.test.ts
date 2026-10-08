import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CRM_EVENTS,
  OpportunityTransitionVetoError,
  opportunityStatusEventName,
  type OpportunityStatusEvent,
  type OpportunityTransitionGuardRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
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
 * Registering business logic on a transition X → Y
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §1.1, §3).
 *
 * Two seams: a guard may refuse, an event may only observe. The cases below
 * hold each to its half — a guard fires for exactly the transitions it
 * matches and a refusal writes nothing; a switched-off contributor does not
 * veto; the `.before` events see the old status, the after-events see the new
 * one *and* the Orders that followed; and a subscriber that throws undoes
 * nothing.
 *
 * A guard cannot be withdrawn from the registry, so every guard here refuses
 * only Opportunities carrying its own marker.
 */
describe('crm transition hooks', () => {
  let h: BackendServerHandle;
  let registry: OpportunityTransitionGuardRegistryPort;

  const statusOf = async (id: string) =>
    (await h.em().findOneOrFail(CrmOpportunity, { id }, { filters: false })).statusCode;

  const writesFor = async (id: string) => ({
    history: await h.em().count(CrmOpportunityStatusHistory, { opportunityId: id }, { filters: false }),
    propagations: await h.em().count(CrmStatusPropagation, { opportunityId: id }, { filters: false }),
    audit: (await h.auditLogService.query({ action: 'crm.opportunity.transition', objectId: id })).length,
  });

  /** Walk an Opportunity along `path`, asserting each step applied. */
  async function walk(id: string, path: string[]) {
    for (const to of path) {
      const response = await transitionCrmOpportunity(h, id, to);
      expect(response.statusCode, `→ ${to}: ${response.body}`).toBe(200);
    }
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    registry = h.container.resolve<OpportunityTransitionGuardRegistryPort>(
      'opportunityTransitionGuardRegistry',
    );
    expect((await setCrmForwardMappings(h, { qualified: 'paid' })).statusCode).toBe(200);
  });

  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('guards', () => {
    /** Register a guard that refuses the Opportunities in `subjects` and counts what it was asked. */
    function guardFor(match: { from?: string; to?: string }, subjects: Set<string>, sentence: string) {
      const asked: Array<[string, string]> = [];
      registry.register({
        ownerModuleId: 'crm',
        match,
        guard: (event) => {
          if (!subjects.has(event.opportunityId)) return;
          asked.push([event.from, event.to]);
          throw new OpportunityTransitionVetoError(sentence, event.from, event.to);
        },
      });
      return asked;
    }

    it('a guard on { from, to } vetoes exactly that transition, and nothing is written', async () => {
      const subjects = new Set<string>();
      const asked = guardFor({ from: 'qualified', to: 'proposal' }, subjects, 'No proposal without a budget.');
      const opportunity = await createCrmOpportunity(h);
      subjects.add(opportunity.id);

      await walk(opportunity.id, ['qualified']);
      const before = await writesFor(opportunity.id);

      const refused = await transitionCrmOpportunity(h, opportunity.id, 'proposal');
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error).toMatchObject({
        code: 'CRM_TRANSITION_VETOED',
        message: 'No proposal without a budget.',
      });
      expect(await statusOf(opportunity.id)).toBe('qualified');
      expect(await writesFor(opportunity.id)).toEqual(before);

      // The same source, another target: not this guard's transition.
      await walk(opportunity.id, ['lost']);
      expect(asked).toEqual([['qualified', 'proposal']]);
    });

    it('a guard on { from } only vetoes every transition out of that status and no other', async () => {
      const subjects = new Set<string>();
      const asked = guardFor({ from: 'proposal' }, subjects, 'Proposals are frozen this week.');
      const opportunity = await createCrmOpportunity(h);
      subjects.add(opportunity.id);

      await walk(opportunity.id, ['qualified', 'proposal']);
      const before = await writesFor(opportunity.id);
      for (const to of ['negotiation', 'won', 'lost']) {
        const refused = await transitionCrmOpportunity(h, opportunity.id, to);
        expect(refused.statusCode, `${to} ${refused.body}`).toBe(409);
        expect(refused.json().error.code).toBe('CRM_TRANSITION_VETOED');
      }
      expect(await statusOf(opportunity.id)).toBe('proposal');
      expect(await writesFor(opportunity.id)).toEqual(before);
      expect(asked).toEqual([
        ['proposal', 'negotiation'],
        ['proposal', 'won'],
        ['proposal', 'lost'],
      ]);
    });

    it('a guard on { to } only vetoes every transition into that status and no other', async () => {
      const subjects = new Set<string>();
      const asked = guardFor({ to: 'lost' }, subjects, 'Escalate before giving up.');
      const first = await createCrmOpportunity(h);
      const second = await createCrmOpportunity(h);
      subjects.add(first.id).add(second.id);

      // Into `lost` from two different statuses: both refused.
      expect((await transitionCrmOpportunity(h, first.id, 'lost')).statusCode).toBe(409);
      await walk(second.id, ['qualified']);
      const refused = await transitionCrmOpportunity(h, second.id, 'lost');
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.message).toBe('Escalate before giving up.');
      expect(await statusOf(first.id)).toBe('new');
      expect(await statusOf(second.id)).toBe('qualified');
      expect(asked).toEqual([
        ['new', 'lost'],
        ['qualified', 'lost'],
      ]);
    });

    it('a refused transition propagates to no Order and emits no after-event', async () => {
      const subjects = new Set<string>();
      guardFor({ from: 'new', to: 'qualified' }, subjects, 'Not yet.');
      const opportunity = await createCrmOpportunity(h);
      subjects.add(opportunity.id);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

      const seen: string[] = [];
      const offs = [
        CRM_EVENTS.STATUS_CHANGED,
        opportunityStatusEventName('fromToBefore', { from: 'new', to: 'qualified' }),
        opportunityStatusEventName('fromBefore', { from: 'new' }),
        opportunityStatusEventName('fromToAfter', { from: 'new', to: 'qualified' }),
        opportunityStatusEventName('toAfter', { to: 'qualified' }),
      ].map((name) =>
        h.eventBus.on(name, (payload: unknown) => {
          if ((payload as OpportunityStatusEvent).opportunityId === opportunity.id) seen.push(name);
        }),
      );
      try {
        expect((await transitionCrmOpportunity(h, opportunity.id, 'qualified')).statusCode).toBe(409);
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        offs.forEach((off) => off());
      }
      // The guards run before the passive `.before` events: a refused
      // transition announces nothing at all.
      expect(seen).toEqual([]);
      expect((await h.em().findOneOrFail(Order, { id: order.id }, { filters: false })).status).toBe('new');
      expect(await h.em().count(CrmStatusPropagation, { opportunityId: opportunity.id }, { filters: false })).toBe(0);
    });

    it('skips a guard whose owner module is switched off, and honours it again once the module is back', async () => {
      const subjects = new Set<string>();
      let asked = 0;
      registry.register({
        // `blog` is an operator-toggleable module: the contributor here.
        ownerModuleId: 'blog',
        match: { from: 'new', to: 'qualified' },
        guard: (event) => {
          if (!subjects.has(event.opportunityId)) return;
          asked += 1;
          throw new OpportunityTransitionVetoError('The blog says no.', event.from, event.to);
        },
      });
      expect(registry.owners()).toContain('blog');

      // Positive control: while its owner is present the guard refuses.
      const held = await createCrmOpportunity(h);
      subjects.add(held.id);
      expect((await transitionCrmOpportunity(h, held.id, 'qualified')).statusCode).toBe(409);
      expect(asked).toBe(1);

      await withModuleOff('blog', 'deactivated', async () => {
        const response = await transitionCrmOpportunity(h, held.id, 'qualified');
        expect(response.statusCode, response.body).toBe(200);
      });
      expect(asked).toBe(1);
      expect(await statusOf(held.id)).toBe('qualified');

      const next = await createCrmOpportunity(h);
      subjects.add(next.id);
      expect((await transitionCrmOpportunity(h, next.id, 'qualified')).statusCode).toBe(409);
      expect(asked).toBe(2);
    });

    it('answers 500, and writes nothing, when a guard throws something that is not a veto', async () => {
      const subjects = new Set<string>();
      registry.register({
        ownerModuleId: 'crm',
        match: { from: 'new', to: 'lost' },
        guard: (event) => {
          if (subjects.has(event.opportunityId)) throw new Error('guard defect');
        },
      });
      const opportunity = await createCrmOpportunity(h);
      subjects.add(opportunity.id);
      const response = await transitionCrmOpportunity(h, opportunity.id, 'lost');
      expect(response.statusCode, response.body).toBe(500);
      expect(await statusOf(opportunity.id)).toBe('new');
    });
  });

  describe('events', () => {
    it('emits the two before-events ahead of the write and the after-events once, after commit and after propagation', async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

      const names = {
        fromToBefore: opportunityStatusEventName('fromToBefore', { from: 'new', to: 'qualified' }),
        fromBefore: opportunityStatusEventName('fromBefore', { from: 'new' }),
        changed: CRM_EVENTS.STATUS_CHANGED,
        fromToAfter: opportunityStatusEventName('fromToAfter', { from: 'new', to: 'qualified' }),
        toAfter: opportunityStatusEventName('toAfter', { to: 'qualified' }),
      };
      const seen: Array<{ name: string; payload: OpportunityStatusEvent }> = [];
      /**
       * What the database held at the moment each handler ran. One statement,
       * issued synchronously from the handler: its snapshot is taken when the
       * handler is called, not some round-trips later.
       */
      const observed: Array<Promise<{ opportunity: string; order: string; history: number }>> = [];
      const snapshot = async () => {
        const [row] = (await h.orm.em.getConnection().execute(
          `select (select "status_code" from "crm_opportunities" where "id" = ?) as opportunity,
                  (select "status" from "orders" where "id" = ?) as "order",
                  (select count(*)::int from "crm_opportunity_status_history" where "opportunity_id" = ?) as history`,
          [opportunity.id, order.id, opportunity.id],
        )) as Array<{ opportunity: string; order: string; history: number }>;
        return row!;
      };
      const offs = Object.values(names).map((name) =>
        h.eventBus.on(name, (payload: unknown) => {
          const event = payload as OpportunityStatusEvent;
          if (event.opportunityId !== opportunity.id) return;
          seen.push({ name, payload: event });
          observed.push(snapshot());
        }),
      );
      try {
        const response = await transitionCrmOpportunity(h, opportunity.id, 'qualified', undefined, 'Budget confirmed');
        expect(response.statusCode, response.body).toBe(200);
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        offs.forEach((off) => off());
      }

      expect(seen.map((entry) => entry.name)).toEqual([
        names.fromToBefore,
        names.fromBefore,
        names.changed,
        names.fromToAfter,
        names.toAfter,
      ]);
      for (const { payload } of seen) {
        expect(payload).toMatchObject({
          opportunityId: opportunity.id,
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: null,
          from: 'new',
          to: 'qualified',
          fromKind: 'open',
          toKind: 'open',
          actor: { kind: 'admin', adminUserId: TEST_ADMIN_ID },
          cause: 'manual',
          reason: 'Budget confirmed',
        });
        expect(payload.eventId).toEqual(expect.any(String));
      }
      expect(seen[2]?.payload).toMatchObject({ number: opportunity.number });

      const reads = await Promise.all(observed);
      // Before the write: the old status, the creation row only, the Order untouched.
      for (const read of reads.slice(0, 2)) {
        expect(read).toEqual({ opportunity: 'new', order: 'new', history: 1 });
      }
      // After the commit *and* after propagation: the new status, and the Order already moved.
      expect(reads).toHaveLength(5);
      for (const read of reads.slice(2)) {
        expect(read).toEqual({ opportunity: 'qualified', order: 'paid', history: 2 });
      }
    });

    it('announces a closing with crm.opportunity.closed.v1, once', async () => {
      const opportunity = await createCrmOpportunity(h, { manualValue: '750.00' });
      const closed: unknown[] = [];
      const off = h.eventBus.on(CRM_EVENTS.CLOSED, (payload: unknown) => {
        if ((payload as { opportunityId: string }).opportunityId === opportunity.id) closed.push(payload);
      });
      try {
        await walk(opportunity.id, ['qualified']);
        expect(closed).toEqual([]);
        await walk(opportunity.id, ['lost']);
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        off();
      }
      expect(closed).toEqual([
        expect.objectContaining({
          opportunityId: opportunity.id,
          organizationId: TEST_ORGANIZATION_ID,
          outcome: 'lost',
          value: '750.00',
          currency: 'PLN',
        }),
      ]);
    });

    it('a subscriber that throws — before or after — does not undo the transition', async () => {
      const opportunity = await createCrmOpportunity(h);
      const offs = [
        opportunityStatusEventName('fromBefore', { from: 'new' }),
        opportunityStatusEventName('toAfter', { to: 'qualified' }),
        CRM_EVENTS.STATUS_CHANGED,
      ].map((name) =>
        h.eventBus.on(name, (payload: unknown) => {
          if ((payload as OpportunityStatusEvent).opportunityId === opportunity.id) {
            throw new Error(`subscriber failure on ${name}`);
          }
        }),
      );
      try {
        const response = await transitionCrmOpportunity(h, opportunity.id, 'qualified');
        expect(response.statusCode, response.body).toBe(200);
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        offs.forEach((off) => off());
      }
      expect(await statusOf(opportunity.id)).toBe('qualified');
      expect(await writesFor(opportunity.id)).toMatchObject({ history: 2, audit: 1 });
    });
  });
});
