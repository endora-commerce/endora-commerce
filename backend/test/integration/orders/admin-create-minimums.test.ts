import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type CartBatchLineInput, type CartWritePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order, Product } from '../../helpers/package-entities.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  createMinimumVariant,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 8a (T057) — admin create-order builds its transient basket
 * through the batch (`CartWritePort.addItems`, `onLineError: 'throw'`) and refuses
 * the whole request when any line is below a minimum (US4 #6, FR-009), judging
 * the product's total across its lines (D1). A product the customer may not see
 * answers exactly as an unknown id does (FR-035, threat F1, US4 #16), and the
 * placement check stays the backstop when the batch step admits everything
 * (FR-037, threat F3).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CTX = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000a1480';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** The slice of the carts service the backstop double replaces. */
interface CartServiceSlice {
  addItems(...args: unknown[]): Promise<unknown>;
  getOrCreateForCustomer(ctx: typeof CTX & { salesChannelId: string }): Promise<unknown>;
}

describe('155 — admin create-order refuses below-minimum lines through the batch [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelId = '';
  let A: MinimumProductFixture;
  let V: MinimumProductFixture;
  let vRed = '';
  let vBlue = '';
  let H: MinimumProductFixture;

  const cradle = () =>
    h.container.cradle as unknown as { cartWritePort: CartWritePort; cartService: CartServiceSlice };

  const create = (items: Array<{ productId: string; variantId?: string; quantity: number }>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        items,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });

  const errorOf = (res: { json: () => unknown }) => (res.json() as ErrorBody).error;
  /** The error without its per-request id: what two answers are compared on. */
  const answerOf = (res: { json: () => unknown }) => {
    const { requestId: _requestId, ...rest } = errorOf(res) as ErrorBody['error'] & { requestId?: string };
    return rest;
  };

  const orderCount = async () => {
    const em = h.em();
    em.clear();
    return em.count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID }, { filters: false });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = await systemDefaultSalesChannelId(em);
    const channels = Array.from(new Set([channelId, ...(await buyerChannelIds(em))]));
    A = await createMinimumProduct(em, {
      sku: `ACM-A-${RUN}`,
      nameEn: `Anchor ${RUN}`,
      namePl: `Kotwa ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    V = await createMinimumProduct(em, {
      sku: `ACM-V-${RUN}`,
      nameEn: `Vane ${RUN}`,
      namePl: `Lopatka ${RUN}`,
      type: 'configurable',
      minOrderQuantity: 10,
      channelIds: channels,
    });
    vRed = await createMinimumVariant(em, V.id, `ACM-V-RED-${RUN}`);
    vBlue = await createMinimumVariant(em, V.id, `ACM-V-BLUE-${RUN}`);
    H = await createMinimumProduct(em, {
      sku: `ACM-H-${RUN}`,
      nameEn: `Hidden ${RUN}`,
      namePl: `Ukryty ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    // Placed for real in D1: no stock rows for a per-run product.
    await em.nativeUpdate(Product, { id: { $in: [A.id, V.id, H.id] } }, { manageStock: false });
    // H is published on the channel but not for the customer's Organization.
    await em.nativeUpdate(Product, { id: H.id }, { allowedOrganizationIds: [OTHER_ORG_ID] });
  }, 180_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('US4 #6 — A × 5 is refused whole with the minimum message, the line keyed by its request index; no order', async () => {
    const ordersBefore = await orderCount();
    const res = await create([{ productId: A.id, quantity: 5 }]);
    expect(res.statusCode, res.body).toBe(422);
    const error = errorOf(res);
    expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    expect(error.message).toBe(`"${A.nameEn}" has a minimum order quantity of 10 pcs.`);
    expect(error.details).toMatchObject({ productId: A.id, productName: A.nameEn, minimum: 10, total: 5 });
    expect(error.details?.['lines']).toEqual([
      { index: 0, productId: A.id, productName: A.nameEn, kind: 'pieces', minimum: 10 },
    ]);
    expect(await orderCount()).toBe(ordersBefore);
  });

  it('every offending line is listed by its numeric index, after a line that meets nothing', async () => {
    const res = await create([
      { productId: V.id, variantId: vRed, quantity: 10 },
      { productId: A.id, quantity: 3 },
      { productId: A.id, quantity: 4 },
    ]);
    expect(res.statusCode, res.body).toBe(422);
    const error = errorOf(res);
    expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    expect(error.details).toMatchObject({ productId: A.id, minimum: 10, total: 7 });
    const lines = error.details?.['lines'] as Array<{ index: unknown }>;
    expect(lines.map((l) => l.index)).toEqual([1, 2]);
  });

  it('D1 — V-red × 5 + V-blue × 5 against a minimum of 10 is accepted: the product total counts', async () => {
    const ordersBefore = await orderCount();
    const res = await create([
      { productId: V.id, variantId: vRed, quantity: 5 },
      { productId: V.id, variantId: vBlue, quantity: 5 },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    expect(await orderCount()).toBe(ordersBefore + 1);
  });

  it('F1 / US4 #16 — a product hidden from the customer (minimum 10, × 5) answers exactly as an unknown id', async () => {
    const hidden = await create([{ productId: H.id, quantity: 5 }]);
    const unknown = await create([{ productId: randomUUID(), quantity: 5 }]);
    expect(hidden.statusCode, hidden.body).toBe(404);
    expect(unknown.statusCode, unknown.body).toBe(404);
    expect(answerOf(hidden)).toEqual(answerOf(unknown));
    expect(errorOf(hidden).code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    expect(hidden.body).not.toContain(H.nameEn);
    expect(hidden.body).not.toContain('minimum');
  });

  it('F3 — with the batch step replaced by a double that admits every line, placement still refuses A × 5', async () => {
    const service = cradle().cartService;
    const admitted: CartBatchLineInput[][] = [];
    const spy = vi.spyOn(service, 'addItems').mockImplementation(async (...args: unknown[]) => {
      // The basket the admin create addresses — the one of the order's channel.
      const basket = (args[0] as { customer: typeof CTX & { salesChannelId: string } }).customer;
      const lines = args[1] as CartBatchLineInput[];
      admitted.push(lines);
      const seeded = await cradle().cartWritePort.replaceItemsForCustomer(
        basket,
        lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: '10.00', currency: 'PLN' })),
      );
      // Issue #169 — placement places from the working basket `addItems` hands
      // back, never from the active one: the double hands back an unchecked one.
      await h.em().getConnection().execute(`update carts set status = 'working' where id = ?`, [seeded.cart.id]);
      return {
        cart: { ...seeded.cart, status: 'working' },
        items: [],
        outcomes: lines.map((_, index) => ({ index, status: 'added' as const })),
      };
    });
    const ordersBefore = await orderCount();
    try {
      const res = await create([{ productId: A.id, quantity: 5 }]);
      expect(admitted, 'the batch step was not reached').toHaveLength(1);
      expect(res.statusCode, res.body).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      // Placement's shape: the basket line by its cart item id, not a request index.
      const lines = error.details?.['lines'] as Array<Record<string, unknown>>;
      expect(lines[0]).toHaveProperty('cartItemId');
      expect(lines[0]).not.toHaveProperty('index');
    } finally {
      spy.mockRestore();
    }
    expect(await orderCount()).toBe(ordersBefore);
  });
});
