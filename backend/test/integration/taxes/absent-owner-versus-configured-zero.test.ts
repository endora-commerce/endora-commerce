import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  seedCartForStubCustomer,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Tax } from '../../../src/modules/taxes/entities/tax.entity.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * Issue #124 — the distinction the whole fix turns on.
 *
 * A **configured** 0% rate is a legitimate answer in some jurisdictions, so an
 * order carrying it is priced and placed like any other. An **absent** `taxes`
 * module is not an answer at all, so the same order is refused — with the 503
 * `MODULE_DISABLED` envelope the rest of the platform already uses, not with a
 * figure nobody configured.
 *
 * `{ rate: 0, source: 'none' }` collapsed those two into one value, which is how
 * an order came to be taxed at 0% on nobody's authority and the number reached
 * an invoice.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';

describe('taxes — a configured zero prices, an absent owner refuses [integration]', () => {
  let h: BackendServerHandle;

  const placeOrder = async (): Promise<{ statusCode: number; body: unknown }> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      cookies: CUSTOMER,
    });
    return { statusCode: res.statusCode, body: res.json() };
  };

  const seedZeroRatedDefault = async (): Promise<void> => {
    const em = h.em();
    em.create(Tax, {
      code: 'zero_rated',
      name: 'Zero-rated supply',
      rate: '0.0000',
      isDefault: true,
    });
    await em.flush();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  beforeEach(async () => {
    const em = h.em();
    await em.getConnection().execute('truncate table taxes cascade');
    await em.getConnection().execute('truncate table order_items, orders cascade');
    await em.getConnection().execute('truncate table cart_items, carts cascade');
    em.clear();
    await seedCartForStubCustomer(em);
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('prices an order at a configured 0% rate', async () => {
    await seedZeroRatedDefault();

    const { statusCode, body } = await placeOrder();
    expect(statusCode).toBe(201);
    const order = (body as { data: { subtotal: number; taxTotal: number; total: number } }).data;
    expect(order.taxTotal).toBe(0);
    expect(order.total).toBeCloseTo(order.subtotal, 2);
  });

  it('refuses to place an order while `taxes` is absent', async () => {
    await seedZeroRatedDefault();
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['taxes'] });

    const { statusCode, body } = await placeOrder();
    expect(statusCode).toBe(503);
    expect((body as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
  });

  it('previews an order at the configured rate rather than a flat 23%', async () => {
    const em = h.em();
    em.create(Tax, {
      code: 'reduced',
      name: 'Reduced 8%',
      rate: '0.0800',
      isDefault: true,
    });
    await em.flush();

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: SALES_CHANNEL_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const summary = (res.json() as { data: { summary: { subtotal: number; taxTotal: number } } })
      .data.summary;
    expect(summary.taxTotal).toBeCloseTo(Math.round(summary.subtotal * 0.08 * 100) / 100, 2);
  });

  it('refuses the admin order preview while `taxes` is absent', async () => {
    await seedZeroRatedDefault();
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['taxes'] });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: SALES_CHANNEL_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }],
      },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
  });
});
