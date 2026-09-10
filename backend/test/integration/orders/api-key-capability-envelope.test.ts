import { Cart, CartItem } from '../../helpers/package-entities.js';
import { Organization } from '../../helpers/package-entities.js';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

import {
  seedSuspendedOrganization,
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  TEST_SUSPENDED_CUSTOMER_ID,
  TEST_SUSPENDED_ORGANIZATION_ID,
} from '../../helpers/seed-commerce.js';

import {
  seedCreditLimitRaceFixture,
  SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
} from '../../helpers/seed-credit-limit.js';

import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

import { SalesChannel } from '@endora-commerce/platform/kernel';


import { DeliveryMethod } from '../../helpers/package-entities.js';


/**
 * Feature 062 / T022 — FR-021 / SC-009 capability envelope, verified by
 * REUSING the existing fixtures (no parallel ones):
 *  - suspended-org fixture (`seedSuspendedOrganization` + the
 *    `stub-customer-session-suspended` stub) ⇒ a bound key of that org gets
 *    the SAME 423 the org's own buyer gets;
 *  - org-restriction allow-lists (`h.organizations.restrictionService`, the
 *    feature-026 fixture service) ⇒ a method outside the allow-list is
 *    refused with the customer flow's method-unavailable error;
 *  - credit-limit fixture (`seedCreditLimitRaceFixture`) ⇒ an over-limit key
 *    order gets the same 409 LIMIT_INSUFFICIENT the buyer gets.
 *
 * The minimum-order-value gate needs no bespoke proof: it lives inside the
 * shared `OrderService.placeOrder` (see admin-create.test.ts FR-035), which
 * this surface delegates to without any bypass parameter.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('external order intake — org capability envelope (062 / T022)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let orgAToken: string;
  let suspendedToken: string;
  let altDeliveryMethodId: string;

  const keyPayload = (overrides: Record<string, unknown> = {}) => ({
    lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 1 }],
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
    ...overrides,
  });

  const postKey = (token: string, payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      payload,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `env-${randomUUID()}`,
      },
    });

  const mint = async (payload: Record<string, unknown>): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedSuspendedOrganization(h.em());
    await seedCreditLimitRaceFixture(h.em());

    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: 'ext-envelope',
      name: { 'en-US': 'Envelope channel' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    await em.persistAndFlush(channel);
    channelId = channel.id;
    await h.salesChannels.cache.invalidate('ext-envelope');
    await em.getConnection().execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`,
      [channelId, SEED_PRODUCT_101_ID],
    );

    // A second delivery method so the delivery allow-list can exclude the
    // seeded one while still referencing a real row.
    const altDelivery = em.create(DeliveryMethod, {
      code: 'alt-courier-062',
      name: { 'en-US': 'Alt courier' },
      cost: '9.99',
      currency: 'PLN',
      adapter: 'personal_pickup',
    });
    await em.persistAndFlush(altDelivery);
    altDeliveryMethodId = altDelivery.id;

    orgAToken = await mint({
      name: 'Envelope key A',
      scopes: ['orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: channelId,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    suspendedToken = await mint({
      name: 'Envelope suspended key',
      scopes: ['orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_SUSPENDED_ORGANIZATION_ID,
        salesChannelId: channelId,
        customerAccountId: TEST_SUSPENDED_CUSTOMER_ID,
      },
    });
  });

  afterAll(async () => {
    // Clear restrictions on TEST_ORGANIZATION so other suites start fresh
    // (same cleanup the feature-026 checkout-preflight suite performs).
    try {
      const fresh = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
      await h.organizations.restrictionService.replaceAllowLists(TEST_ORGANIZATION_ID, {
        expectedVersion: fresh.version,
        paymentMethodIds: [],
        deliveryMethodIds: [],
        warehouseIds: [],
      });
    } catch {
      // best-effort cleanup
    }
    await teardownBackendServer(h);
  });

  it('suspended org: key caller gets the SAME 423 the org buyer gets (fixture reused)', async () => {
    // Customer flow — the existing stub-customer-session-suspended fixture.
    const customerRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      cookies: { b2b_session: 'stub-customer-session-suspended' },
    });
    expect(customerRes.statusCode).toBe(423);
    const customerCode = (customerRes.json() as { error: { code: string } }).error.code;

    // Key flow — bound key of the same suspended org.
    const keyRes = await postKey(
      suspendedToken,
      keyPayload({
        deliveryAddressId: undefined,
        billingAddressId: undefined,
        deliveryAddress: {
          recipientName: 'Suspended Co',
          street: 'ul. Wstrzymanych 1',
          city: 'Warszawa',
          postalCode: '00-700',
          country: 'PL',
        },
        billingAddress: {
          recipientName: 'Suspended Co',
          street: 'ul. Wstrzymanych 1',
          city: 'Warszawa',
          postalCode: '00-700',
          country: 'PL',
        },
      }),
    );
    expect(keyRes.statusCode).toBe(423);
    const keyCode = (keyRes.json() as { error: { code: string } }).error.code;

    // Identical domain error — the org envelope caps the key (SC-009). The
    // parity assertion is the one that carries the requirement; the literal
    // below just records which code the pair settled on. Since feature 072 T141
    // both paths resolve the same `organizationReadPort` from the container, so
    // parity is structural rather than two root arguments that agreed.
    //
    // The second of the two assertions issue #63 is about: it pinned
    // `ORGANIZATION_SUSPENDED` until 633538a9 (072 T141), and passed only
    // because the harness had never wired the route gate that both surfaces run
    // in production. `ORGANIZATION_SUSPENDED` is still real — it is what
    // `OrderService`'s service seam answers to a caller that passed no route
    // gate, which is one-click buy, covered by
    // `test/contract/quick_order/one-click-place.test.ts`.
    expect(keyCode).toBe(customerCode);
    expect(keyCode).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('credit limit exceeded: key caller gets the same 409 LIMIT_INSUFFICIENT as the buyer (fixture reused)', async () => {
    // Key flow — 80 × 19.99 = 1599.20 > the fixture's 1500.00 grant.
    const keyRes = await postKey(
      orgAToken,
      keyPayload({
        lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 80 }],
        paymentMethodId: SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
      }),
    );
    expect(keyRes.statusCode).toBe(409);
    expect((keyRes.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.LIMIT_INSUFFICIENT,
    );

    // Customer flow — same fixture, same over-limit total, same error. The
    // fixture's customer A cart is bumped to the same 80-unit quantity.
    const em = h.em();
    const cart = await em.findOne(Cart, {
      customerAccountId: '00000000-0000-4000-8000-0000000000a5',
      status: 'active',
    });
    expect(cart).not.toBeNull();
    const item = await em.findOne(CartItem, { cartId: cart!.id });
    item!.quantity = 80;
    await em.persistAndFlush(item!);

    const customerRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
      },
      cookies: { b2b_session: 'stub-customer-session-cl-a' },
    });
    expect(customerRes.statusCode).toBe(409);
    expect((customerRes.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.LIMIT_INSUFFICIENT,
    );
  });

  it('payment method outside the org allow-list is refused like the customer flow (fixture reused)', async () => {
    // Reuse the feature-026 restriction fixture service: only the credit-limit
    // method is allowed for org A.
    h.em().clear();
    const fresh = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    await h.organizations.restrictionService.replaceAllowLists(TEST_ORGANIZATION_ID, {
      expectedVersion: fresh.version,
      paymentMethodIds: [SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID],
      deliveryMethodIds: [],
      warehouseIds: [],
    });

    // Customer surface: the disallowed method is not offered at all (the
    // feature-026 behavior pinned by checkout-preflight.test.ts).
    const listing = await h.app.inject({
      method: 'GET',
      url: '/api/v1/payment-methods',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(listing.statusCode).toBe(200);
    const offered = (listing.json() as { data: Array<{ id: string }> }).data.map((m) => m.id);
    expect(offered).not.toContain(SEED_PAYMENT_METHOD_ID);

    // Key surface: submitting the disallowed method is refused with the
    // customer flow's method-unavailable error (same code + message as the
    // placeOrder usability guard).
    const keyRes = await postKey(orgAToken, keyPayload());
    expect(keyRes.statusCode).toBe(400);
    const err = (keyRes.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.message).toBe('The selected payment method is not available for this order.');
  });

  it('delivery method outside the org allow-list is refused identically', async () => {
    h.em().clear();
    const fresh = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    await h.organizations.restrictionService.replaceAllowLists(TEST_ORGANIZATION_ID, {
      expectedVersion: fresh.version,
      paymentMethodIds: [],
      deliveryMethodIds: [altDeliveryMethodId],
      warehouseIds: [],
    });

    const keyRes = await postKey(orgAToken, keyPayload());
    expect(keyRes.statusCode).toBe(400);
    const err = (keyRes.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.message).toBe('The selected shipping method is not available for this order.');
  });
});
