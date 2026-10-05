import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  type OpportunityTransitionGuardRegistryPort,
  OpportunityTransitionVetoError,
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
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmMappings,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import {
  CrmOpportunityStatusHistory,
  CrmStatusPropagation,
  Order,
} from '../../helpers/package-entities.js';

/**
 * The reverse direction: an Order's status moves its Opportunity
 * (`specs/143-crm-sales-opportunities/research.md` R-5, User Story 2).
 *
 * **Every Order below is changed through the Orders admin endpoint**, never by
 * emitting `order.status_changed.v1` by hand: the subject is what CRM does with
 * the event `orders` really emits, payload and timing included.
 *
 * The loop rule is one hop, enforced twice — a change CRM asked an Order for is
 * recognised as its own echo and moves nothing, and a move that came from an
 * Order pushes no Order.
 */
describe('crm reverse mapping — an Order moves its Opportunity', () => {
  let h: BackendServerHandle;

  const detail = async (id: string) =>
    OpportunityDetailResponseSchema.parse(
      (await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}`, cookies: CRM_ADMIN })).json(),
    ).data;

  const history = (opportunityId: string) =>
    h.em().find(CrmOpportunityStatusHistory, { opportunityId }, { filters: false, orderBy: { changedAt: 'asc' } });

  const propagationRows = (opportunityId: string) =>
    h.em().find(CrmStatusPropagation, { opportunityId }, { filters: false, orderBy: { createdAt: 'asc' } });

  const orderStatus = async (id: string) =>
    (await h.em().findOneOrFail(Order, { id }, { filters: false })).status;

  const walk = async (opportunityId: string, ...statuses: string[]) => {
    for (const to of statuses) {
      const response = await transitionCrmOpportunity(h, opportunityId, to);
      expect(response.statusCode, response.body).toBe(200);
    }
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    const mapped = await setCrmMappings(h, [
      // Forward: what an Opportunity's move asks of its Orders.
      { direction: 'opportunity_to_order', opportunityStatusCode: 'qualified', orderStatusCode: 'paid' },
      { direction: 'opportunity_to_order', opportunityStatusCode: 'proposal', orderStatusCode: 'processing' },
      // Reverse: what an Order's status asks of its Opportunity.
      { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
      // Deliberately inconsistent with the forward mapping `proposal → processing`:
      // without echo suppression a user's move to `proposal` would bounce on to
      // `negotiation`.
      { direction: 'order_to_opportunity', orderStatusCode: 'processing', opportunityStatusCode: 'negotiation' },
      {
        direction: 'order_to_opportunity',
        orderStatusCode: 'shipment_ready',
        opportunityStatusCode: 'won',
        requireAllOrders: true,
      },
      // `lost → new` is an edge of the seeded workflow: a mapping that could reopen.
      { direction: 'order_to_opportunity', orderStatusCode: 'shipment_sent', opportunityStatusCode: 'new' },
      { direction: 'order_to_opportunity', orderStatusCode: 'completed', opportunityStatusCode: 'won' },
    ]);
    expect(mapped.statusCode, mapped.body).toBe(200);
  });

  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('moves the Opportunity when its one linked Order reaches a mapped status, naming the Order as the cause', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

    await changeOrderStatusAsOperator(h, order.id, 'paid');

    expect((await detail(opportunity.id)).status.code).toBe('qualified');
    const rows = await history(opportunity.id);
    expect(rows.map((row) => [row.fromStatusCode ?? null, row.toStatusCode, row.cause])).toEqual([
      [null, 'new', 'created'],
      ['new', 'qualified', 'order_status'],
    ]);
    expect(rows[1]).toMatchObject({ causeOrderId: order.id });
    // The system moved it, on the Order's behalf — not the operator who changed the Order.
    expect(rows[1]?.actorAdminUserId ?? null).toBeNull();
  });

  it('pushes no other Order when the move came from an Order', async () => {
    const opportunity = await createCrmOpportunity(h);
    const cause = await seedCrmOrder(h.em());
    const bystander = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, opportunity.id, cause.id)).statusCode).toBe(201);
    expect((await linkCrmOrder(h, opportunity.id, bystander.id)).statusCode).toBe(201);

    await changeOrderStatusAsOperator(h, cause.id, 'paid');

    expect((await detail(opportunity.id)).status.code).toBe('qualified');
    // `qualified` maps forward to `paid`, and the bystander follows the
    // Opportunity — a manual move would have asked it. This one did not.
    expect(await orderStatus(bystander.id)).toBe('new');
    expect(await propagationRows(opportunity.id)).toEqual([]);
  });

  it('recognises the change it asked an Order for as its own echo: one history row, nothing bounces', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em(), { status: 'paid' });
    await walk(opportunity.id, 'qualified');
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

    // Wait for the echo to be handled: a handler registered now runs after the
    // composed application's own.
    let off: () => void = () => undefined;
    const echoHandled = new Promise<void>((resolve) => {
      off = h.eventBus.on('order.status_changed.v1', (payload: unknown) => {
        if ((payload as { orderId?: string }).orderId === order.id) resolve();
      });
    });
    try {
      await walk(opportunity.id, 'proposal');
      await echoHandled;
    } finally {
      off();
    }

    expect(await orderStatus(order.id)).toBe('processing');
    // `processing` maps back to `negotiation`, and `proposal → negotiation` is
    // an edge. The Opportunity stays where the user put it.
    expect((await detail(opportunity.id)).status.code).toBe('proposal');
    const rows = await history(opportunity.id);
    expect(rows.map((row) => [row.toStatusCode, row.cause])).toEqual([
      ['new', 'created'],
      ['qualified', 'manual'],
      ['proposal', 'manual'],
    ]);
    const propagations = await propagationRows(opportunity.id);
    expect(propagations).toHaveLength(1);
    expect(propagations[0]).toMatchObject({
      direction: 'opportunity_to_order',
      orderStatusCode: 'processing',
      outcome: 'applied',
      echoed: true,
    });

    // The marker is spent: the same Order reaching the same status again by
    // somebody else's hand is not CRM's echo. (It cannot here — the Order is
    // already there — so the next genuine change is the one asserted.)
    await changeOrderStatusAsOperator(h, order.id, 'shipment_ready');
    // `shipment_ready → won` waits for every following Order, and this is the only one.
    expect((await detail(opportunity.id)).status.code).toBe('won');
  });

  it('holds a mapping marked "every Order" until every following Order qualifies', async () => {
    const opportunity = await createCrmOpportunity(h);
    await walk(opportunity.id, 'qualified', 'proposal');
    const first = await seedCrmOrder(h.em(), { status: 'processing' });
    const second = await seedCrmOrder(h.em(), { status: 'processing' });
    const notFollowing = await seedCrmOrder(h.em(), { status: 'processing' });
    expect((await linkCrmOrder(h, opportunity.id, first.id)).statusCode).toBe(201);
    expect((await linkCrmOrder(h, opportunity.id, second.id)).statusCode).toBe(201);
    expect((await linkCrmOrder(h, opportunity.id, notFollowing.id, { syncStatus: false })).statusCode).toBe(201);

    await changeOrderStatusAsOperator(h, first.id, 'shipment_ready');
    expect((await detail(opportunity.id)).status.code).toBe('proposal');
    // Held, not refused: nothing is recorded for a rule that is simply not met yet.
    expect(await propagationRows(opportunity.id)).toEqual([]);

    await changeOrderStatusAsOperator(h, second.id, 'shipment_ready');
    const moved = await detail(opportunity.id);
    expect(moved.status.code).toBe('won');
    expect(moved.closedKind).toBe('won');
    const rows = await history(opportunity.id);
    expect(rows.at(-1)).toMatchObject({ toStatusCode: 'won', cause: 'order_status', causeOrderId: second.id });
    // The Order that does not follow the Opportunity was never part of the rule.
    expect(await orderStatus(notFollowing.id)).toBe('processing');
  });

  it('records a skipped change, with the reason, when the workflow has no such transition', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em(), { status: 'shipment_sent' });
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

    // `completed` maps to `won`; the seeded workflow has no `new → won`.
    await changeOrderStatusAsOperator(h, order.id, 'completed');

    expect((await detail(opportunity.id)).status.code).toBe('new');
    expect(await history(opportunity.id)).toHaveLength(1);
    const rows = await propagationRows(opportunity.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: 'order_to_opportunity',
      orderId: order.id,
      orderStatusCode: 'completed',
      opportunityStatusCode: 'won',
      outcome: 'skipped',
    });
    expect(rows[0]?.detail).toEqual(expect.stringContaining('new'));
    expect(rows[0]?.resolvedAt).toBeInstanceOf(Date);
  });

  it('runs the registered guards for an Order-caused move, and records a veto as skipped', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

    const registry = h.container.resolve<OpportunityTransitionGuardRegistryPort>(
      'opportunityTransitionGuardRegistry',
    );
    let active = true;
    const seen: Array<{ cause: string; causeOrderId?: string | undefined }> = [];
    registry.register({
      ownerModuleId: 'crm',
      match: { from: 'new', to: 'qualified' },
      guard: (event) => {
        if (!active || event.opportunityId !== opportunity.id) return;
        seen.push({ cause: event.cause, causeOrderId: event.causeOrderId });
        throw new OpportunityTransitionVetoError('Qualification needs a signed NDA.', event.from, event.to);
      },
    });
    try {
      await changeOrderStatusAsOperator(h, order.id, 'paid');
    } finally {
      active = false;
    }

    expect(seen).toEqual([{ cause: 'order_status', causeOrderId: order.id }]);
    expect((await detail(opportunity.id)).status.code).toBe('new');
    expect(await orderStatus(order.id)).toBe('paid');
    const rows = await propagationRows(opportunity.id);
    expect(rows).toEqual([
      expect.objectContaining({
        direction: 'order_to_opportunity',
        outcome: 'skipped',
        detail: 'Qualification needs a signed NDA.',
      }),
    ]);
  });

  it('never reopens a closed Opportunity', async () => {
    const opportunity = await createCrmOpportunity(h);
    await walk(opportunity.id, 'lost');
    const order = await seedCrmOrder(h.em(), { status: 'shipment_ready' });
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

    // `shipment_sent` maps to `new`, and `lost → new` is an edge an operator may take by hand.
    await changeOrderStatusAsOperator(h, order.id, 'shipment_sent');

    const after = await detail(opportunity.id);
    expect(after.status.code).toBe('lost');
    expect(after.closedKind).toBe('lost');
    expect(await history(opportunity.id)).toHaveLength(2);
    expect(await propagationRows(opportunity.id)).toEqual([]);
  });

  it('ignores an Order that does not follow its Opportunity, and one that is linked to nothing', async () => {
    const opportunity = await createCrmOpportunity(h);
    const notFollowing = await seedCrmOrder(h.em());
    const unlinked = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, opportunity.id, notFollowing.id, { syncStatus: false })).statusCode).toBe(201);

    await changeOrderStatusAsOperator(h, notFollowing.id, 'paid');
    await changeOrderStatusAsOperator(h, unlinked.id, 'paid');

    expect((await detail(opportunity.id)).status.code).toBe('new');
    expect(await history(opportunity.id)).toHaveLength(1);
  });
});
