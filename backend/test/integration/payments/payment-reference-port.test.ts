import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PaymentReferenceService } from '../../../src/modules/payments/services/payment-reference-port.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';

const ADDRESS = {
  recipientName: 'A',
  street: 'S',
  city: 'C',
  postalCode: '00-000',
  country: 'PL',
};

/**
 * The write side of `findByExternalReference` (feature 075, Phase P).
 *
 * The four payment gateways each stamp the provider's own identifier on the
 * attempt they have just opened, and they do it in two different ways — TPay
 * and PayU replace, Stripe keeps a reference already on the row. Both are
 * published, so both are pinned here: the point of the port is that the
 * divergence is now visible in one file instead of implicit in four.
 */
async function seedPayment(em: EntityManager): Promise<Payment> {
  const method = em.create(PaymentMethod, {
    code: `ref_${randomUUID().slice(0, 8)}`,
    name: { default: 'Ref' },
    kind: 'gateway',
    adapter: 'bank_transfer',
    status: 'active',
    statusOnPending: 'new',
    statusOnSuccess: 'completed',
    statusOnFailure: 'cancelled',
  });
  await em.persistAndFlush(method);

  const order = em.create(Order, {
    organizationId: randomUUID(),
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: randomUUID(),
    deliveryAddress: ADDRESS,
    billingAddress: ADDRESS,
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
    paymentMethodId: method.id,
    paymentMethodSnapshot: {
      code: method.code,
      name: 'Ref',
      kind: 'gateway',
      adapter: method.adapter,
    },
    subtotal: '100.00',
    taxTotal: '23.00',
    deliveryTotal: '0.00',
    total: '123.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);

  const payment = em.create(Payment, {
    orderId: order.id,
    paymentMethodId: method.id,
    amount: '123.00',
    currency: 'PLN',
  });
  await em.persistAndFlush(payment);
  return payment;
}

describe('PaymentReferenceService', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('stamps the provider reference on an attempt that has none', async () => {
    const payment = await seedPayment(h.em());
    const service = new PaymentReferenceService(h.em);

    expect(await service.stampExternalReference(payment.id, 'pi_first')).toBe(true);

    const reloaded = await h.em().findOne(Payment, { id: payment.id });
    expect(reloaded?.externalReference).toBe('pi_first');
  });

  it('replaces an existing reference — a new provider object supersedes the old one', async () => {
    const payment = await seedPayment(h.em());
    const service = new PaymentReferenceService(h.em);

    await service.stampExternalReference(payment.id, 'pi_first');
    expect(await service.stampExternalReference(payment.id, 'pi_second')).toBe(true);

    const reloaded = await h.em().findOne(Payment, { id: payment.id });
    expect(reloaded?.externalReference).toBe('pi_second');
  });

  it('keeps an existing reference under the if-absent spelling', async () => {
    const payment = await seedPayment(h.em());
    const service = new PaymentReferenceService(h.em);

    expect(await service.stampExternalReferenceIfAbsent(payment.id, 'cs_first')).toBe(true);
    expect(await service.stampExternalReferenceIfAbsent(payment.id, 'pi_second')).toBe(false);

    const reloaded = await h.em().findOne(Payment, { id: payment.id });
    expect(reloaded?.externalReference).toBe('cs_first');
  });

  it('reports no change for an attempt that does not exist', async () => {
    const service = new PaymentReferenceService(h.em);
    expect(await service.stampExternalReference(randomUUID(), 'pi_x')).toBe(false);
    expect(await service.stampExternalReferenceIfAbsent(randomUUID(), 'pi_x')).toBe(false);
    expect(await service.mergeProviderDetails(randomUUID(), { a: 1 })).toBe(false);
  });

  it('merges provider details rather than replacing them', async () => {
    // TPay's one-click marker has to survive from the pay call to the
    // settlement notification, and the settlement path writes the same column.
    const payment = await seedPayment(h.em());
    const service = new PaymentReferenceService(h.em);

    expect(await service.mergeProviderDetails(payment.id, { source: 'tpay' })).toBe(true);
    expect(await service.mergeProviderDetails(payment.id, { alias: 'A1' })).toBe(true);

    const reloaded = await h.em().findOne(Payment, { id: payment.id });
    expect(reloaded?.providerDetails).toEqual({ source: 'tpay', alias: 'A1' });
  });
});
