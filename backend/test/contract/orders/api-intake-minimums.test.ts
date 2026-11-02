import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_ORDER_MAX_ITEMS,
  ERROR_CODES,
  type CartBatchLineInput,
  type CartWritePort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order, OrderPlacementIntent, Product } from '../../helpers/package-entities.js';
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
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 8a (T057, T063b) — the API order intake
 * (`POST /api/v1/external/orders`) builds the service account's basket through
 * the batch (`CartWritePort.addItems`, `onLineError: 'throw'`) and refuses the
 * whole request when any line is below a minimum (FR-009), judging the
 * product's total across its lines (D1). A product the customer may not see is
 * refused as it is today — `404 PRODUCT_NOT_FOUND`, no name, no minimum
 * (FR-035, threat F1). The placement check stays the backstop when the batch
 * step admits everything (threat F3). More than `ADMIN_ORDER_MAX_ITEMS` lines
 * are refused before anything is resolved (FR-038, owner ruling 2026-10-16).
 *
 * Intake lines name a SKU, which resolves to a product, never to a variant, so
 * D1 is two lines of one product here; the variant form is admin create's
 * (`test/integration/orders/admin-create-minimums.test.ts`).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CTX = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000a1481';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId?: string };
}

/** The slices of the cradle singletons this file watches or replaces. */
interface CartServiceSlice {
  addItems(...args: unknown[]): Promise<unknown>;
  addItem(...args: unknown[]): Promise<unknown>;
  getOrCreateForCustomer(ctx: typeof CTX & { salesChannelId: string }): Promise<unknown>;
}
interface CatalogReadSlice {
  findBySkus(...args: unknown[]): Promise<unknown>;
}

describe('155 — API order intake: minimums through the batch, and the item bound [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let token = '';
  let A: MinimumProductFixture;
  let F: MinimumProductFixture;
  let H: MinimumProductFixture;

  const cradle = () =>
    h.container.cradle as unknown as {
      cartWritePort: CartWritePort;
      cartService: CartServiceSlice;
      catalogProductReadPort: CatalogReadSlice;
    };

  const post = (lines: Array<{ sku: string; quantity: number }>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `moq-${randomUUID()}` },
      payload: {
        lines,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });

  const errorOf = (res: { json: () => unknown }) => (res.json() as ErrorBody).error;

  const orderCount = async () => {
    const em = h.em();
    em.clear();
    return em.count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID }, { filters: false });
  };
  const intentCount = async () => {
    const em = h.em();
    em.clear();
    return em.count(OrderPlacementIntent, {}, { filters: false });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channelId = await systemDefaultSalesChannelId(em);
    const channels = Array.from(new Set([channelId, ...(await buyerChannelIds(em))]));
    A = await createMinimumProduct(em, {
      sku: `AIM-A-${RUN}`,
      nameEn: `Anchor ${RUN}`,
      namePl: `Kotwa ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    F = await createMinimumProduct(em, {
      sku: `AIM-F-${RUN}`,
      nameEn: `Free ${RUN}`,
      namePl: `Wolny ${RUN}`,
      channelIds: channels,
    });
    H = await createMinimumProduct(em, {
      sku: `AIM-H-${RUN}`,
      nameEn: `Hidden ${RUN}`,
      namePl: `Ukryty ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: { $in: [A.id, F.id, H.id] } }, { manageStock: false });
    // H is published on the channel but not for the bound Organization.
    await em.nativeUpdate(Product, { id: H.id }, { allowedOrganizationIds: [OTHER_ORG_ID] });

    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: `Minimum intake ${RUN}`,
        scopes: ['orders:read', 'orders:write'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: channelId,
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    token = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  }, 180_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('A × 5 is refused whole with the minimum message, the line keyed by its request index; no order', async () => {
    const ordersBefore = await orderCount();
    const res = await post([{ sku: A.sku, quantity: 5 }]);
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

  it('D1 — two lines of A × 5 against a minimum of 10 are accepted: the product total counts', async () => {
    const ordersBefore = await orderCount();
    const res = await post([
      { sku: A.sku, quantity: 5 },
      { sku: A.sku, quantity: 5 },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    expect(await orderCount()).toBe(ordersBefore + 1);
  });

  it('F1 / US4 #16 — a product hidden from the bound Organization: 404 PRODUCT_NOT_FOUND, no name, no minimum', async () => {
    const ordersBefore = await orderCount();
    const res = await post([{ sku: H.sku, quantity: 5 }]);
    expect(res.statusCode, res.body).toBe(404);
    const { requestId: _requestId, ...answer } = errorOf(res);
    expect(answer).toEqual({ code: ERROR_CODES.PRODUCT_NOT_FOUND, message: 'Product not found.' });
    expect(res.body).not.toContain(H.nameEn);
    expect(res.body).not.toContain('minimum');
    expect(await orderCount()).toBe(ordersBefore);
  });

  it('F3 — with the batch step replaced by a double that admits every line, placement still refuses A × 5', async () => {
    const service = cradle().cartService;
    const admitted: CartBatchLineInput[][] = [];
    const spy = vi.spyOn(service, 'addItems').mockImplementation(async (...args: unknown[]) => {
      // The basket the intake addresses — the one of its binding's channel.
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
      const res = await post([{ sku: A.sku, quantity: 5 }]);
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

  describe('FR-038 / T063b — the item bound', () => {
    it(`${ADMIN_ORDER_MAX_ITEMS + 1} lines → 422 VALIDATION_FAILED too_many_items, before anything is resolved, added or recorded`, async () => {
      const findBySkus = vi.spyOn(cradle().catalogProductReadPort, 'findBySkus');
      const addItems = vi.spyOn(cradle().cartService, 'addItems');
      const addItem = vi.spyOn(cradle().cartService, 'addItem');
      const ordersBefore = await orderCount();
      const intentsBefore = await intentCount();
      try {
        const res = await post(Array.from({ length: ADMIN_ORDER_MAX_ITEMS + 1 }, () => ({ sku: F.sku, quantity: 1 })));
        expect(res.statusCode, res.body.slice(0, 500)).toBe(422);
        const error = errorOf(res);
        expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
        expect(error.details).toEqual({ code: 'too_many_items', maximum: ADMIN_ORDER_MAX_ITEMS });
        expect(findBySkus).not.toHaveBeenCalled();
        expect(addItems).not.toHaveBeenCalled();
        expect(addItem).not.toHaveBeenCalled();
      } finally {
        findBySkus.mockRestore();
        addItems.mockRestore();
        addItem.mockRestore();
      }
      expect(await orderCount()).toBe(ordersBefore);
      expect(await intentCount()).toBe(intentsBefore);
    });

    it(`${ADMIN_ORDER_MAX_ITEMS} lines pass the bound — and the catalogue spy does see that request`, async () => {
      const findBySkus = vi.spyOn(cradle().catalogProductReadPort, 'findBySkus');
      try {
        const res = await post(Array.from({ length: ADMIN_ORDER_MAX_ITEMS }, () => ({ sku: F.sku, quantity: 1 })));
        expect(res.statusCode, res.body.slice(0, 500)).toBe(201);
        expect(findBySkus).toHaveBeenCalled();
      } finally {
        findBySkus.mockRestore();
      }
    }, 120_000);
  });
});
