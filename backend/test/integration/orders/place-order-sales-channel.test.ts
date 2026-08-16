import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { EventBus } from '../../../src/events/bus.js';
import {
  OrderService,
  type OrderEventBus,
} from '../../../src/modules/orders/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../src/modules/payment_methods/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../src/modules/payments/adapters/built-in-adapters.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Issue #85 / D-48 — an order records the channel it was placed through.
 *
 * `placeOrder` used to stamp `salesChannelId: channel?.id ?? randomUUID()`,
 * over a fallback that read `findOne(SalesChannel, { status: 'active' })` — an
 * arbitrary active row, ordered by nothing, from the legacy `status` column
 * rather than from the `system_default` flag. So an order placed without an
 * explicit channel recorded whichever row Postgres happened to return, and an
 * order placed against an empty registry recorded a UUID addressing nothing,
 * in a column `orders`, `invoices` and the analytics reads all join on.
 *
 * The second case is the discriminating one: it moves the flag with the D-51
 * Command and re-places. The arbitrary-row fallback keeps answering with the
 * old channel; the flag lookup follows the operator.
 */
describe('placeOrder — the recorded sales channel (issue #85)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await restoreDefaultChannel();
    await teardownBackendServer(h);
  });

  /** Demote whatever holds the flag, then give it back to `default` — in that order. */
  async function restoreDefaultChannel(): Promise<void> {
    const conn = h.em().getConnection();
    await conn.execute(
      `update "sales_channels" set "system_default" = false ` +
        `where "system_default" = true and "code" <> 'default'`,
      [],
      'run',
    );
    await conn.execute(
      `update "sales_channels" set "system_default" = true where "code" = 'default'`,
      [],
      'run',
    );
    await h.salesChannels.cache.invalidateAll();
  }

  function buildService(): OrderService {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    return new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      paymentAdapters: registry,
      orderStatusRegistry: new EnumOrderStatusRegistry(),
    });
  }

  async function placeWithoutChannel(): Promise<string> {
    await seedCartForStubCustomer(h.em());
    const order = await buildService().placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    );
    return order.salesChannelId;
  }

  it('records the system-default channel when the request names none', async () => {
    const recorded = await placeWithoutChannel();

    const systemDefault = await h.em().findOne(SalesChannel, { systemDefault: true });
    expect(systemDefault).not.toBeNull();
    expect(recorded).toBe(systemDefault!.id);

    // And it addresses a real row — the `randomUUID()` this replaces did not.
    expect(await h.em().findOne(SalesChannel, { id: recorded })).not.toBeNull();
  });

  it('follows the flag when an operator moves it', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code: 'order-channel-b',
        name: { 'en-US': 'Order channel B' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const newDefaultId = (created.json() as { id: string }).id;

    const moved = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels/order-channel-b/set-default',
      cookies: adminCookie,
      payload: {},
    });
    expect(moved.statusCode).toBe(200);

    try {
      expect(await placeWithoutChannel()).toBe(newDefaultId);
    } finally {
      await restoreDefaultChannel();
    }
  });
});
