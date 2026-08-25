import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  DeliveryMethodReadPort,
  OrderReadPort,
  OrderTransitionPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  ReceiveShipmentHandler,
  type CarrierCallbackLogger,
} from '../../../../packages/modules/shipments/src/backend/services/receive-shipment-handler.js';
import type { ShippingEventBus } from '../../../../packages/modules/shipments/src/backend/services/events.js';
import { ShipmentService } from '../../../../packages/modules/shipments/src/backend/services/shipment-service.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { ShippingAdapterRegistry } from '../../../../packages/modules/delivery_methods/src/backend/services/shipping-adapter-registry.js';
import { builtInShippingAdapters } from '../../../../packages/modules/delivery_methods/src/backend/adapters/built-in-adapters.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { DeliveryMethod, Shipment, type DeliveryMethodRow } from '../../helpers/package-entities.js';

interface Fixture {
  method: DeliveryMethodRow;
  order: Order;
}

async function seedOrder(
  em: EntityManager,
  opts: {
    adapter?: string;
    statusOnSuccess?: string;
    statusOnFailure?: string;
    /**
     * Where the order sits when the carrier calls back. It matters since
     * feature 085 Phase D: the move goes through the configured graph, and
     * `shipment_sent` is reachable from `shipment_ready` and `on_hold` only.
     */
    status?: string;
  } = {},
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
    status: opts.status ?? 'paid',
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

describe('Shipment lifecycle: createShipment (generate and retry) + receive_shipment', () => {
  let h: BackendServerHandle;
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
    orderTransitionPort: OrderTransitionPort;
  } =>
    h.container.cradle as unknown as {
      orderReadPort: OrderReadPort;
      deliveryMethodReadPort: DeliveryMethodReadPort;
      orderTransitionPort: OrderTransitionPort;
    };

  /** Refusals, when a case wants to read them rather than ignore them. */
  function recordingLog(): CarrierCallbackLogger & { warnings: object[] } {
    const warnings: object[] = [];
    return { warnings, warn: (details) => void warnings.push(details) };
  }

  const shipmentService = (): ShipmentService =>
    new ShipmentService(
      h.em,
      registry,
      ports().orderReadPort,
      ports().deliveryMethodReadPort,
      new AuditLogService(h.em),
    );

  const receiveHandler = (
    events?: ShippingEventBus,
    log: CarrierCallbackLogger = { warn: () => undefined },
  ): ReceiveShipmentHandler =>
    new ReceiveShipmentHandler(
      h.em,
      ports().deliveryMethodReadPort,
      ports().orderTransitionPort,
      log,
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
    // `shipment_ready`, because `shipment_ready -> shipment_sent` is the edge
    // the default lifecycle actually carries. See the case at the end of this
    // file for what the same callback does from `paid`, which is where the
    // shipped `delivery_methods` defaults leave a great many orders.
    const { order } = await seedOrder(h.em(), { status: 'shipment_ready' });
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
    // Audited, which no shipment-driven status change had ever been (085 R3).
    expect(
      await h.auditLogService.query({
        action: 'order.status_transition',
        objectId: order.id,
      }),
    ).toHaveLength(1);
  });

  /**
   * Feature 085 Phase D, and a finding this case records rather than repairs.
   *
   * `delivery_methods` seeds `status_on_success = 'shipment_sent'` and
   * `status_on_failure = 'processing'`, and **neither is reachable from every
   * status a carrier callback can find an order in**: `shipment_sent` has one
   * inbound edge in the default graph, from `shipment_ready` (plus the
   * universal one out of `on_hold`), and `processing` has two, from `pending`
   * and `paid`. An operator who generates a shipment while the order is still
   * at `paid` therefore gets this — the order keeps its status and the callback
   * is answered.
   *
   * That is the architect's ruling applied, not a regression: forcing the jump
   * is what the ingress used to do, and it made the configured lifecycle a
   * fiction on this path. Repairing the defaults belongs to whoever revisits
   * `delivery_methods`; Phase C deliberately left it alone.
   */
  it('keeps the order where it is when the configured target is unreachable', async () => {
    const { order } = await seedOrder(h.em(), { status: 'paid' });
    const service = shipmentService();
    const log = recordingLog();
    const handler = receiveHandler(undefined, log);
    const shipment = await service.createShipment(order.id);

    const res = await handler.receive({ shipmentId: shipment.id, outcome: 'success' });

    // The carrier's half stands: the shipment is generated and answered for.
    expect(res.status).toBe('success');
    expect(res.orderStatus).toBe('paid');
    expect((await h.em().findOne(Order, { id: order.id }, { refresh: true }))!.status).toBe('paid');
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toMatchObject({
      orderId: order.id,
      from: 'paid',
      to: 'shipment_sent',
      setting: 'status_on_success',
      refusal: 'not_permitted',
    });
    expect(
      await h.auditLogService.query({
        action: 'order.status_transition',
        objectId: order.id,
      }),
    ).toHaveLength(0);
  });

  it('is idempotent on repeated success and rejects failure after success', async () => {
    const { order } = await seedOrder(h.em(), { status: 'shipment_ready' });
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

  /**
   * FR-024 through the only path that still opens an attempt (issue #257).
   *
   * This case used to call `openRetry`, and it asserted the two things that
   * were true of it — a second row, prior attempts intact — while asserting
   * nothing at all about the carrier, which is how a retry that contacted
   * nobody stayed green. The carrier assertion is the point of the case now.
   */
  it('generating again after a failure opens the next attempt and asks the carrier', async () => {
    const { order } = await seedOrder(h.em());
    const service = shipmentService();
    const handler = receiveHandler();
    const first = await service.createShipment(order.id);

    await handler.receive({ shipmentId: first.id, outcome: 'failure', failureReason: 'x' });

    const adapter = registry.entry('manual_courier')!.adapter;
    const asked = vi.spyOn(adapter, 'onShipmentCreated');
    try {
      const retry = await service.createShipment(order.id);

      expect(retry.attemptNo).toBe(2);
      expect(retry.status).toBe('pending');
      expect(asked).toHaveBeenCalledTimes(1);
      expect(asked.mock.calls[0]![0]).toMatchObject({
        orderId: order.id,
        shipmentId: retry.id,
        attemptNo: 2,
      });

      const all = await service.listForOrder(order.id);
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.attemptNo)).toEqual([1, 2]);
    } finally {
      asked.mockRestore();
    }
  });

  /**
   * The four templated names are `orders`' vocabulary, and this module builds
   * none of them: since feature 085 Phase D it does not announce at all. The
   * transition seam emits them for the move it applied, which is why this case
   * still passes with `orderStatusAnnouncePort` gone from the handler — and why
   * announcing beside the port would have doubled every one of them.
   *
   * The subscriptions go on the container's own bus, which is what the seam
   * emits onto. That is a stronger assertion than the local bus this test used
   * to hand the handler: it proves the announcement reaches the platform's bus
   * through `orders`, not merely that the handler called a builder it had
   * imported.
   *
   * The `fired` array is asserted for *content* rather than length because the
   * coarse event settles a tick later; a length assertion here would be the
   * one that catches a double emission, and the case below it does that.
   */
  it('announces the templated order status .after events on the auto-transition (T026)', async () => {
    const fired: string[] = [];
    const unsubscribe = [
      h.eventBus.on('order.status.to_shipment_sent.after', () => void fired.push('to')),
      h.eventBus.on('order.status.from_shipment_ready_to_shipment_sent.after', () =>
        void fired.push('fromTo'),
      ),
      h.eventBus.on('order.status_changed.v1', () => void fired.push('coarse')),
    ];

    try {
      // Seeded at `shipment_ready`, which is where the edge to `shipment_sent`
      // starts; the announcement is the transition seam's own now.
      const { order } = await seedOrder(h.em(), { status: 'shipment_ready' });
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

  /**
   * Feature 085 Phase D — **once**, not twice.
   *
   * The transition seam emits the templated `.after` events for the move it
   * applies. A handler that also announced the same change through
   * `orderStatusAnnouncePort` would emit every payment- and shipment-driven
   * status change twice, and nothing in the type system, the port checks or the
   * case above would say so: `toContain` is satisfied by two.
   */
  it('announces the change exactly once, not once per seam (085 Phase D)', async () => {
    let announcements = 0;
    let coarse = 0;
    const unsubscribe = [
      h.eventBus.on('order.status.to_shipment_sent.after', () => void (announcements += 1)),
      h.eventBus.on('order.status_changed.v1', () => void (coarse += 1)),
    ];

    try {
      const { order } = await seedOrder(h.em(), { status: 'shipment_ready' });
      const service = shipmentService();
      const handler = receiveHandler(h.eventBus as unknown as ShippingEventBus);
      const shipment = await service.createShipment(order.id);
      await handler.receive({ shipmentId: shipment.id, outcome: 'success' });

      // The coarse event is emitted from a subscriber on the templated one, so
      // waiting for it is waiting for the whole fan-out to settle — a second
      // announcement would have arrived by then.
      await vi.waitFor(() => expect(coarse).toBeGreaterThan(0));
      expect(announcements).toBe(1);
    } finally {
      for (const stop of unsubscribe) stop();
    }
  });

  it('reconciles a late receive even when the adapter is de-registered', async () => {
    const { order } = await seedOrder(h.em(), {
      adapter: 'removed_carrier',
      status: 'shipment_ready',
    });
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
