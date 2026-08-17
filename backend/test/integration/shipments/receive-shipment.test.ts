import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  DeliveryMethodReadPort,
  OrderReadPort,
  OrderStatusAnnouncePort,
} from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReceiveShipmentHandler } from '../../../src/modules/shipments/services/receive-shipment-handler.js';
import type { ShippingEventBus } from '../../../src/modules/shipments/services/events.js';
import { ShipmentService } from '../../../src/modules/shipments/services/shipment-service.js';
import { ShippingAdapterRegistry } from '../../../src/modules/delivery_methods/services/shipping-adapter-registry.js';
import { builtInShippingAdapters } from '../../../src/modules/delivery_methods/adapters/built-in-adapters.js';
import { EnumOrderStatusRegistry } from '../../../src/modules/delivery_methods/services/order-status-registry.port.js';
import { DeliveryMethod } from '../../../src/modules/delivery_methods/entities/delivery-method.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Shipment } from '../../../src/modules/shipments/entities/shipment.entity.js';

interface Fixture {
  method: DeliveryMethod;
  order: Order;
}

async function seedOrder(
  em: EntityManager,
  opts: { adapter?: string; statusOnSuccess?: string; statusOnFailure?: string } = {},
): Promise<Fixture> {
  const method = em.create(DeliveryMethod, {
    code: `rs_${randomUUID().slice(0, 8)}`,
    name: { default: 'RS' },
    adapter: opts.adapter ?? 'manual_courier',
    cost: '15.00',
    currency: 'PLN',
    status: 'active',
    statusOnSuccess: opts.statusOnSuccess ?? 'shipment_sent',
    statusOnFailure: opts.statusOnFailure ?? 'processing',
  });
  await em.persistAndFlush(method);

  const order = em.create(Order, {
    organizationId: randomUUID(),
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: randomUUID(),
    deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: method.id,
    deliveryMethodSnapshot: { code: method.code, name: 'RS', cost: 15 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
    status: 'paid',
    subtotal: '100.00',
    taxTotal: '23.00',
    deliveryTotal: '15.00',
    total: '138.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  return { method, order };
}

describe('Shipment lifecycle: createShipment + receive_shipment + retry', () => {
  let h: BackendServerHandle;
  const statusRegistry = new EnumOrderStatusRegistry();
  const registry = new ShippingAdapterRegistry();
  for (const a of builtInShippingAdapters()) registry.register(a, 'delivery_methods');

  /**
   * Feature 075 Phase C — the two services take their cross-module reads as
   * ports now, so this suite hands them the **real** ones out of the composed
   * container rather than an entity class. Resolved per call, never captured: a
   * captured gate keeps answering after its owner is switched off.
   */
  const ports = (): {
    orderReadPort: OrderReadPort;
    deliveryMethodReadPort: DeliveryMethodReadPort;
    orderStatusAnnouncePort: OrderStatusAnnouncePort;
  } =>
    h.container.cradle as unknown as {
      orderReadPort: OrderReadPort;
      deliveryMethodReadPort: DeliveryMethodReadPort;
      orderStatusAnnouncePort: OrderStatusAnnouncePort;
    };

  const shipmentService = (): ShipmentService =>
    new ShipmentService(h.em, registry, ports().orderReadPort, ports().deliveryMethodReadPort);

  const receiveHandler = (events?: ShippingEventBus): ReceiveShipmentHandler =>
    new ReceiveShipmentHandler(
      h.em,
      statusRegistry,
      ports().deliveryMethodReadPort,
      ports().orderStatusAnnouncePort,
      events,
    );

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('createShipment opens a pending Shipment (shipment_created)', async () => {
    const { order } = await seedOrder(h.em());
    const service = shipmentService();
    const shipment = await service.createShipment(order.id);
    expect(shipment.status).toBe('pending');
    expect(shipment.attemptNo).toBe(1);
  });

  it('receive_shipment success → Shipment success + order statusOnSuccess', async () => {
    const { order } = await seedOrder(h.em());
    const service = shipmentService();
    const handler = receiveHandler();
    const shipment = await service.createShipment(order.id);

    const res = await handler.receive({
      shipmentId: shipment.id,
      outcome: 'success',
      externalReference: 'TRK1',
      providerDetails: { trackingNumber: 'TRK1' },
    });
    expect(res.status).toBe('success');
    expect(res.orderStatus).toBe('shipment_sent');

    const em = h.em();
    const reloaded = await em.findOne(Shipment, { id: shipment.id });
    expect(reloaded!.status).toBe('success');
    expect(reloaded!.externalReference).toBe('TRK1');
    expect(reloaded!.providerDetails).toMatchObject({ trackingNumber: 'TRK1' });
    const reloadedOrder = await em.findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('shipment_sent');
  });

  it('receive_shipment failure → Shipment failure + order statusOnFailure', async () => {
    const { order } = await seedOrder(h.em());
    const service = shipmentService();
    const handler = receiveHandler();
    const shipment = await service.createShipment(order.id);

    const res = await handler.receive({
      shipmentId: shipment.id,
      outcome: 'failure',
      failureReason: 'carrier rejected',
    });
    expect(res.status).toBe('failure');

    const em = h.em();
    const reloaded = await em.findOne(Shipment, { id: shipment.id });
    expect(reloaded!.status).toBe('failure');
    expect(reloaded!.failureReason).toBe('carrier rejected');
    const reloadedOrder = await em.findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('processing');
  });

  it('is idempotent on repeated success and rejects failure after success', async () => {
    const { order } = await seedOrder(h.em());
    const service = shipmentService();
    const handler = receiveHandler();
    const shipment = await service.createShipment(order.id);

    await handler.receive({ shipmentId: shipment.id, outcome: 'success' });
    const again = await handler.receive({ shipmentId: shipment.id, outcome: 'success' });
    expect(again.idempotent).toBe(true);

    await expect(
      handler.receive({ shipmentId: shipment.id, outcome: 'failure', failureReason: 'late' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('retry opens a new Shipment after a failure, preserving prior attempts', async () => {
    const { order } = await seedOrder(h.em());
    const service = shipmentService();
    const handler = receiveHandler();
    const first = await service.createShipment(order.id);

    await handler.receive({ shipmentId: first.id, outcome: 'failure', failureReason: 'x' });
    const retry = await service.openRetry(order.id);

    expect(retry.attemptNo).toBe(2);
    expect(retry.status).toBe('pending');
    const all = await service.listForOrder(order.id);
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.attemptNo)).toEqual([1, 2]);
  });

  /**
   * The four templated names are `orders`' vocabulary, and since feature 075
   * Phase C this module no longer builds them: it hands the committed change to
   * `orderStatusAnnouncePort`, and the naming scheme stays on the owner's side
   * — which matters because the status set is admin-configurable, so the names
   * are not known at compile time.
   *
   * The subscriptions therefore go on the container's own bus, which is what
   * the port emits onto. That is a stronger assertion than the local bus this
   * test used to hand the handler: it proves the announcement reaches the
   * platform's bus through `orders`, not merely that the handler called a
   * builder it had imported.
   */
  it('announces the templated order status .after events on the auto-transition (T026)', async () => {
    const fired: string[] = [];
    const unsubscribe = [
      h.eventBus.on('order.status.to_shipment_sent.after', () => void fired.push('to')),
      h.eventBus.on('order.status.from_paid_to_shipment_sent.after', () =>
        void fired.push('fromTo'),
      ),
      h.eventBus.on('order.status_changed.v1', () => void fired.push('coarse')),
    ];

    try {
      const { order } = await seedOrder(h.em()); // seeded in 'paid'; statusOnSuccess = 'shipment_sent'
      const service = shipmentService();
      // The events bus is what production passes, and the announcement rides
      // the same `emit` guard as the `shipment.*` events do.
      const handler = receiveHandler(h.eventBus as unknown as ShippingEventBus);
      const shipment = await service.createShipment(order.id);
      await handler.receive({ shipmentId: shipment.id, outcome: 'success' });

      // `emit` is fire-and-forget and `dispatch` awaits each handler in turn,
      // so the coarse event — which the composed platform already subscribes to
      // — settles a tick or two after the two templated ones this test is alone
      // on. The local bus this test used to build hid that; the real one cannot.
      await vi.waitFor(() => {
        expect(fired).toContain('to');
        expect(fired).toContain('fromTo');
        expect(fired).toContain('coarse');
      });
    } finally {
      for (const stop of unsubscribe) stop();
    }
  });

  it('reconciles a late receive even when the adapter is de-registered', async () => {
    const { order } = await seedOrder(h.em(), { adapter: 'removed_carrier' });
    const service = shipmentService();
    const handler = receiveHandler();
    // createShipment works even with an unregistered adapter (no adapter hook runs).
    const shipment = await service.createShipment(order.id);
    const res = await handler.receive({ shipmentId: shipment.id, outcome: 'success' });
    expect(res.status).toBe('success');
    const reloadedOrder = await h.em().findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('shipment_sent');
  });
});
