import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Cart, Order } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { OrderCloneToQuoteService } from '../../../../packages/modules/orders/dist/backend/services/order-clone-to-quote-service.js';
import { assertMethodsAllowedForOrganization } from '../../../../packages/modules/orders/dist/backend/services/organization-method-allow-list-gate.js';
import { assertMethodsOfferedInChannel } from '../../../../packages/modules/orders/dist/backend/services/method-channel-gate.js';

/**
 * Issue #86 — the domain refusals of `orders`' buyer-facing and admin order
 * paths that were raised as `VALIDATION_FAILED` with an English sentence.
 *
 * `VALIDATION_FAILED` is the one code whose message the error envelope never
 * replaces, so every one of these was answered in English whatever the reader
 * asked for, and a client could not tell any of them from a malformed request.
 * Each now has a code of its own, a sentence in English and Polish, and the
 * values the sentence names in `details`.
 *
 * The method gates' token sentences (`…_not_allowed_for_organization`,
 * `…_not_in_sales_channel`) are asserted through a route that raises from the
 * gate itself, so the real envelope, routing and installed bundles render
 * them; their placement routes are asserted with the code in the contract
 * tests beside each gate (`place-order-organization-method-allow-list`,
 * `place-order-method-channel`).
 *
 * The sentences are written out here rather than read from the bundle — a test
 * that loads the file it is checking asserts only that JSON parses.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

const DELIVERY_UNAVAILABLE = {
  en: 'The selected delivery method is not available for this order. Choose another delivery method.',
  pl: 'Wybrana metoda dostawy nie jest dostępna dla tego zamówienia. Wybierz inną metodę dostawy.',
};
const PAYMENT_UNAVAILABLE = {
  en: 'The selected payment method is not available for this order. Choose another payment method.',
  pl: 'Wybrana metoda płatności nie jest dostępna dla tego zamówienia. Wybierz inną metodę płatności.',
};
const COMMENTS_CLOSED = {
  en: 'Comments are closed for completed or cancelled orders.',
  pl: 'Komentowanie jest zamknięte dla zamówień zakończonych lub anulowanych.',
};
/** An allow-list port whose Organization allows only another method. */
const restriction = { allowedIdsFor: async () => ['00000000-0000-4000-8000-00000000a11a'] };
/** Method reads whose methods are offered on no channel but another. */
const notInChannel = {
  deliveryMethodRead: () => ({ isAvailableInChannel: async () => false }),
  paymentMethodRead: () => ({ isAvailableInChannel: async () => false }),
};
const GATE_CHANNEL_ID = '00000000-0000-4000-8000-00000000c86c';
const GATE_DELIVERY_ID = '00000000-0000-4000-8000-00000000d86d';
const GATE_PAYMENT_ID = '00000000-0000-4000-8000-00000000f86f';

const GATES = {
  'delivery-not-allowed': {
    raise: () =>
      assertMethodsAllowedForOrganization(restriction as never, {
        organizationId: TEST_ORGANIZATION_ID,
        deliveryMethodId: GATE_DELIVERY_ID,
      }),
    code: 'ORDER_DELIVERY_METHOD_UNAVAILABLE',
    details: { code: 'delivery_method_not_allowed_for_organization', deliveryMethodId: GATE_DELIVERY_ID },
    en: 'The selected delivery method is not available to this organization. Choose another delivery method.',
    pl: 'Wybrana metoda dostawy nie jest dostępna dla tej organizacji. Wybierz inną metodę dostawy.',
  },
  'payment-not-allowed': {
    raise: () =>
      assertMethodsAllowedForOrganization(restriction as never, {
        organizationId: TEST_ORGANIZATION_ID,
        paymentMethodId: GATE_PAYMENT_ID,
      }),
    code: 'ORDER_PAYMENT_METHOD_UNAVAILABLE',
    details: { code: 'payment_method_not_allowed_for_organization', paymentMethodId: GATE_PAYMENT_ID },
    en: 'The selected payment method is not available to this organization. Choose another payment method.',
    pl: 'Wybrana metoda płatności nie jest dostępna dla tej organizacji. Wybierz inną metodę płatności.',
  },
  'delivery-not-in-channel': {
    raise: () =>
      assertMethodsOfferedInChannel(notInChannel, {
        salesChannelId: GATE_CHANNEL_ID,
        deliveryMethodId: GATE_DELIVERY_ID,
      }),
    code: 'ORDER_DELIVERY_METHOD_UNAVAILABLE',
    details: {
      code: 'delivery_method_not_in_sales_channel',
      deliveryMethodId: GATE_DELIVERY_ID,
      salesChannelId: GATE_CHANNEL_ID,
    },
    en: 'The selected delivery method is not offered in this store. Choose another delivery method.',
    pl: 'Wybrana metoda dostawy nie jest oferowana w tym sklepie. Wybierz inną metodę dostawy.',
  },
  'payment-not-in-channel': {
    raise: () =>
      assertMethodsOfferedInChannel(notInChannel, {
        salesChannelId: GATE_CHANNEL_ID,
        paymentMethodId: GATE_PAYMENT_ID,
      }),
    code: 'ORDER_PAYMENT_METHOD_UNAVAILABLE',
    details: {
      code: 'payment_method_not_in_sales_channel',
      paymentMethodId: GATE_PAYMENT_ID,
      salesChannelId: GATE_CHANNEL_ID,
    },
    en: 'The selected payment method is not offered in this store. Choose another payment method.',
    pl: 'Wybrana metoda płatności nie jest oferowana w tym sklepie. Wybierz inną metodę płatności.',
  },
} as const;

