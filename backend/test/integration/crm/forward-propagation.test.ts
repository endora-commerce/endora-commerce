import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  OpportunityTransitionResponseSchema,
  PropagationOutcomeResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { OrderTransitionService } from '../../../../packages/modules/orders/src/backend/services/order-transition-service.js';
// `dist`, not `src`: the composed platform holds the package's built copy and
// the transition service compares a veto with `instanceof`
// (`test/integration/orders/order-transition-port.test.ts` says why at length).
import { OrderTransitionVetoError } from '../../../../packages/modules/orders/dist/backend/events/order-status-events.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmForwardMappings,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { CrmStatusPropagation, Order } from '../../helpers/package-entities.js';

/**
 * The forward direction: an Opportunity's transition asks its linked Orders to
 * follow (`specs/143-crm-sales-opportunities/research.md` R-4).
 *
 * Every following Order is asked independently, through `orders`' own
 * transition port and therefore through the Order workflow's own rules; each
 * answer is recorded and returned. **The Opportunity's transition stands
 * whatever the Orders answer** — a refusal is an outcome on the response and a
 * row an operator can retry or dismiss, never an HTTP error and never a
 * rollback.
 */
describe('crm forward propagation', () => {
  let h: BackendServerHandle;

  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies: CRM_ADMIN,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const orderStatus = async (id: string) =>
    (await h.em().findOneOrFail(Order, { id }, { filters: false })).status;

  const detail = async (id: string) =>
    OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${id}`)).json()).data;

  const propagationRows = (opportunityId: string) =>
    h.em().find(CrmStatusPropagation, { opportunityId }, { filters: false, orderBy: { createdAt: 'asc' } });

  const orderTransitions = (): OrderTransitionService => {
    const service = h.container.resolve<() => OrderTransitionService | null>('orderTransitionServiceAccessor')();
    if (!service) throw new Error('orders: the transition service is not composed');
    return service;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    // new → paid and paid → processing are edges of the seeded Order workflow.
    const mapped = await setCrmForwardMappings(h, {
      qualified: 'paid',
      proposal: 'processing',
      negotiation: 'no_longer_an_order_status',
    });
    expect(mapped.statusCode, mapped.body).toBe(200);
  });

  afterAll(async () => {
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('asks each following Order on its own: one follows, one is not asked, one refuses — and the Opportunity moves', async () => {
    const opportunity = await createCrmOpportunity(h);
    const follows = await seedCrmOrder(h.em());
    const notFollowing = await seedCrmOrder(h.em());
    const terminal = await seedCrmOrder(h.em(), { status: 'cancelled' });
    expect((await linkCrmOrder(h, opportunity.id, follows.id)).statusCode).toBe(201);
    expect((await linkCrmOrder(h, opportunity.id, notFollowing.id, { syncStatus: false })).statusCode).toBe(201);
    expect((await linkCrmOrder(h, opportunity.id, terminal.id)).statusCode).toBe(201);

    const response = await transitionCrmOpportunity(h, opportunity.id, 'qualified');
    expect(response.statusCode, response.body).toBe(200);
    const { data } = OpportunityTransitionResponseSchema.parse(response.json());
    expect(data.opportunity.status.code).toBe('qualified');

    const byOrder = new Map(data.propagation.map((outcome) => [outcome.orderId, outcome]));
    expect([...byOrder.keys()].sort()).toEqual([follows.id, terminal.id].sort());
    expect(byOrder.get(follows.id)).toMatchObject({ outcome: 'applied', orderStatusCode: 'paid', detail: null });
    expect(byOrder.get(terminal.id)).toMatchObject({ outcome: 'not_permitted', orderStatusCode: 'paid' });
    expect(byOrder.get(terminal.id)?.detail).toEqual(expect.stringContaining('terminal'));

    expect(await orderStatus(follows.id)).toBe('paid');
    expect(await orderStatus(notFollowing.id)).toBe('new');
    expect(await orderStatus(terminal.id)).toBe('cancelled');

    // Persisted, not only returned: one row per Order asked, none for the one that does not follow.
    const rows = await propagationRows(opportunity.id);
    expect(rows.map((row) => [row.orderId, row.outcome]).sort()).toEqual(
      [
        [follows.id, 'applied'],
        [terminal.id, 'not_permitted'],
      ].sort(),
    );
    for (const row of rows) {
      expect(row).toMatchObject({
        direction: 'opportunity_to_order',
        opportunityStatusCode: 'qualified',
        orderStatusCode: 'paid',
      });
      expect(row.dismissedAt ?? null).toBeNull();
      expect(row.resolvedAt).toBeInstanceOf(Date);
      expect(row.statusHistoryId).toEqual(expect.any(String));
    }

    // Only the refusal is unresolved; a followed Order needs nobody's attention.
    expect((await detail(opportunity.id)).unresolvedPropagations.map((row) => row.orderId)).toEqual([terminal.id]);
  });

  it('asks nothing of anybody when the new status has no mapping', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
    const response = await transitionCrmOpportunity(h, opportunity.id, 'lost');
    expect(response.statusCode, response.body).toBe(200);
    expect(OpportunityTransitionResponseSchema.parse(response.json()).data.propagation).toEqual([]);
    expect(await propagationRows(opportunity.id)).toEqual([]);
    expect(await orderStatus(order.id)).toBe('new');
  });

  it('writes the row as pending before it asks the Order, and records an Order-side veto as vetoed', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

    // An Order guard runs inside the Orders port call, before the Order is
    // written. What it reads of CRM's row is therefore what CRM had committed
    // before it asked.
    const seenFromInsideThePortCall: Array<{ outcome: string; resolved_at: Date | null }> = [];
    const unsubscribe = orderTransitions().onOrderTransitionGuard({ to: 'paid' }, async (event) => {
      if (event.orderId !== order.id) return;
      const rows = (await h.orm.em.getConnection().execute(
        `select "outcome", "resolved_at" from "crm_status_propagations" where "order_id" = ?`,
        [order.id],
      )) as Array<{ outcome: string; resolved_at: Date | null }>;
      seenFromInsideThePortCall.push(...rows);
      throw new OrderTransitionVetoError('The warehouse is closed for stocktaking.', event.from, event.to);
    });

    let refusalId: string;
    try {
      const response = await transitionCrmOpportunity(h, opportunity.id, 'qualified');
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityTransitionResponseSchema.parse(response.json());
      // The Opportunity moved although the Order refused.
      expect(data.opportunity.status.code).toBe('qualified');
      expect(data.propagation).toHaveLength(1);
      expect(data.propagation[0]).toMatchObject({
        orderId: order.id,
        outcome: 'vetoed',
        detail: 'The warehouse is closed for stocktaking.',
      });
      refusalId = data.propagation[0]!.id;
    } finally {
      unsubscribe();
    }
    expect(seenFromInsideThePortCall).toEqual([{ outcome: 'pending', resolved_at: null }]);
    expect(await orderStatus(order.id)).toBe('new');

    // The cause is gone — the guard was withdrawn. Retry: applied, and the old row is retired.
    const retried = await call('POST', `/opportunities/${opportunity.id}/propagations/${refusalId}/retry`);
    expect(retried.statusCode, retried.body).toBe(200);
    const outcome = PropagationOutcomeResponseSchema.parse(retried.json()).data;
    expect(outcome).toMatchObject({ orderId: order.id, outcome: 'applied', orderStatusCode: 'paid', detail: null });
    expect(outcome.id).not.toBe(refusalId);
    expect(await orderStatus(order.id)).toBe('paid');

    const rows = await propagationRows(opportunity.id);
    expect(rows).toHaveLength(2);
    const old = rows.find((row) => row.id === refusalId)!;
    const fresh = rows.find((row) => row.id === outcome.id)!;
    expect(old.outcome).toBe('vetoed');
    expect(old.dismissedAt).toBeInstanceOf(Date);
    expect(fresh.outcome).toBe('applied');
    expect(fresh.dismissedAt ?? null).toBeNull();
    expect((await detail(opportunity.id)).unresolvedPropagations).toEqual([]);
  });

  it('records already_there for an Order that is where the mapping asks, and does not flag it', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em(), { status: 'paid' });
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
    const response = await transitionCrmOpportunity(h, opportunity.id, 'qualified');
    expect(response.statusCode, response.body).toBe(200);
    const { data } = OpportunityTransitionResponseSchema.parse(response.json());
    expect(data.propagation).toEqual([expect.objectContaining({ orderId: order.id, outcome: 'already_there' })]);
    expect(data.opportunity.unresolvedPropagations).toEqual([]);
    expect(await orderStatus(order.id)).toBe('paid');
  });

  it('records unknown_status for a mapping onto an Order status that no longer exists', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
    for (const to of ['qualified', 'proposal']) {
      expect((await transitionCrmOpportunity(h, opportunity.id, to)).statusCode).toBe(200);
    }
    expect(await orderStatus(order.id)).toBe('processing');

    const response = await transitionCrmOpportunity(h, opportunity.id, 'negotiation');
    expect(response.statusCode, response.body).toBe(200);
    const { data } = OpportunityTransitionResponseSchema.parse(response.json());
    expect(data.opportunity.status.code).toBe('negotiation');
    expect(data.propagation).toEqual([
      expect.objectContaining({
        orderId: order.id,
        orderStatusCode: 'no_longer_an_order_status',
        outcome: 'unknown_status',
      }),
    ]);
    expect(data.propagation[0]?.detail).toEqual(expect.any(String));
    expect(await orderStatus(order.id)).toBe('processing');
    expect((await detail(opportunity.id)).unresolvedPropagations).toHaveLength(1);
  });

  it('records not_found for a linked Order that is gone, and still moves the Opportunity', async () => {
    const opportunity = await createCrmOpportunity(h);
    const order = await seedCrmOrder(h.em());
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
    await h.em().getConnection().execute(`delete from "orders" where "id" = ?`, [order.id]);

    const response = await transitionCrmOpportunity(h, opportunity.id, 'qualified');
    expect(response.statusCode, response.body).toBe(200);
    const { data } = OpportunityTransitionResponseSchema.parse(response.json());
    expect(data.opportunity.status.code).toBe('qualified');
    expect(data.propagation).toEqual([
      expect.objectContaining({ orderId: order.id, orderNumber: null, outcome: 'not_found' }),
    ]);
    // The link itself renders as unavailable rather than breaking the screen.
    expect(data.opportunity.links).toEqual([
      expect.objectContaining({ documentId: order.id, available: false }),
    ]);
  });
});
