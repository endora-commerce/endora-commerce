import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';
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
import { LINE_QUANTITY_MAX, expectQuantityRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351 — the admin create-order route, its preview and the external API
 * intake bound a line's quantity at `LINE_QUANTITY_MAX`. One past it is
 * `VALIDATION_FAILED` naming the field — `400` on the admin routes, `422` on the
 * external namespace, whose handler parses the body itself — and the bound
 * itself is accepted. The line-count bound on these routes is
 * `admin-order-bounds.test.ts` / `api-intake-minimums.test.ts`.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('orders — line quantity bound (issue #351)', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelId = '';
  let token = '';
  let F: MinimumProductFixture;

  const addresses = {
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
  };

  const create = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        items: [{ productId: F.id, quantity }],
        ...addresses,
      },
    });

  const preview = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: ADMIN,
      payload: { customerAccountId: TEST_CUSTOMER_ID, salesChannelId: channelId, items: [{ productId: F.id, quantity }] },
    });

  const external = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `351-${randomUUID()}` },
      payload: { lines: [{ sku: F.sku, quantity }], ...addresses },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = await systemDefaultSalesChannelId(em);
    const channels = Array.from(new Set([channelId, ...(await buyerChannelIds(em))]));
    F = await createMinimumProduct(em, {
      sku: `LQB-F-${RUN}`,
      nameEn: `Free ${RUN}`,
      namePl: `Wolny ${RUN}`,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: F.id }, { manageStock: false });

    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: `Line quantity bound ${RUN}`,
        scopes: ['orders:read', 'orders:write'],
        binding: { organizationId: TEST_ORGANIZATION_ID, salesChannelId: channelId, customerAccountId: TEST_CUSTOMER_ID },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    token = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  }, 180_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('POST /api/v1/admin/orders refuses one past the bound with 400 and creates an order at it', async () => {
    expectQuantityRefused(await create(LINE_QUANTITY_MAX + 1), 'items.0.quantity');
    expectQuantityRefused(await create(2 ** 31), 'items.0.quantity');
    const res = await create(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(201);
  });

  it('POST /api/v1/admin/orders/preview refuses one past the bound with 400 and prices the bound', async () => {
    expectQuantityRefused(await preview(LINE_QUANTITY_MAX + 1), 'items.0.quantity');
    const res = await preview(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
  });

  it('POST /api/v1/external/orders refuses one past the bound with 422 and places an order at it', async () => {
    expectQuantityRefused(await external(LINE_QUANTITY_MAX + 1), 'lines.0.quantity', { external: true });
    expectQuantityRefused(await external(2 ** 31), 'lines.0.quantity', { external: true });
    const res = await external(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(201);
  });
});
