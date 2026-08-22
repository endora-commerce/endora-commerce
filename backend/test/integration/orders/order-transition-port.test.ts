import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderTransitionPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import type { OrderTransitionService } from '../../../src/modules/orders/services/order-transition-service.js';
import { OrderTransitionVetoError } from '../../../src/modules/orders/events/order-status-events.js';

/**
 * Feature 085 (Phase B) — the published `orderTransitionPort`.
 *
 * Resolved off the composed container by the literal name a consumer will pass
 * to `lazyPort`, so this exercises the registration and its gate rather than a
 * class the test constructed. There are no consumers yet: publishing the seam
 * is the deliverable, and this is what says the seam answers.
 */

async function seedOrder(em: EntityManager): Promise<Order> {
  const order = em.create(Order, {
    organizationId: randomUUID(),
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: randomUUID(),
    deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'p', name: 'P', kind: 'bank_transfer', adapter: 'bank_transfer' },
    subtotal: '100.00',
    taxTotal: '23.00',
    deliveryTotal: '0.00',
    total: '123.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  return order;
}

describe('orderTransitionPort', () => {
  let h: BackendServerHandle;
  let port: OrderTransitionPort;

  const system = { kind: 'system' as const, source: 'payment' as const };

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<OrderTransitionPort>('orderTransitionPort');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const statusOf = async (id: string): Promise<string> =>
    (await h.em().findOneOrFail(Order, { id })).status;

  it('applies a permitted transition and reports where it came from', async () => {
    const order = await seedOrder(h.em());

    // `new -> paid` is the happy path of every gateway payment, and the edge
    // Phase A added. Through the graph, which is the point of the port.
    const outcome = await port.applyStatus({ orderId: order.id, to: 'paid', actor: system });

    expect(outcome).toEqual({ applied: true, from: 'new', to: 'paid' });
    expect(await statusOf(order.id)).toBe('paid');
  });

  it('audits an applied transition exactly once — the thing the bypasses skip', async () => {
    const order = await seedOrder(h.em());

    await port.applyStatus({ orderId: order.id, to: 'paid', actor: system, reason: 'psp settled' });

    const entries = await h.auditLogService.query({
      action: 'order.status_transition',
      objectId: order.id,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.stateBefore).toEqual({ status: 'new' });
    expect(entries[0]?.stateAfter).toEqual({ status: 'paid' });
  });

  it('reports an order already at the target as already_there, recording nothing', async () => {
    const order = await seedOrder(h.em());

    const outcome = await port.applyStatus({ orderId: order.id, to: 'new', actor: system });

    expect(outcome).toEqual({ applied: false, reason: 'already_there', from: 'new' });
    expect(
      await h.auditLogService.query({ action: 'order.status_transition', objectId: order.id }),
    ).toHaveLength(0);
  });

  it('refuses a status the configured lifecycle does not know', async () => {
    const order = await seedOrder(h.em());

    const outcome = await port.applyStatus({
      orderId: order.id,
      to: 'no_such_status',
      actor: system,
    });

    expect(outcome).toMatchObject({ applied: false, reason: 'unknown_status', from: 'new' });
    expect(await statusOf(order.id)).toBe('new');
  });

  it('refuses a transition the graph has no edge for, leaving the status alone', async () => {
    const order = await seedOrder(h.em());

    const outcome = await port.applyStatus({ orderId: order.id, to: 'completed', actor: system });

    expect(outcome).toMatchObject({ applied: false, reason: 'not_permitted', from: 'new' });
    expect(await statusOf(order.id)).toBe('new');
  });

  it('refuses to move an order out of a terminal status', async () => {
    const order = await seedOrder(h.em());
    await port.applyStatus({ orderId: order.id, to: 'cancelled', actor: system });

    const outcome = await port.applyStatus({ orderId: order.id, to: 'paid', actor: system });

    expect(outcome).toMatchObject({ applied: false, reason: 'not_permitted', from: 'cancelled' });
    expect(await statusOf(order.id)).toBe('cancelled');
  });

  /**
   * The discrimination the seam exists to keep honest: `apply` throws one 409
   * for a missing edge and for a veto, so a port that only translated the
   * exception would report both as the same thing. The two answers here differ
   * over the same status pair — the edge is present, and the guard is what
   * refuses.
   */
  it('tells a guard veto apart from a missing edge, on an edge that exists', async () => {
    const order = await seedOrder(h.em());
    await port.applyStatus({ orderId: order.id, to: 'paid', actor: system });

    const transitions = h.container.resolve<() => OrderTransitionService | null>(
      'orderTransitionServiceAccessor',
    )();
    expect(transitions).not.toBeNull();
    const unsubscribe = transitions!.onOrderTransitionGuard({ to: 'processing' }, () => {
      throw new OrderTransitionVetoError('not while the warehouse is closed', 'paid', 'processing');
    });

    try {
      const outcome = await port.applyStatus({
        orderId: order.id,
        to: 'processing',
        actor: system,
      });
      expect(outcome).toMatchObject({ applied: false, reason: 'vetoed', from: 'paid' });
      expect(await statusOf(order.id)).toBe('paid');
    } finally {
      unsubscribe();
    }

    // The same pair applies once the guard is gone, which is what says the
    // refusal was the veto and not the graph.
    expect(
      await port.applyStatus({ orderId: order.id, to: 'processing', actor: system }),
    ).toEqual({ applied: true, from: 'paid', to: 'processing' });
  });

  it('reports an unknown order as not_found rather than throwing', async () => {
    const outcome = await port.applyStatus({ orderId: randomUUID(), to: 'paid', actor: system });

    expect(outcome).toMatchObject({ applied: false, reason: 'not_found', from: null });
  });

  it('answers terminality from the graph, not from a status code it knows', async () => {
    const order = await seedOrder(h.em());
    expect(await port.isTerminal(order.id)).toBe(false);

    await port.applyStatus({ orderId: order.id, to: 'cancelled', actor: system });
    expect(await port.isTerminal(order.id)).toBe(true);

    expect(await port.isTerminal(randomUUID())).toBeNull();
  });
});
