import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedStockRaceFixture } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #86 — `STOCK_UNAVAILABLE` says which product and which quantity.
 *
 * The thrower wrote "Insufficient stock for product <uuid>." and the bundle
 * answered "Stock Unavailable." in English and the same fragment, lower-cased
 * behind the Polish word for "error", in Polish. A buyer
 * with twenty lines in the order was not told which one to change.
 *
 * What `details` deliberately does **not** carry is how many are left. The
 * storefront shows an exact figure only when the shop's stock display mode is
 * `exact` (`exactOnHand` is `null` in the `band` and `available_or_not`
 * modes), so a refusal that named the available quantity would hand every
 * buyer the number those two modes exist to withhold. The last case below
 * holds that line.
 *
 * The fixture gives one product an on-hand quantity of 1 and two buyers a cart
 * holding one each: the first order takes it, the second is refused.
 */

interface Refusal {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('STOCK_UNAVAILABLE names the product and the quantity ordered (issue #86)', () => {
  let h: BackendServerHandle;

  function place(cookie: string, acceptLanguage: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: cookie },
      headers: { 'accept-language': acceptLanguage },
    });
  }

  async function refusal(acceptLanguage: string): Promise<Refusal['error']> {
    const res = await place('stub-customer-session-race-b', acceptLanguage);
    // The status the refusal has always had.
    expect(res.statusCode).toBe(409);
    const body = res.json() as Refusal;
    expect(body.error.code).toBe(ERROR_CODES.STOCK_UNAVAILABLE);
    return body.error;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedStockRaceFixture(h.em());
    const first = await place('stub-customer-session-race-a', 'en');
    expect(first.statusCode).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('details name the product and the quantity ordered', async () => {
    const { details } = await refusal('en');
    expect(details).toEqual({
      productId: SEED_PRODUCT_101_ID,
      sku: 'EXAMPLE-SIMPLE-001',
      productName: expect.any(String),
      requestedQuantity: 1,
    });
    expect(String(details?.['productName']).length).toBeGreaterThan(0);
  });

  it('en — the sentence names the product and the quantity', async () => {
    const { message, details } = await refusal('en');
    expect(message).toBe(
      `"${String(details?.['productName'])}" (EXAMPLE-SIMPLE-001) is not available in the quantity ` +
        'ordered (1). Reduce the quantity or remove the product from the order.',
    );
  });

  it('pl — the Polish sentence names them too, and is not the English fallback', async () => {
    const { message, details } = await refusal('pl');
    expect(message).toBe(
      `Produkt „${String(details?.['productName'])}” (EXAMPLE-SIMPLE-001) nie jest dostępny w zamówionej ` +
        'ilości (1). Zmniejsz ilość albo usuń produkt z zamówienia.',
    );
    // An unfilled placeholder makes the envelope answer with what the thrower
    // wrote, in English.
    expect(message).not.toMatch(/Insufficient stock|stock unavailable|\{/i);
  });

  it('does not say how many are left — the stock display mode decides that, not a refusal', async () => {
    const { details, message } = await refusal('en');
    expect(Object.keys(details ?? {}).sort()).toEqual([
      'productId',
      'productName',
      'requestedQuantity',
      'sku',
    ]);
    expect(message).not.toMatch(/\b0\b|left|remaining/i);
  });
});
