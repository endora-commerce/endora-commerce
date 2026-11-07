import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
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
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Order, Product } from '../../helpers/package-entities.js';

/**
 * Issue #820 — the create path the admin order preview follows.
 *
 * A soft-deleted product is unavailable everywhere (`specs/163-product-data-scopes/`
 * FR-001), so `POST /api/v1/admin/orders` refuses it with `404
 * PRODUCT_NOT_FOUND` and writes no order. The preview reports the same line
 * as `PRODUCT_NOT_FOUND` (`admin-order-preview-availability.test.ts`), and
 * this file pins the half it agrees with: if create ever accepts a deleted
 * product again, the two disagree and this goes red first.
 *
 * Issue #829 — an **archived** product (FR-019, `archivedAt`) is refused with
 * its own reason, `409 PRODUCT_ARCHIVED`, catalog's code and sentence, naming
 * it in `details.productIds` — what the operator's quote request answers
 * (FR-115, P-3b) and the code the preview reports for the same line.
 *
 * The seed product is stocked by the commerce seed and sold on the system
 * default channel, so the live control places and the only difference
 * between the cases is `deletedAt` or `archivedAt`.
 */
describe('POST /api/v1/admin/orders — a soft-deleted or archived product (issues #820, #829)', () => {
  let h: BackendServerHandle;
  let channelId: string;

  const ADMIN = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = await systemDefaultSalesChannelId(h.em());
  }, 60_000);

  afterAll(async () => {
    await h.em().nativeUpdate(Product, { id: SEED_PRODUCT_101_ID }, { deletedAt: null, archivedAt: null });
    await teardownBackendServer(h);
  });

  async function create() {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });
    const body = res.json() as {
      data?: { id: string };
      error?: { code?: string; message?: string; details?: unknown };
    };
    return { statusCode: res.statusCode, body, raw: res.body };
  }

  it('answers 404 PRODUCT_NOT_FOUND and writes no order', async () => {
    const ordersBefore = await h.em().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID });
    await h.em().nativeUpdate(Product, { id: SEED_PRODUCT_101_ID }, { deletedAt: new Date() });
    try {
      const res = await create();
      expect(res.statusCode, res.raw).toBe(404);
      expect(res.body.error?.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      expect(
        await h.em().fork().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID }),
      ).toBe(ordersBefore);
    } finally {
      await h.em().nativeUpdate(Product, { id: SEED_PRODUCT_101_ID }, { deletedAt: null });
    }
  });

  it('an archived product answers 409 PRODUCT_ARCHIVED naming it, and writes no order (issue #829)', async () => {
    const ordersBefore = await h.em().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID });
    await h.em().nativeUpdate(Product, { id: SEED_PRODUCT_101_ID }, { archivedAt: new Date() });
    try {
      const res = await create();
      expect(res.statusCode, res.raw).toBe(409);
      expect(res.body.error?.code).toBe(ERROR_CODES.PRODUCT_ARCHIVED);
      expect(res.body.error?.message).toBe('Product is archived.');
      expect(res.body.error?.details).toEqual({ productIds: [SEED_PRODUCT_101_ID] });
      expect(
        await h.em().fork().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID }),
      ).toBe(ordersBefore);
    } finally {
      await h.em().nativeUpdate(Product, { id: SEED_PRODUCT_101_ID }, { archivedAt: null });
    }
  });

  it('control — the same product, live, is placed', async () => {
    const res = await create();
    expect(res.statusCode, res.raw).toBe(201);
  });
});
