import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { DeliveryMethod } from '../../../src/modules/delivery_methods/entities/delivery-method.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';

/**
 * T036 — shipment lifecycle routes: generate (shipment_created), list, and the
 * receive_shipment ingress.
 *
 * Generate is also the retry path (FR-024), and since issue #257 it is the only
 * one: `POST .../shipments/retry` opened attempt n+1 and contacted no carrier,
 * so it is gone rather than repaired. The route's absence is asserted below,
 * because deleting a method does not stop someone re-mounting a path that
 * writes a shipment row nobody was asked about.
 */
const adminCookies = { b2b_session: 'stub-admin-session' };

async function seedOrder(em: EntityManager): Promise<string> {
  const method = em.create(DeliveryMethod, {
    code: `sr_${randomUUID().slice(0, 8)}`,
    name: { default: 'SR' },
    adapter: 'manual_courier',
    cost: '15.00',
    currency: 'PLN',
    status: 'active',
    statusOnSuccess: 'shipment_sent',
    statusOnFailure: 'processing',
  });
  await em.persistAndFlush(method);
  const order = em.create(Order, {
    organizationId: randomUUID(),
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: randomUUID(),
    deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: method.id,
    deliveryMethodSnapshot: { code: method.code, name: 'SR', cost: 15 },
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
  return order.id;
}

describe('Shipment routes', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('generates a pending shipment, lists it, resolves it, then refuses to generate again after success', async () => {
    const orderId = await seedOrder(h.em());

    const gen = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/shipments`,
      cookies: adminCookies,
    });
    expect(gen.statusCode).toBe(201);
    const shipment = (gen.json() as { data: { id: string; status: string; attemptNo: number } }).data;
    expect(shipment.status).toBe('pending');
    expect(shipment.attemptNo).toBe(1);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}/shipments`,
      cookies: adminCookies,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);

    const receive = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shipments/receive',
      cookies: adminCookies,
      payload: { shipmentId: shipment.id, outcome: 'success', providerDetails: { trackingNumber: 'TRK9' } },
    });
    expect(receive.statusCode).toBe(200);
    const result = (receive.json() as { data: { status: string; orderStatus: string } }).data;
    expect(result.status).toBe('success');
    expect(result.orderStatus).toBe('shipment_sent');

    const again = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/shipments`,
      cookies: adminCookies,
    });
    expect(again.statusCode).toBe(409);
  });

  it('serves no retry route — the only way to open an attempt asks the carrier (#257)', async () => {
    const orderId = await seedOrder(h.em());

    const retry = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/shipments/retry`,
      cookies: adminCookies,
    });

    expect(retry.statusCode).toBe(404);

    // ...and it opened nothing on the way to being refused.
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}/shipments`,
      cookies: adminCookies,
    });
    expect((list.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it('receive with no shipmentId or (orderId+externalReference) is a validation error', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shipments/receive',
      cookies: adminCookies,
      payload: { outcome: 'success' },
    });
    expect(res.statusCode).toBe(400);
  });
});