const CLONE_NO_LINES = {
  en: 'This order has no lines to copy into a quote request.',
  pl: 'To zamówienie nie ma pozycji, które można skopiować do zapytania ofertowego.',
};

describe('order refusals carry their own code and sentence (issue #86)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let channelCode: string;

  beforeAll(async () => {
    h = await setupBackendServer({
      extraModules: [
        async (instance) => {
          instance.get<{ Params: { gate: keyof typeof GATES } }>('/_test/i86-gate/:gate', async (request) => {
            await GATES[request.params.gate].raise();
            return { ok: true };
          });
        },
      ],
    });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
    channelCode = channel.code;
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function freshBasket(): Promise<void> {
    await h.em().nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: CUSTOMER,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  function place(language: string, overrides: Record<string, unknown> = {}) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        ...overrides,
      },
      cookies: CUSTOMER,
      headers: { 'accept-language': language },
    });
  }

  function preview(language: string, overrides: Record<string, unknown> = {}) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      payload: {
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        ...overrides,
      },
      cookies: CUSTOMER,
      headers: { 'accept-language': language },
    });
  }

  function refusal(
    res: { statusCode: number; body: string; json: () => unknown },
    status: number,
    code: string,
  ): ErrorBody['error'] {
    expect(res.statusCode, res.body).toBe(status);
    const error = (res.json() as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  /** An order of the test Organization in the given status, written directly. */
  async function orderIn(status: string): Promise<string> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: channelId,
      status,
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order.id;
  }

  describe('the method gates — the token picks the sentence', () => {
    for (const [gate, c] of Object.entries(GATES)) {
      it.each(['en', 'pl'] as const)(`${gate} (%s)`, async (language) => {
        const res = await h.app.inject({
          method: 'GET',
          url: `/_test/i86-gate/${gate}`,
          headers: { 'accept-language': language },
        });
        const error = refusal(res, 400, c.code);
        expect(error.details).toEqual(c.details);
        expect(error.message).toBe(c[language]);
        if (language === 'pl') expect(error.message).not.toBe(c.en);
      });
    }
  });

  describe('a delivery or payment method that is not active (or not there)', () => {
    const unknownMethod = '00000000-0000-4000-8000-00000000e86e';

    beforeAll(async () => {
      await freshBasket();
    });

    it.each([
      ['place', 'en'],
      ['place', 'pl'],
      ['preview', 'en'],
      ['preview', 'pl'],
    ] as const)('ORDER_DELIVERY_METHOD_UNAVAILABLE on %s (%s)', async (route, language) => {
      const send = route === 'place' ? place : preview;
      const error = refusal(
        await send(language, { deliveryMethodId: unknownMethod }),
        400,
        ERROR_CODES.ORDER_DELIVERY_METHOD_UNAVAILABLE,
      );
      expect(error.message).toBe(DELIVERY_UNAVAILABLE[language]);
      expect(error.details).toEqual({ deliveryMethodId: unknownMethod });
    });

    it.each([
      ['place', 'en'],
      ['place', 'pl'],
      ['preview', 'en'],
      ['preview', 'pl'],
    ] as const)('ORDER_PAYMENT_METHOD_UNAVAILABLE on %s (%s)', async (route, language) => {
      const send = route === 'place' ? place : preview;
      const error = refusal(
        await send(language, { paymentMethodId: unknownMethod }),
        400,
        ERROR_CODES.ORDER_PAYMENT_METHOD_UNAVAILABLE,
      );
      expect(error.message).toBe(PAYMENT_UNAVAILABLE[language]);
      expect(error.details).toEqual({ paymentMethodId: unknownMethod });
    });
  });

  describe('ORDER_BELOW_MINIMUM_VALUE — the basket is below the channel minimum', () => {
    const CODE = 'orders.min_order_value';

    async function setMinimum(value: number): Promise<void> {
      await h.settings.adminService.setValueForSubset(CODE, [channelCode], value, null, {
        actorAdminUserId: null,
      });
      await h.settings.cache.invalidate(CODE);
    }

    beforeAll(async () => {
      await freshBasket();
      await setMinimum(10_000);
    });

    afterAll(async () => {
      await setMinimum(0);
    });

    it('answers its own code with the minimum, the basket value and the currency in details', async () => {
      const error = refusal(await place('en'), 422, ERROR_CODES.ORDER_BELOW_MINIMUM_VALUE);
      expect(error.details).toMatchObject({ minimum: '10000.00', currency: 'PLN' });
      expect(error.details?.['subtotal']).toMatch(/^\d+\.\d{2}$/);
      expect(error.message).toBe(
        `The value of the order (${String(error.details?.['subtotal'])} PLN) is below the minimum order value of this store (10000.00 PLN).`,
      );
    });

    it('pl — the Polish sentence, naming both values', async () => {
      const error = refusal(await place('pl'), 422, ERROR_CODES.ORDER_BELOW_MINIMUM_VALUE);
      const subtotal = String(error.details?.['subtotal']);
      expect(error.message).toBe(
        `Wartość zamówienia (${subtotal} PLN) jest niższa od minimalnej wartości zamówienia w tym sklepie (10000.00 PLN).`,
      );
      expect(error.message).toContain('10000.00');
    });
  });

  describe('ORDER_COMMENTS_CLOSED — a comment on a completed order', () => {
    let terminalOrderId = '';
    let languageBefore: string | null = null;

    beforeAll(async () => {
      terminalOrderId = await orderIn('completed');
      languageBefore = (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    });

    afterAll(async () => {
      await setAdminLanguage(languageBefore);
    });

    async function setAdminLanguage(value: string | null): Promise<void> {
      const em = h.em();
      const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
      admin.preferredLanguage = value;
      await em.flush();
    }

    it.each(['en', 'pl'] as const)('by the buyer (%s)', async (language) => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${terminalOrderId}/comments`,
        cookies: CUSTOMER,
        headers: { 'accept-language': language },
        payload: { body: 'too late' },
      });
      const error = refusal(res, 409, ERROR_CODES.ORDER_COMMENTS_CLOSED);
      expect(error.message).toBe(COMMENTS_CLOSED[language]);
      expect(error.details).toEqual({ orderId: terminalOrderId });
    });

    // An operator is answered in their stored preference (D-132).
    it.each(['en', 'pl'] as const)('by an operator (%s)', async (language) => {
      await setAdminLanguage(language);
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${terminalOrderId}/comments`,
        cookies: ADMIN,
        payload: { body: 'too late', isCustomerVisible: true, notifyCustomer: false },
      });
      const error = refusal(res, 409, ERROR_CODES.ORDER_COMMENTS_CLOSED);
      expect(error.message).toBe(COMMENTS_CLOSED[language]);
    });
  });

  describe('clone to quote', () => {
    it.each(['en', 'pl'] as const)('ORDER_CLONE_NO_LINES (%s) — an order with no lines', async (language) => {
      const orderId = await orderIn('completed');
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/clone-to-quote`,
        cookies: CUSTOMER,
        headers: { 'accept-language': language },
      });
      const error = refusal(res, 409, ERROR_CODES.ORDER_CLONE_NO_LINES);
      expect(error.message).toBe(CLONE_NO_LINES[language]);
      expect(error.details).toEqual({ orderId });
    });

    /**
     * `quote_requests` absent is the platform's one refusal for a module that
     * is off, naming the module — not `VALIDATION_FAILED` under a 503. Driven
     * on the service, with the port answering what an absent owner answers.
     */
    it('MODULE_DISABLED naming quote_requests when the quote desk is absent', async () => {
      const orderId = await orderIn('completed');
      const service = new OrderCloneToQuoteService(() => h.em().fork(), () => null);
      await expect(
        service.clone(orderId, { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID }),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: ERROR_CODES.MODULE_DISABLED,
        details: { module: 'quote_requests' },
      });
    });
  });

  it('routes every minted code to orders, the module that raises it', () => {
    for (const code of [
      ERROR_CODES.ORDER_DELIVERY_METHOD_UNAVAILABLE,
      ERROR_CODES.ORDER_PAYMENT_METHOD_UNAVAILABLE,
      ERROR_CODES.ORDER_BELOW_MINIMUM_VALUE,
      ERROR_CODES.ORDER_COMMENTS_CLOSED,
      ERROR_CODES.ORDER_CLONE_NO_LINES,
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('orders');
    }
  });
});
