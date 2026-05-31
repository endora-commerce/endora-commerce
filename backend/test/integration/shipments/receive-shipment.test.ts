import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReceiveShipmentHandler } from '../../../src/modules/shipments/services/receive-shipment-handler.js';
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
  for (const a of builtInShippingAdapters()) registry.register(a);

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('createShipment opens a pending Shipment (shipment_created)', async () => {
    const { order } = await seedOrder(h.em());
    const service = new ShipmentService(h.em, registry);
    const shipment = await service.createShipment(order.id);
    expect(shipment.status).toBe('pending');
    expect(shipment.attemptNo).toBe(1);
  });

  it('receive_shipment success → Shipment success + order statusOnSuccess', async () => {
    const { order } = await seedOrder(h.em());
    const service = new ShipmentService(h.em, registry);
    const handler = new ReceiveShipmentHandler(h.em, statusRegistry);
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
    const service = new ShipmentService(h.em, registry);
    const handler = new ReceiveShipmentHandler(h.em, statusRegistry);
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
    const service = new ShipmentService(h.em, registry);
    const handler = new ReceiveShipmentHandler(h.em, statusRegistry);
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
    const service = new ShipmentService(h.em, registry);
    const handler = new ReceiveShipmentHandler(h.em, statusRegistry);
    const first = await service.createShipment(order.id);

    await handler.receive({ shipmentId: first.id, outcome: 'failure', failureReason: 'x' });
    const retry = await service.openRetry(order.id);

    expect(retry.attemptNo).toBe(2);
    expect(retry.status).toBe('pending');
    const all = await service.listForOrder(order.id);
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.attemptNo)).toEqual([1, 2]);
  });

  it('reconciles a late receive even when the adapter is de-registered', async () => {
    const { order } = await seedOrder(h.em(), { adapter: 'removed_carrier' });
    const service = new ShipmentService(h.em, registry);
    const handler = new ReceiveShipmentHandler(h.em, statusRegistry);
    // createShipment works even with an unregistered adapter (no adapter hook runs).
    const shipment = await service.createShipment(order.id);
    const res = await handler.receive({ shipmentId: shipment.id, outcome: 'success' });
    expect(res.status).toBe('success');
    const reloadedOrder = await h.em().findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('shipment_sent');
  });
});
