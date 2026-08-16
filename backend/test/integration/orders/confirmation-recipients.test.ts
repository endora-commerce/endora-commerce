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
import { OrderConfirmationService } from '../../../src/modules/orders/services/order-confirmation-service.js';

describe('OrderConfirmationService.resolveAdditional (unit)', () => {
  it('merges org + scope recipients, dedupes, and drops invalid entries', async () => {
    const svc = new OrderConfirmationService(
      { getConfirmationEmails: async () => ['ops@acme.example', 'not-an-email', 'DUP@acme.example'] },
      async () => ['sales@platform.example', 'dup@acme.example', ''],
    );
    const out = await svc.resolveAdditional('org-1', 'channel-1');
    expect(out).toEqual(['ops@acme.example', 'DUP@acme.example', 'sales@platform.example']);
  });

  it('never throws when the org port fails', async () => {
    const svc = new OrderConfirmationService(
      { getConfirmationEmails: async () => { throw new Error('db down'); } },
      async () => ['sales@platform.example'],
    );
    await expect(svc.resolveAdditional('org-1', 'channel-1')).resolves.toEqual(['sales@platform.example']);
  });
});

describe('placeOrder — confirmation CC to additional recipients (US4)', () => {
  let h: BackendServerHandle;
  const mailer = new InMemoryMailer();

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('sends the confirmation to the customer plus org + scope recipients', async () => {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');

    const service = new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      // Issue #124 — a rig states its own tax authority. `OrderService` has no
      // fallback rate, so an order it cannot price is refused rather than taxed
      // at a figure nobody configured.
      resolveTaxRate: async () => 0.23,
      paymentAdapters: registry,
      orderStatusRegistry: new EnumOrderStatusRegistry(),
      mailer,
      confirmationRecipients: async () => ['ops@acme.example', 'sales@platform.example'],
    });

    await service.placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    );

    const tos = mailer.sent.map((m) => m.to);
    expect(tos).toContain('ops@acme.example');
    expect(tos).toContain('sales@platform.example');
    // Customer + 2 additional recipients.
    expect(mailer.sent.length).toBeGreaterThanOrEqual(3);
  });
});
