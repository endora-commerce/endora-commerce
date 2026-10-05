import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  OpportunityTransitionResponseSchema,
  OpportunityTransitionVetoError,
  OpportunityWorkflowResponseSchema,
  opportunityStatusEventName,
  type OpportunityTransitionGuardRegistryPort,
  type OrderReadPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmForwardMappings,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';

/**
 * The MVP walk — the owner's success criterion for User Story 1
 * (`specs/143-crm-sales-opportunities/quickstart.md` § *The MVP walk*).
 *
 * An Opportunity is created by hand; an existing Order is linked to it; the
 * Opportunity is walked through its whole workflow, from the start status to a
 * closing-won status; and every mapped step is reflected in the Order's own
 * status — against the real `orders` module, over HTTP, with the Order read
 * back through `orderReadPort` after each step and never assumed from the
 * response.
 *
 * One `it` on purpose: the ten steps are one scenario, and a step is only
 * meaningful on top of the ones before it.
 */
describe('crm — the MVP walk (User Story 1)', () => {
  let h: BackendServerHandle;
  let orders: OrderReadPort;

  const call = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies: CRM_ADMIN,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  /** The Order's status, from the port `orders` publishes — the read a consumer would make. */
  const orderStatus = async (orderId: string): Promise<string | undefined> =>
    (await orders.findById(orderId))?.status;

  const opportunityDetail = async (id: string) =>
    OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${id}`)).json()).data;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    orders = h.container.resolve<OrderReadPort>('orderReadPort');
  });

  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('walks a hand-made Opportunity from its start status to won, the linked Order following every mapped step', async () => {
    // --- 1. The seeded workflow; one status added, with a way in and a way out.
    const seeded = OpportunityWorkflowResponseSchema.parse((await call('GET', '/workflow')).json()).data;
    expect(seeded.statuses.map((status) => status.code)).toEqual([
      'new',
      'qualified',
      'proposal',
      'negotiation',
      'won',
      'lost',
    ]);
    expect(seeded.statuses.filter((status) => status.isInitial).map((status) => status.code)).toEqual(['new']);

    const added = await call('POST', '/statuses', {
      code: 'in_delivery',
      defaultName: 'In delivery',
      name: { en: 'In delivery', pl: 'W dostawie' },
      kind: 'open',
      weight: 50,
    });
    expect(added.statusCode, added.body).toBe(201);
    const edges = await call('PUT', '/transitions', {
      add: [
        { fromStatusCode: 'negotiation', toStatusCode: 'in_delivery' },
        { fromStatusCode: 'in_delivery', toStatusCode: 'won' },
      ],
    });
    expect(edges.statusCode, edges.body).toBe(200);

    // --- 2. Forward mappings onto real Order statuses. The Order workflow the
    // platform seeds runs new → paid → processing → shipment_ready →
    // shipment_sent → completed, so every Opportunity step below asks its
    // Order for the next status on that path.
    const WALK: ReadonlyArray<{ to: string; orderStatus: string }> = [
      { to: 'qualified', orderStatus: 'paid' },
      { to: 'proposal', orderStatus: 'processing' },
      { to: 'negotiation', orderStatus: 'shipment_ready' },
      { to: 'in_delivery', orderStatus: 'shipment_sent' },
      { to: 'won', orderStatus: 'completed' },
    ];
    const mapped = await setCrmForwardMappings(
      h,
      Object.fromEntries(WALK.map((step) => [step.to, step.orderStatus])),
    );
    expect(mapped.statusCode, mapped.body).toBe(200);
    expect(OpportunityWorkflowResponseSchema.parse(mapped.json()).data.orderStatusMappings).toHaveLength(WALK.length);

    // --- 3. An Opportunity, created by hand.
    const created = await call('POST', '/opportunities', {
      title: 'Fleet renewal 2027',
      organizationId: TEST_ORGANIZATION_ID,
      currency: 'PLN',
      manualValue: '48000.00',
    });
    expect(created.statusCode, created.body).toBe(201);
    const opportunity = OpportunityDetailResponseSchema.parse(created.json()).data;
    expect(opportunity.status).toMatchObject({ code: 'new', kind: 'open' });
    expect(opportunity.number).toMatch(/^OPP-\d{6,}$/);
    expect(opportunity.source).toBe('manual');

    // --- 4. An Order that already exists, linked to it.
    const order = await seedCrmOrder(h.em());
    expect(await orderStatus(order.id)).toBe('new');
    const linked = await linkCrmOrder(h, opportunity.id, order.id);
    expect(linked.statusCode, linked.body).toBe(201);
    expect((await opportunityDetail(opportunity.id)).links).toEqual([
      expect.objectContaining({ documentKind: 'order', documentId: order.id, status: 'new', syncStatus: true }),
    ]);

    // --- 8 (before the walk, while there is an edge to lack). A transition the
    // workflow has no edge for is refused and changes neither record.
    const skipped = await transitionCrmOpportunity(h, opportunity.id, 'won');
    expect(skipped.statusCode, skipped.body).toBe(409);
    expect(skipped.json().error.code).toBe('CRM_INVALID_TRANSITION');
    expect((await opportunityDetail(opportunity.id)).status.code).toBe('new');
    expect(await orderStatus(order.id)).toBe('new');

    // --- 10a. Business logic on X → Y: a guard that refuses one transition…
    const registry = h.container.resolve<OpportunityTransitionGuardRegistryPort>(
      'opportunityTransitionGuardRegistry',
    );
    let vetoArmed = true;
    registry.register({
      ownerModuleId: 'crm',
      match: { from: 'negotiation', to: 'in_delivery' },
      guard: (event) => {
        if (vetoArmed && event.opportunityId === opportunity.id) {
          throw new OpportunityTransitionVetoError(
            'A signed delivery schedule is required before delivery starts.',
            event.from,
            event.to,
          );
        }
      },
    });
    // --- 10b. …and a subscriber on a templated after-event.
    const wonEvents: Array<Record<string, unknown>> = [];
    const off = h.eventBus.on(
      opportunityStatusEventName('toAfter', { to: 'won' }),
      (payload: unknown) => {
        const event = payload as Record<string, unknown>;
        if (event['opportunityId'] === opportunity.id) wonEvents.push(event);
      },
    );

    try {
      // --- 5 and 6. Every edge up to `won`; after each, the Order row.
      let previous = 'new';
      for (const step of WALK) {
        if (step.to === 'in_delivery') {
          const vetoed = await transitionCrmOpportunity(h, opportunity.id, step.to);
          expect(vetoed.statusCode, vetoed.body).toBe(409);
          expect(vetoed.json().error).toMatchObject({
            code: 'CRM_TRANSITION_VETOED',
            message: 'A signed delivery schedule is required before delivery starts.',
          });
          // Refused before anything was written: neither record moved.
          expect((await opportunityDetail(opportunity.id)).status.code).toBe(previous);
          expect(await orderStatus(order.id)).toBe('shipment_ready');
          vetoArmed = false;
        }

        const response = await transitionCrmOpportunity(h, opportunity.id, step.to);
        expect(response.statusCode, `${previous} → ${step.to}: ${response.body}`).toBe(200);
        const { data } = OpportunityTransitionResponseSchema.parse(response.json());
        expect(data.from).toBe(previous);
        expect(data.to).toBe(step.to);
        expect(data.opportunity.status.code).toBe(step.to);
        expect(data.propagation, `${previous} → ${step.to}`).toHaveLength(1);
        expect(data.propagation[0]).toMatchObject({
          orderId: order.id,
          direction: 'opportunity_to_order',
          orderStatusCode: step.orderStatus,
          outcome: 'applied',
        });
        // The Order itself, read back through the orders read port.
        expect(await orderStatus(order.id), `Order after ${previous} → ${step.to}`).toBe(step.orderStatus);
        previous = step.to;
      }
    } finally {
      off();
    }

    // --- 7. Closed as won.
    const closed = await opportunityDetail(opportunity.id);
    expect(closed.status).toMatchObject({ code: 'won', kind: 'won' });
    expect(closed.closedKind).toBe('won');
    expect(closed.closedAt).toEqual(expect.any(String));
    expect(closed.unresolvedPropagations).toEqual([]);
    expect(closed.links[0]).toMatchObject({ documentId: order.id, status: 'completed' });
    expect(await orderStatus(order.id)).toBe('completed');

    // --- 10b, concluded: the subscriber saw the applied transition exactly once.
    await new Promise((resolve) => setImmediate(resolve));
    expect(wonEvents).toHaveLength(1);
    expect(wonEvents[0]).toMatchObject({
      opportunityId: opportunity.id,
      organizationId: TEST_ORGANIZATION_ID,
      from: 'in_delivery',
      to: 'won',
      fromKind: 'open',
      toKind: 'won',
      cause: 'manual',
    });

    // --- 9. A mapped Order status the Order workflow does not permit is not an
    // HTTP error: the Opportunity moves, and the refusal is an outcome.
    const second = OpportunityDetailResponseSchema.parse(
      (
        await call('POST', '/opportunities', {
          title: `Refused follow ${randomUUID().slice(0, 8)}`,
          organizationId: TEST_ORGANIZATION_ID,
          currency: 'PLN',
        })
      ).json(),
    ).data;
    const fresh = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, second.id, fresh.id)).statusCode).toBe(201);
    expect((await transitionCrmOpportunity(h, second.id, 'qualified')).statusCode).toBe(200);
    expect(await orderStatus(fresh.id)).toBe('paid');
    expect((await transitionCrmOpportunity(h, second.id, 'proposal')).statusCode).toBe(200);
    expect(await orderStatus(fresh.id)).toBe('processing');
    // `proposal → won` is a seeded edge; `won` asks the Order for `completed`,
    // and the Order workflow has no edge from `processing` to `completed`.
    const refused = await transitionCrmOpportunity(h, second.id, 'won');
    expect(refused.statusCode, refused.body).toBe(200);
    const refusedBody = OpportunityTransitionResponseSchema.parse(refused.json()).data;
    expect(refusedBody.opportunity.status.code).toBe('won');
    expect(refusedBody.propagation).toHaveLength(1);
    expect(refusedBody.propagation[0]).toMatchObject({
      orderId: fresh.id,
      orderStatusCode: 'completed',
      outcome: 'not_permitted',
    });
    expect(refusedBody.propagation[0]?.detail).toEqual(expect.stringContaining('processing'));
    expect((await opportunityDetail(second.id)).closedKind).toBe('won');
    expect(await orderStatus(fresh.id)).toBe('processing');
  });
});
