import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { EventBus } from '../../../src/events/bus.js';
import { OrderStatusGraphService } from '../../../../packages/modules/orders/dist/backend/services/order-status-graph-service.js';
import { OrderTransitionService } from '../../../../packages/modules/orders/dist/backend/services/order-transition-service.js';
import { OrderTransitionVetoError } from '../../../../packages/modules/orders/dist/backend/events/order-status-events.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 038 (US1) — configurable lifecycle wired to the DB.
 *
 * Exercises OrderStatusGraphService (seeded graph + CRUD guards) and
 * OrderTransitionService (enforced transitions, templated events, veto).
 */
describe('order status lifecycle (feature 038)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createOrder(status = 'new'): Promise<Order> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      status,
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '100.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '100.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order;
  }

  describe('OrderStatusGraphService', () => {
    it('loads the 9 seeded default statuses and the predefined transitions', async () => {
      const svc = new OrderStatusGraphService(h.em);
      const graph = await svc.loadGraph();
      expect(graph.statuses.map((s) => s.code).sort()).toEqual(
        ['cancelled', 'completed', 'new', 'on_hold', 'paid', 'pending', 'processing', 'shipment_ready', 'shipment_sent'].sort(),
      );
      expect(graph.initialCode()).toBe('new');
      expect(graph.canTransition('new', 'pending')).toBe(true);
      expect(graph.canTransition('pending', 'paid')).toBe(true);
      expect(graph.canTransition('new', 'completed')).toBe(false);
      expect(graph.canTransition('completed', 'on_hold')).toBe(false);
      expect(graph.canTransition('paid', 'on_hold')).toBe(true);
    });

    it('reports inUseCount and refuses deleting the initial / in-use status', async () => {
      const svc = new OrderStatusGraphService(h.em);
      await createOrder('pending');
      const listed = await svc.listGraph();
      const pending = listed.statuses.find((s) => s.code === 'pending');
      expect(pending?.inUseCount).toBeGreaterThanOrEqual(1);

      await expect(svc.deleteStatus('new')).rejects.toMatchObject({ statusCode: 409 });
      await expect(svc.deleteStatus('pending')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('creates a custom status with universal edges, then deletes it', async () => {
      const svc = new OrderStatusGraphService(h.em);
      const code = `await_stock_${Date.now()}`;
      await svc.createStatus({ code, name: { en: 'Await stock' }, defaultName: 'Await stock', weight: 45 });
      let graph = await svc.loadGraph();
      expect(graph.has(code)).toBe(true);
      // Universal edges: any non-terminal → on_hold/cancelled, on_hold → any.
      expect(graph.canTransition(code, 'on_hold')).toBe(true);
      expect(graph.canTransition(code, 'cancelled')).toBe(true);
      expect(graph.canTransition('on_hold', code)).toBe(true);

      await svc.deleteStatus(code);
      graph = await svc.loadGraph();
      expect(graph.has(code)).toBe(false);
    });
  });

  describe('OrderTransitionService', () => {
    it('applies a valid transition and emits the templated after-events', async () => {
      const bus = new EventBus();
      const fired: string[] = [];
      bus.on('order.status.from_new_to_pending.after', () => void fired.push('fromTo'));
      bus.on('order.status.to_pending.after', () => void fired.push('to'));
      bus.on('order.status_changed.v1', () => void fired.push('coarse'));

      const graphSvc = new OrderStatusGraphService(h.em);
      const svc = new OrderTransitionService(h.em, bus, graphSvc);
      const order = await createOrder('new');

      const updated = await svc.apply(order.id, 'pending', { kind: 'admin', adminUserId: randomUUID() });
      expect(updated.status).toBe('pending');
      expect(fired).toContain('fromTo');
      expect(fired).toContain('to');
      expect(fired).toContain('coarse');
    });

    it('rejects a transition with no configured edge', async () => {
      const graphSvc = new OrderStatusGraphService(h.em);
      const svc = new OrderTransitionService(h.em, new EventBus(), graphSvc);
      const order = await createOrder('new');
      await expect(svc.apply(order.id, 'shipment_sent', { kind: 'admin', adminUserId: randomUUID() })).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('lets a registered before-guard veto a transition (status unchanged)', async () => {
      const graphSvc = new OrderStatusGraphService(h.em);
      const svc = new OrderTransitionService(h.em, new EventBus(), graphSvc);
      svc.onOrderTransitionGuard({ to: 'cancelled' }, () => {
        throw new OrderTransitionVetoError('no cancel', 'new', 'cancelled');
      });
      const order = await createOrder('new');
      await expect(svc.apply(order.id, 'cancelled', { kind: 'admin', adminUserId: randomUUID() })).rejects.toMatchObject({
        statusCode: 409,
      });
      const reloaded = await h.em().findOneOrFail(Order, { id: order.id });
      expect(reloaded.status).toBe('new');
    });

    it('isolates a failing after-handler from the transition', async () => {
      const bus = new EventBus();
      bus.on('order.status.to_pending.after', () => {
        throw new Error('handler boom');
      });
      const graphSvc = new OrderStatusGraphService(h.em);
      const svc = new OrderTransitionService(h.em, bus, graphSvc);
      const order = await createOrder('new');
      const updated = await svc.apply(order.id, 'pending', { kind: 'system', source: 'payment' });
      expect(updated.status).toBe('pending');
    });
  });
});
