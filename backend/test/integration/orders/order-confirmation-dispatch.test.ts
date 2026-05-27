import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { EventBus } from '../../../src/events/bus.js';
import { InMemoryMailer } from '../../../src/modules/email/services/mailer.js';
import { OrderService, type OrderEventBus } from '../../../src/modules/orders/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../src/modules/payment_methods/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../src/modules/payments/adapters/built-in-adapters.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';

/**
 * Order-confirmation e-mail is dispatched after a successful checkout, with the
 * required sections (products, delivery, payment + surcharge, total, addresses).
 */
describe('placeOrder — order-confirmation e-mail dispatch', () => {
  let h: BackendServerHandle;
  const mailer = new InMemoryMailer();

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
    // Give the seed method a surcharge so the payment line shows it.
    const em = h.em();
    const method = await em.findOne(PaymentMethod, { id: SEED_PAYMENT_METHOD_ID });
    method!.additionalPrice = '5.00';
    await em.persistAndFlush(method!);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('sends a confirmation e-mail to the customer with all sections', async () => {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a);

    const service = new OrderService(
      h.em,
      new EventBus() as OrderEventBus,
      undefined,
      undefined,
      undefined,
      { paymentAdapters: registry, orderStatusRegistry: new EnumOrderStatusRegistry(), mailer },
    );

    await service.placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    );

    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail.subject).toContain('Order confirmation');
    expect(mail.meta?.kind).toBe('order_confirmation');
    expect(mail.text).toContain('Products:');
    expect(mail.text).toContain('Delivery method:');
    expect(mail.text).toContain('Payment method:');
    expect(mail.text).toContain('+5.00 PLN'); // surcharge surfaced
    expect(mail.text).toContain('Total:');
    expect(mail.text).toContain('Shipping address:');
    expect(mail.text).toContain('Billing address:');
  });
});
