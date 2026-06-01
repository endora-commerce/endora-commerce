import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';

/**
 * T017b (US1) — delete-guard (FR-003). A payment method referenced by at least
 * one Payment cannot be deleted (409); an unreferenced one deletes (204).
 */
describe('Admin payment-methods delete-guard', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('blocks delete when a Payment references the method (409)', async () => {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `guard_${Date.now()}`,
      name: { default: 'Guarded' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'confirmed',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(method);

    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
      paymentMethodId: method.id,
      paymentMethodSnapshot: { code: method.code, name: 'Guarded', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);

    const payment = em.create(Payment, {
      orderId: order.id,
      paymentMethodId: method.id,
      amount: '12.30',
      currency: 'PLN',
    });
    await em.persistAndFlush(payment);

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/payment-methods/${method.id}`,
      ...admin,
    });
    expect(res.statusCode).toBe(409);
  });

  it('allows delete when no Payment references the method (204)', async () => {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `free_${Date.now()}`,
      name: { default: 'Free' },
      kind: 'pickup',
      adapter: 'pickup',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'confirmed',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(method);

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/payment-methods/${method.id}`,
      ...admin,
    });
    expect(res.statusCode).toBe(204);
  });
});
