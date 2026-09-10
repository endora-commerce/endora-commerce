import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  TEST_SUSPENDED_CUSTOMER_ID,
  TEST_SUSPENDED_ORGANIZATION_ID,
  seedSuspendedOrganization,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Address } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Order, OrderItem } from '../../helpers/package-entities.js';

/**
 * Issue #64 — one-click buy places an order, and refuses a suspended
 * Organization.
 *
 * The existing `one-click.test.ts` covers eligibility only, so no test in the
 * tree had ever *placed* an order this way. That is the gap issue #99 fell
 * through: `OneClickService` carried `salesChannelId: string = 'default'`, a
 * constructor argument no root passed, so every deployment read the setting
 * against a channel code, tripped the settings seam guard and reported
 * `setting_disabled` — one-click buy was off everywhere, and the eligibility
 * cases passed throughout because both expected "not enabled".
 *
 * So the enabled path is asserted here explicitly rather than assumed: the
 * setting is written **for the channel the request resolves to**, by code,
 * through the admin write seam, and eligibility is checked before the
 * placement. A test that only asserted "422" or only asserted "201" would sit
 * on the same blind spot from the other side.
 *
 * The second half is the guard feature 072 T141 recorded as uncovered.
 * `POST /api/v1/orders` refuses a suspended Organization at its route gate with
 * `FORBIDDEN` + `organization_cannot_transact`; one-click buy has **no route
 * gate**, so the only thing between a blocked Organization and an order placed
 * here is `OrderService.placeOrder`'s own service-seam check — which answers
 * with the other code, `ORGANIZATION_SUSPENDED`. Both are production behaviour;
 * which one a caller sees is decided by whether it passed a route gate.
 */

const ONE_CLICK_ENABLED = 'quick_order.one_click_buy_enabled';
const COOKIE = { b2b_session: 'stub-customer-session' };
const SUSPENDED_COOKIE = { b2b_session: 'stub-customer-session-suspended' };
const SUSPENDED_DELIVERY_ADDRESS_ID = '00000000-0000-4000-8000-0000000000db';
const SUSPENDED_BILLING_ADDRESS_ID = '00000000-0000-4000-8000-0000000000dc';

describe('POST /api/v1/quick-order/one-click — placement', () => {
  let h: BackendServerHandle;
  let defaultChannelCode: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await seedSuspendedOrganization(em);

    // The blocked Organization needs addresses of its own, or the resolver
    // drops them as ineligible and the request never reaches the guard.
    em.create(Address, {
      id: SUSPENDED_DELIVERY_ADDRESS_ID,
      organizationId: TEST_SUSPENDED_ORGANIZATION_ID,
      kind: 'delivery',
      recipientName: 'Suspended Customer',
      street: 'ul. Wstrzymanych 1',
      city: 'Warszawa',
      postalCode: '00-700',
      country: 'PL',
      isDefault: true,
    });
    em.create(Address, {
      id: SUSPENDED_BILLING_ADDRESS_ID,
      organizationId: TEST_SUSPENDED_ORGANIZATION_ID,
      kind: 'billing',
      recipientName: 'Suspended Customer',
      street: 'ul. Wstrzymanych 1',
      city: 'Warszawa',
      postalCode: '00-700',
      country: 'PL',
      isDefault: true,
    });
    await em.flush();

    // The one channel a header-less storefront request resolves to (D-47).
    defaultChannelCode = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).code;
    await setOneClickEnabledForDefaultChannel(true);

    await putPreferences(COOKIE, TEST_CUSTOMER_ID, {
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      billingAddressId: SEED_ADDRESS_BILLING_ID,
      shippingAddressId: SEED_ADDRESS_DELIVERY_ID,
    });
    await putPreferences(SUSPENDED_COOKIE, TEST_SUSPENDED_CUSTOMER_ID, {
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      billingAddressId: SUSPENDED_BILLING_ADDRESS_ID,
      shippingAddressId: SUSPENDED_DELIVERY_ADDRESS_ID,
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * The operator's own write path — a per-channel override on the channel the
   * request resolves to, not a hand-poked `global_value`. It is the read this
   * placement makes that has to be exercised, and reading a value the harness
   * wrote through a different door proves nothing about it.
   */
  async function setOneClickEnabledForDefaultChannel(value: boolean): Promise<void> {
    await h.settings.adminService.setValueForSubset(
      ONE_CLICK_ENABLED,
      [defaultChannelCode],
      value,
      null,
      { actorAdminUserId: null },
    );
    await h.settings.cache.invalidate(ONE_CLICK_ENABLED);
  }

  async function putPreferences(
    cookies: Record<string, string>,
    customerAccountId: string,
    defaults: {
      paymentMethodId: string;
      deliveryMethodId: string;
      billingAddressId: string;
      shippingAddressId: string;
    },
  ): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies,
      payload: {
        scope: 'customer',
        scopeId: customerAccountId,
        defaultPaymentMethodId: defaults.paymentMethodId,
        defaultDeliveryMethodId: defaults.deliveryMethodId,
        defaultBillingAddressId: defaults.billingAddressId,
        defaultShippingAddressId: defaults.shippingAddressId,
      },
    });
    expect(res.statusCode).toBe(200);
  }

  it('reports the buyer eligible once the channel value and the four defaults are set', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/one-click/eligibility',
      cookies: COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { enabled: boolean; reason: string | null } }).data;
    // Stated as the pair, because `setting_disabled` is what issue #99 shipped
    // to every deployment and it is indistinguishable from an operator switch.
    expect(data).toEqual({ enabled: true, reason: null });
  });

  it('places a real order from the buyer defaults', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      cookies: COOKIE,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { order: { id: string; businessId: string; total: number; currency: string } };
    };
    expect(body.data.order.total).toBeGreaterThan(0);

    // The order exists, belongs to the buyer, and carries the line the request
    // named — a 201 alone would not distinguish a placement from an echo.
    const em = h.em();
    const order = await em.findOneOrFail(Order, { id: body.data.order.id });
    expect(order.placedByCustomerAccountId).toBe(TEST_CUSTOMER_ID);
    expect(order.salesChannelId).toBe(
      (await em.findOneOrFail(SalesChannel, { systemDefault: true })).id,
    );
    const items = await em.find(OrderItem, { orderId: order.id });
    expect(items.map((i) => [i.productId, i.quantity])).toEqual([[SEED_PRODUCT_101_ID, 2]]);
  });

  it('refuses a blocked Organization at the service-seam guard', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      cookies: SUSPENDED_COOKIE,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
    expect(res.statusCode).toBe(423);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ORGANIZATION_SUSPENDED,
    );

    // Nothing was placed for the blocked Organization.
    const orders = await h.em().find(Order, { organizationId: TEST_SUSPENDED_ORGANIZATION_ID });
    expect(orders).toEqual([]);
  });

  it('stops placing once the operator switches the channel value back off', async () => {
    await setOneClickEnabledForDefaultChannel(false);
    try {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/one-click',
        cookies: COOKIE,
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json() as { error: { details?: { code?: string; reason?: string } } };
      expect(body.error.details?.code).toBe('one_click_unavailable');
      expect(body.error.details?.reason).toBe('setting_disabled');
    } finally {
      await setOneClickEnabledForDefaultChannel(true);
    }
  });
});
