import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { hashPassword, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  seedCartForStubCustomer,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  seedOtherTestOrganization,
  STUB_CUSTOMER_PASSWORD,
} from '../../helpers/seed-organizations.js';
import {
  OTHER_TEST_ORGANIZATION_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import {
  Address,
  Cart,
  CartItem,
  CustomerAccount,
  DeliveryMethod,
  Order,
  Organization,
  Payment,
  PaymentMethod,
  StockAllocation,
} from '../../helpers/package-entities.js';

/**
 * An Organization's payment- and delivery-method allow-lists bind order
 * placement, not only the two storefront listings.
 *
 * Organization A is restricted to the two seeded methods. Two further methods
 * are active and usable — Organization B, which has no restriction, places an
 * order with them below, which is what proves a refusal for A is the
 * allow-list's and nothing else's. Every surface that places or previews an
 * order for A is then handed the excluded methods and must refuse, writing
 * nothing and leaving the buyer's basket exactly as it was.
 *
 * Then the two Organizations are restricted differently, on every surface, so
 * that reading the wrong Organization's lists cannot pass; and the read itself
 * is made to answer `null` and to fail.
 *
 * Surfaces: storefront checkout (`POST /api/v1/orders`), its preview
 * (`POST /api/v1/orders/preview-total`), admin create and its preview
 * (`POST /api/v1/admin/orders`, `…/preview`), the API-key intake
 * (`POST /api/v1/external/orders`) and one-click buy
 * (`POST /api/v1/quick-order/one-click`).
 */

const BUYER_A = { b2b_session: 'stub-customer-session' };
const BUYER_B = { b2b_session: 'stub-customer-session-other-org' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const BUYER_B_ID = '00000000-0000-4000-8000-0000000000a7';
const ORG_B_DELIVERY_ADDRESS_ID = '00000000-0000-4000-8000-000000a110d1';
const ORG_B_BILLING_ADDRESS_ID = '00000000-0000-4000-8000-000000a110d2';
const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const ONE_CLICK_ENABLED = 'quick_order.one_click_buy_enabled';

const DELIVERY_REFUSAL = 'delivery_method_not_allowed_for_organization';
const PAYMENT_REFUSAL = 'payment_method_not_allowed_for_organization';

interface ErrorBody {
  error: { code: string; message: string; details?: { code?: string; reason?: string } };
}

describe('order placement honours the Organization method allow-lists', () => {
  let h: BackendServerHandle;
  /** Active, usable, and on nobody's allow-list. */
  let excludedDeliveryId: string;
  let excludedPaymentId: string;
  let apiKeyToken: string;
  /** A key bound to Organization B, with buyer B as its service account. */
  let apiKeyTokenB: string;
  let defaultChannelCode: string;

  const restrict = async (
    organizationId: string,
    lists: { paymentMethodIds: string[]; deliveryMethodIds: string[] },
  ): Promise<void> => {
    const em = h.em();
    em.clear();
    const organization = await em.findOneOrFail(Organization, { id: organizationId });
    await h.organizations.restrictionService.replaceAllowLists(organizationId, {
      expectedVersion: organization.version,
      paymentMethodIds: lists.paymentMethodIds,
      deliveryMethodIds: lists.deliveryMethodIds,
      warehouseIds: [],
    });
  };

  /** Everything a placement writes, counted, plus the buyer's basket row by row. */
  const snapshot = async (customerAccountId: string) => {
    const em = h.em();
    em.clear();
    const cart = await em.findOne(Cart, { customerAccountId, status: 'active' });
    const items = cart ? await em.find(CartItem, { cartId: cart.id }) : [];
    const reserved = await em
      .getConnection()
      .execute<Array<{ reserved: string }>>(
        'select coalesce(sum(reserved), 0)::text as reserved from stock_levels',
      );
    return {
      basket: {
        cartId: cart?.id ?? null,
        items: items
          .map((item) => ({
            id: item.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: String(item.unitPrice),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      },
      orders: await em.count(Order, {}, { filters: false }),
      payments: await em.count(Payment, {}, { filters: false }),
      stockAllocations: await em.count(StockAllocation, {}, { filters: false }),
      reserved: reserved[0]?.reserved,
    };
  };

  /** A basket of two units for buyer A, replacing whatever a previous case left. */
  const giveBuyerABasket = async (): Promise<void> => {
    const em = h.em();
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    await seedCartForStubCustomer(em);
  };

  const expectRefusal = (
    res: { statusCode: number; body: string; json: () => unknown },
    detailsCode: string,
  ): void => {
    expect(res.statusCode, res.body).toBe(400);
    const { error } = res.json() as ErrorBody;
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details?.code).toBe(detailsCode);
  };

  const storefrontPayload = (overrides: Record<string, unknown> = {}) => ({
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    ...overrides,
  });

  const adminPayload = (overrides: Record<string, unknown> = {}) => ({
    customerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: SALES_CHANNEL_ID,
    // One unit, where the buyer's own basket holds two: a create that reaches
    // the basket before it is refused leaves this line behind instead.
    items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
    ...overrides,
  });

  const postIntake = (overrides: Record<string, unknown> = {}, token: string = apiKeyToken) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      payload: {
        lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 1 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        ...overrides,
      },
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `allow-list-${randomUUID()}`,
      },
    });

  /** The same requests, for Organization B: its buyer, its addresses. */
  const storefrontPayloadB = (overrides: Record<string, unknown> = {}) =>
    storefrontPayload({
      deliveryAddressId: ORG_B_DELIVERY_ADDRESS_ID,
      billingAddressId: ORG_B_BILLING_ADDRESS_ID,
      ...overrides,
    });
  const adminPayloadB = (overrides: Record<string, unknown> = {}) =>
    adminPayload({
      customerAccountId: BUYER_B_ID,
      deliveryAddressId: ORG_B_DELIVERY_ADDRESS_ID,
      billingAddressId: ORG_B_BILLING_ADDRESS_ID,
      ...overrides,
    });

  const giveBuyerBBasket = async (): Promise<void> => {
    const em = h.em();
    await em.nativeDelete(Cart, { customerAccountId: BUYER_B_ID, status: 'active' });
    const cart = em.create(Cart, {
      customerAccountId: BUYER_B_ID,
      organizationId: OTHER_TEST_ORGANIZATION_ID,
      status: 'active',
    });
    await em.persistAndFlush(cart);
    await em.persistAndFlush(
      em.create(CartItem, {
        cartId: cart.id,
        productId: SEED_PRODUCT_101_ID,
        quantity: 2,
        unitPrice: '19.99',
        currency: 'PLN',
      }),
    );
  };

  const place = (cookies: Record<string, string>, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/v1/orders', cookies, payload });
  const adminCreate = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/v1/admin/orders', cookies: ADMIN, payload });
  const adminPreview = (payload: Record<string, unknown>) => {
    const { deliveryAddressId: _d, billingAddressId: _b, ...rest } = payload;
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: ADMIN,
      payload: rest,
    });
  };
  const storefrontPreview = (
    cookies: Record<string, string>,
    methods: { deliveryMethodId: string; paymentMethodId: string },
    billingAddressId: string = SEED_ADDRESS_BILLING_ID,
  ) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies,
      payload: { ...methods, billingAddressId },
    });
  const oneClickEligibility = () =>
    h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/one-click/eligibility',
      cookies: BUYER_A,
    });
  const oneClickPlace = () =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      cookies: BUYER_A,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });

  /**
   * Replaces what `organizationRestrictionPort.allowedIdsFor` answers for the
   * length of `run`. The harness hands out the registered service itself, so
   * the method is swapped on its prototype and put back afterwards.
   */
  const withAllowListRead = async (
    answer: () => Promise<string[] | null>,
    run: () => Promise<void>,
  ): Promise<void> => {
    const proto = Object.getPrototypeOf(h.organizations.restrictionService) as {
      allowedIdsFor: (...args: unknown[]) => Promise<string[] | null>;
    };
    const original = proto.allowedIdsFor;
    proto.allowedIdsFor = answer;
    try {
      await run();
    } finally {
      proto.allowedIdsFor = original;
    }
  };

  const putOneClickDefaults = async (methods: {
    paymentMethodId: string;
    deliveryMethodId: string;
  }): Promise<void> => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: BUYER_A,
      payload: {
        scope: 'customer',
        scopeId: TEST_CUSTOMER_ID,
        defaultPaymentMethodId: methods.paymentMethodId,
        defaultDeliveryMethodId: methods.deliveryMethodId,
        defaultBillingAddressId: SEED_ADDRESS_BILLING_ID,
        defaultShippingAddressId: SEED_ADDRESS_DELIVERY_ID,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const delivery = em.create(DeliveryMethod, {
      code: 'allow-list-excluded-courier',
      name: { 'en-US': 'Excluded courier' },
      cost: '9.99',
      currency: 'PLN',
      adapter: 'personal_pickup',
    });
    const payment = em.create(PaymentMethod, {
      code: 'allow-list-excluded-transfer',
      name: { 'en-US': 'Excluded transfer' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush([delivery, payment]);
    excludedDeliveryId = delivery.id;
    excludedPaymentId = payment.id;

    // Organization B and its buyer: unrestricted throughout.
    await seedOtherTestOrganization(em);
    em.create(CustomerAccount, {
      id: BUYER_B_ID,
      organizationId: OTHER_TEST_ORGANIZATION_ID,
      email: 'allow-list-buyer-b@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Buyer',
      lastName: 'B',
      role: 'organization_admin',
      emailVerifiedAt: new Date(),
    });
    for (const [id, kind] of [
      [ORG_B_DELIVERY_ADDRESS_ID, 'delivery'],
      [ORG_B_BILLING_ADDRESS_ID, 'billing'],
    ] as const) {
      em.create(Address, {
        id,
        organizationId: OTHER_TEST_ORGANIZATION_ID,
        kind,
        recipientName: 'Buyer B',
        street: 'ul. Inna 1',
        city: 'Warszawa',
        postalCode: '00-901',
        country: 'PL',
        isDefault: true,
      });
    }
    await em.flush();

    // The API-key intake: a channel carrying the product, and a key bound to
    // Organization A with buyer A as its service account.
    const channel = em.create(SalesChannel, {
      code: 'allow-list-intake',
      name: { 'en-US': 'Allow-list intake channel' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    await em.persistAndFlush(channel);
    await h.salesChannels.cache.invalidate('allow-list-intake');
    await em
      .getConnection()
      .execute('insert into sales_channel_products (sales_channel_id, product_id) values (?,?)', [
        channel.id,
        SEED_PRODUCT_101_ID,
      ]);
    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: 'Allow-list key A',
        scopes: ['orders:read', 'orders:write'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: channel.id,
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    apiKeyToken = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
    const mintedB = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: 'Allow-list key B',
        scopes: ['orders:read', 'orders:write'],
        binding: {
          organizationId: OTHER_TEST_ORGANIZATION_ID,
          salesChannelId: channel.id,
          customerAccountId: BUYER_B_ID,
        },
      },
    });
    expect(mintedB.statusCode, mintedB.body).toBe(201);
    apiKeyTokenB = (mintedB.json() as { data: { bearerToken: string } }).data.bearerToken;

    // One-click buy, switched on for the channel a header-less request resolves to.
    defaultChannelCode = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).code;
    await h.settings.adminService.setValueForSubset(
      ONE_CLICK_ENABLED,
      [defaultChannelCode],
      true,
      null,
      { actorAdminUserId: null },
    );
    await h.settings.cache.invalidate(ONE_CLICK_ENABLED);
  });

  beforeEach(async () => {
    await restrict(TEST_ORGANIZATION_ID, {
      paymentMethodIds: [SEED_PAYMENT_METHOD_ID],
      deliveryMethodIds: [SEED_DELIVERY_METHOD_ID],
    });
    await restrict(OTHER_TEST_ORGANIZATION_ID, { paymentMethodIds: [], deliveryMethodIds: [] });
    await giveBuyerABasket();
    await giveBuyerBBasket();
  });

  afterAll(async () => {
    try {
      await restrict(TEST_ORGANIZATION_ID, { paymentMethodIds: [], deliveryMethodIds: [] });
    } catch {
      // best-effort cleanup
    }
    await teardownBackendServer(h);
  });

  it('the listings offer Organization A only the methods on its allow-lists', async () => {
    for (const [kind, excluded, allowed] of [
      ['delivery', excludedDeliveryId, SEED_DELIVERY_METHOD_ID],
      ['payment', excludedPaymentId, SEED_PAYMENT_METHOD_ID],
    ] as const) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/${kind}-methods`,
        cookies: BUYER_A,
      });
      const ids = (res.json() as { data: Array<{ id: string }> }).data.map((m) => m.id);
      expect(ids).toContain(allowed);
      expect(ids).not.toContain(excluded);
    }
  });

  describe('storefront checkout — POST /api/v1/orders', () => {
    it('refuses a delivery method the allow-list excludes and writes nothing', async () => {
      const before = await snapshot(TEST_CUSTOMER_ID);
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER_A,
        payload: storefrontPayload({ deliveryMethodId: excludedDeliveryId }),
      });
      expectRefusal(res, DELIVERY_REFUSAL);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
    });

    it('refuses a payment method the allow-list excludes and writes nothing', async () => {
      const before = await snapshot(TEST_CUSTOMER_ID);
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER_A,
        payload: storefrontPayload({ paymentMethodId: excludedPaymentId }),
      });
      expectRefusal(res, PAYMENT_REFUSAL);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
    });

    it('uses the Organization of the session, whatever the request body names', async () => {
      const before = await snapshot(TEST_CUSTOMER_ID);
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER_A,
        payload: storefrontPayload({
          paymentMethodId: excludedPaymentId,
          // Not a field of the request; an unrestricted Organization named here
          // must not lift buyer A's restriction.
          organizationId: OTHER_TEST_ORGANIZATION_ID,
        }),
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
    });

    it('places the order when both methods are on the allow-lists', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER_A,
        payload: storefrontPayload(),
      });
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  describe('storefront preview — POST /api/v1/orders/preview-total', () => {
    const preview = (methods: { deliveryMethodId: string; paymentMethodId: string }) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/orders/preview-total',
        cookies: BUYER_A,
        payload: { ...methods, billingAddressId: SEED_ADDRESS_BILLING_ID },
      });

    it('refuses the combination the placement would refuse', async () => {
      expectRefusal(
        await preview({
          deliveryMethodId: excludedDeliveryId,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        }),
        DELIVERY_REFUSAL,
      );
      expectRefusal(
        await preview({
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: excludedPaymentId,
        }),
        PAYMENT_REFUSAL,
      );
    });

    it('previews the combination the allow-lists permit', async () => {
      const res = await preview({
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      });
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  describe('admin create — POST /api/v1/admin/orders and its preview', () => {
    it('refuses an excluded delivery method before the customer basket is touched', async () => {
      const before = await snapshot(TEST_CUSTOMER_ID);
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders',
        cookies: ADMIN,
        payload: adminPayload({ deliveryMethodId: excludedDeliveryId }),
      });
      expectRefusal(res, DELIVERY_REFUSAL);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
    });

    it('refuses an excluded payment method before the customer basket is touched', async () => {
      const before = await snapshot(TEST_CUSTOMER_ID);
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders',
        cookies: ADMIN,
        payload: adminPayload({ paymentMethodId: excludedPaymentId }),
      });
      expectRefusal(res, PAYMENT_REFUSAL);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
    });

    it('refuses the same combination on the preview', async () => {
      const preview = (overrides: Record<string, unknown>) =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/orders/preview',
          cookies: ADMIN,
          payload: {
            customerAccountId: TEST_CUSTOMER_ID,
            salesChannelId: SALES_CHANNEL_ID,
            items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
            deliveryMethodId: SEED_DELIVERY_METHOD_ID,
            paymentMethodId: SEED_PAYMENT_METHOD_ID,
            ...overrides,
          },
        });
      expectRefusal(await preview({ deliveryMethodId: excludedDeliveryId }), DELIVERY_REFUSAL);
      expectRefusal(await preview({ paymentMethodId: excludedPaymentId }), PAYMENT_REFUSAL);
      expect((await preview({})).statusCode).toBe(200);
    });

    it('creates the order when both methods are on the allow-lists', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders',
        cookies: ADMIN,
        payload: adminPayload(),
      });
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  describe('API-key intake — POST /api/v1/external/orders', () => {
    it('refuses an excluded delivery method before the service-account basket is touched', async () => {
      const before = await snapshot(TEST_CUSTOMER_ID);
      expectRefusal(await postIntake({ deliveryMethodId: excludedDeliveryId }), DELIVERY_REFUSAL);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
    });

    it('refuses an excluded payment method before the service-account basket is touched', async () => {
      const before = await snapshot(TEST_CUSTOMER_ID);
      expectRefusal(await postIntake({ paymentMethodId: excludedPaymentId }), PAYMENT_REFUSAL);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
    });

    it('places the order when both methods are on the allow-lists', async () => {
      const res = await postIntake();
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  describe('one-click buy — POST /api/v1/quick-order/one-click', () => {
    const eligibility = async () =>
      (
        (
          await h.app.inject({
            method: 'GET',
            url: '/api/v1/quick-order/one-click/eligibility',
            cookies: BUYER_A,
          })
        ).json() as { data: { enabled: boolean; reason: string | null } }
      ).data;

    const oneClick = () =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/one-click',
        cookies: BUYER_A,
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      });

    for (const [label, methods] of [
      ['delivery', () => ({ deliveryMethodId: excludedDeliveryId, paymentMethodId: SEED_PAYMENT_METHOD_ID })],
      ['payment', () => ({ deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: excludedPaymentId })],
    ] as const) {
      it(`does not offer the button, and places nothing, when the default ${label} method is excluded`, async () => {
        await putOneClickDefaults(methods());
        expect(await eligibility()).toEqual({ enabled: false, reason: 'missing_defaults' });

        const before = await snapshot(TEST_CUSTOMER_ID);
        const res = await oneClick();
        expect(res.statusCode, res.body).toBe(422);
        const { error } = res.json() as ErrorBody;
        expect(error.details?.code).toBe('one_click_unavailable');
        expect(error.details?.reason).toBe('missing_defaults');
        expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
      });
    }

    it('places the order when both default methods are on the allow-lists', async () => {
      await putOneClickDefaults({
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      });
      expect(await eligibility()).toEqual({ enabled: true, reason: null });
      const res = await oneClick();
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  describe('an absent or empty allow-list is no restriction', () => {
    it('restricts each kind on its own: an empty delivery list allows every delivery method', async () => {
      await restrict(TEST_ORGANIZATION_ID, {
        paymentMethodIds: [SEED_PAYMENT_METHOD_ID],
        deliveryMethodIds: [],
      });
      const refused = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER_A,
        payload: storefrontPayload({
          deliveryMethodId: excludedDeliveryId,
          paymentMethodId: excludedPaymentId,
        }),
      });
      // The payment list still binds while the delivery list is empty.
      expectRefusal(refused, PAYMENT_REFUSAL);

      const placed = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER_A,
        payload: storefrontPayload({ deliveryMethodId: excludedDeliveryId }),
      });
      expect(placed.statusCode, placed.body).toBe(201);
    });

    it('allows every method once both lists are empty', async () => {
      await restrict(TEST_ORGANIZATION_ID, { paymentMethodIds: [], deliveryMethodIds: [] });
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER_A,
        payload: storefrontPayload({
          deliveryMethodId: excludedDeliveryId,
          paymentMethodId: excludedPaymentId,
        }),
      });
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  /**
   * Which Organization's lists are read. Every case here has the two
   * Organizations restricted differently, so reading the wrong one — on any
   * surface — gives the opposite answer for at least one of them.
   */
  describe('each Organization is judged on its own lists', () => {
    const excluded = () => ({
      deliveryMethodId: excludedDeliveryId,
      paymentMethodId: excludedPaymentId,
    });
    const restrictBToTheOtherPair = () =>
      restrict(OTHER_TEST_ORGANIZATION_ID, {
        paymentMethodIds: [excludedPaymentId],
        deliveryMethodIds: [excludedDeliveryId],
      });

    it('buyers: A restricted, B not — B previews and places what A is refused', async () => {
      const preview = await storefrontPreview(BUYER_B, excluded(), ORG_B_BILLING_ADDRESS_ID);
      expect(preview.statusCode, preview.body).toBe(200);

      const placed = await place(BUYER_B, storefrontPayloadB(excluded()));
      expect(placed.statusCode, placed.body).toBe(201);
      const orderId = (placed.json() as { data: { id: string } }).data.id;
      const order = await h.em().findOneOrFail(Order, { id: orderId }, { filters: false });
      expect(order.organizationId).toBe(OTHER_TEST_ORGANIZATION_ID);

      expectRefusal(await place(BUYER_A, storefrontPayload(excluded())), DELIVERY_REFUSAL);
    });

    it('buyers: B restricted, A not — B is refused under its own list and A is not bound by it', async () => {
      await restrict(TEST_ORGANIZATION_ID, { paymentMethodIds: [], deliveryMethodIds: [] });
      await restrictBToTheOtherPair();

      const before = await snapshot(BUYER_B_ID);
      expectRefusal(await place(BUYER_B, storefrontPayloadB()), DELIVERY_REFUSAL);
      expectRefusal(
        await storefrontPreview(
          BUYER_B,
          { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
          ORG_B_BILLING_ADDRESS_ID,
        ),
        DELIVERY_REFUSAL,
      );
      expect(await snapshot(BUYER_B_ID)).toEqual(before);

      const placedByA = await place(BUYER_A, storefrontPayload());
      expect(placedByA.statusCode, placedByA.body).toBe(201);
    });

    it('buyers: restricted to opposite pairs — each places its own pair and is refused the other', async () => {
      await restrictBToTheOtherPair();

      expectRefusal(await place(BUYER_B, storefrontPayloadB()), DELIVERY_REFUSAL);
      expectRefusal(await place(BUYER_A, storefrontPayload(excluded())), DELIVERY_REFUSAL);

      const placedByB = await place(BUYER_B, storefrontPayloadB(excluded()));
      expect(placedByB.statusCode, placedByB.body).toBe(201);
      const placedByA = await place(BUYER_A, storefrontPayload());
      expect(placedByA.statusCode, placedByA.body).toBe(201);
    });

    it('administrator: A restricted, B not — an order for B is previewed and created with what A is refused', async () => {
      const preview = await adminPreview(adminPayloadB(excluded()));
      expect(preview.statusCode, preview.body).toBe(200);
      const created = await adminCreate(adminPayloadB(excluded()));
      expect(created.statusCode, created.body).toBe(201);

      expectRefusal(await adminCreate(adminPayload(excluded())), DELIVERY_REFUSAL);
    });

    it('administrator: restricted to opposite pairs — the customer’s Organization decides', async () => {
      await restrictBToTheOtherPair();

      const beforeB = await snapshot(BUYER_B_ID);
      expectRefusal(await adminCreate(adminPayloadB()), DELIVERY_REFUSAL);
      expectRefusal(await adminPreview(adminPayloadB()), DELIVERY_REFUSAL);
      expect(await snapshot(BUYER_B_ID)).toEqual(beforeB);

      const beforeA = await snapshot(TEST_CUSTOMER_ID);
      expectRefusal(await adminCreate(adminPayload(excluded())), DELIVERY_REFUSAL);
      expectRefusal(await adminPreview(adminPayload(excluded())), DELIVERY_REFUSAL);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(beforeA);

      const createdForA = await adminCreate(adminPayload());
      expect(createdForA.statusCode, createdForA.body).toBe(201);
      const createdForB = await adminCreate(adminPayloadB(excluded()));
      expect(createdForB.statusCode, createdForB.body).toBe(201);
    });

    it('administrator: an Organization named in the body does not replace the customer’s', async () => {
      const before = await snapshot(TEST_CUSTOMER_ID);
      const res = await adminCreate(
        adminPayload({
          paymentMethodId: excludedPaymentId,
          // Not a field of the request. Organization B is unrestricted here.
          organizationId: OTHER_TEST_ORGANIZATION_ID,
        }),
      );
      expect(res.statusCode, res.body).toBe(400);
      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
    });

    it('API keys: each key is judged on the lists of the Organization it is bound to', async () => {
      const b = { deliveryAddressId: ORG_B_DELIVERY_ADDRESS_ID, billingAddressId: ORG_B_BILLING_ADDRESS_ID };

      // A restricted, B not.
      const placedByKeyB = await postIntake({ ...b, ...excluded() }, apiKeyTokenB);
      expect(placedByKeyB.statusCode, placedByKeyB.body).toBe(201);
      expectRefusal(await postIntake(excluded()), DELIVERY_REFUSAL);

      // Opposite pairs.
      await restrictBToTheOtherPair();
      await giveBuyerBBasket();
      const beforeB = await snapshot(BUYER_B_ID);
      expectRefusal(await postIntake(b, apiKeyTokenB), DELIVERY_REFUSAL);
      expect(await snapshot(BUYER_B_ID)).toEqual(beforeB);

      const placedByKeyA = await postIntake();
      expect(placedByKeyA.statusCode, placedByKeyA.body).toBe(201);
      const placedAgainByKeyB = await postIntake({ ...b, ...excluded() }, apiKeyTokenB);
      expect(placedAgainByKeyB.statusCode, placedAgainByKeyB.body).toBe(201);
    });
  });

  describe('what the allow-list read answers', () => {
    /**
     * `allowedIdsFor` answers `null` for an Organization the owner module does
     * not know. That is "no restriction", as it is for the listings.
     */
    it('reads `null` as no restriction', async () => {
      await withAllowListRead(
        async () => null,
        async () => {
          const methods = {
            deliveryMethodId: excludedDeliveryId,
            paymentMethodId: excludedPaymentId,
          };
          const preview = await storefrontPreview(BUYER_A, methods);
          expect(preview.statusCode, preview.body).toBe(200);
          const adminPreviewed = await adminPreview(adminPayload(methods));
          expect(adminPreviewed.statusCode, adminPreviewed.body).toBe(200);
          const placed = await place(BUYER_A, storefrontPayload(methods));
          expect(placed.statusCode, placed.body).toBe(201);
        },
      );
    });

    /**
     * A read that fails is not "no restriction". Every surface answers the
     * failure — as the two listings do — and writes nothing, with methods the
     * lists would have allowed, so a refusal here can only be the failed read.
     */
    it('a failing read refuses on every surface and writes nothing', async () => {
      await putOneClickDefaults({
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      });
      const allowed = {
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      };
      const before = await snapshot(TEST_CUSTOMER_ID);

      await withAllowListRead(
        async () => {
          throw new Error('the allow-list read failed');
        },
        async () => {
          const answers: Array<[string, { statusCode: number; body: string; json: () => unknown }]> = [
            ['delivery listing', await h.app.inject({ method: 'GET', url: '/api/v1/delivery-methods', cookies: BUYER_A })],
            ['payment listing', await h.app.inject({ method: 'GET', url: '/api/v1/payment-methods', cookies: BUYER_A })],
            ['storefront place', await place(BUYER_A, storefrontPayload())],
            ['storefront preview', await storefrontPreview(BUYER_A, allowed)],
            ['admin create', await adminCreate(adminPayload())],
            ['admin preview', await adminPreview(adminPayload())],
            ['API-key intake', await postIntake()],
            ['one-click eligibility', await oneClickEligibility()],
            ['one-click place', await oneClickPlace()],
          ];
          for (const [surface, res] of answers) {
            expect(res.statusCode, `${surface}: ${res.body}`).toBe(500);
            expect((res.json() as ErrorBody).error.code, surface).toBe(ERROR_CODES.INTERNAL);
          }
        },
      );

      expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);

      // And with the read restored the same requests are served again.
      const placed = await place(BUYER_A, storefrontPayload());
      expect(placed.statusCode, placed.body).toBe(201);
    });

    it.each(['deliveryMethodIds', 'paymentMethodIds'] as const)(
      'a read that fails for %s alone still refuses',
      async (failingKind) => {
        const before = await snapshot(TEST_CUSTOMER_ID);
        await withAllowListRead(
          async function (this: unknown, ...args: unknown[]) {
            if (args[1] === failingKind) throw new Error(`the ${failingKind} read failed`);
            return [SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID];
          } as () => Promise<string[] | null>,
          async () => {
            for (const res of [
              await place(BUYER_A, storefrontPayload()),
              await storefrontPreview(BUYER_A, {
                deliveryMethodId: SEED_DELIVERY_METHOD_ID,
                paymentMethodId: SEED_PAYMENT_METHOD_ID,
              }),
              await adminCreate(adminPayload()),
              await postIntake(),
            ]) {
              expect(res.statusCode, res.body).toBe(500);
            }
          },
        );
        expect(await snapshot(TEST_CUSTOMER_ID)).toEqual(before);
      },
    );
  });
});
