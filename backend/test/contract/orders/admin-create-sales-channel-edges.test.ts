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
import {
  seedProbeChannelAssortment,
  type ChannelAssortment,
} from '../../helpers/channel-assortment-fixture.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Order, StockLevel } from '../../helpers/package-entities.js';

/**
 * Edges around `POST /api/v1/admin/orders` and the optional `salesChannelId`
 * of `CartWritePort.addItem`, beside `admin-create-sales-channel.test.ts`.
 *
 * - An existing but inactive channel is refused on admin create, even when
 *   the customer's Organization is assigned to it: the order's channel must be
 *   one of the Organization's **active** channels (issue #515, which changed
 *   the behaviour this file used to pin — a plain existence lookup that
 *   answered 201).
 * - A conflicting `X-Sales-Channel` header on the admin request does not
 *   override the body's channel.
 * - A buyer cannot reach the new field through the storefront cart route: an
 *   extra `salesChannelId` in the body is dropped, and the request channel
 *   keeps deciding.
 */
describe('POST /api/v1/admin/orders — sales channel edges', () => {
  let h: BackendServerHandle;
  let probe: ChannelAssortment;
  let inactive: ChannelAssortment;
  let defaultCode: string;

  const ADMIN = { b2b_session: 'stub-admin-session' };
  const BUYER = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    probe = await seedProbeChannelAssortment(h.em(), 'admin-edge-live');
    inactive = await seedProbeChannelAssortment(h.em(), 'admin-edge-off');
    const conn = h.em().getConnection();
    await conn.execute('update sales_channels set active = false where id = ?', [inactive.id]);
    const defaultId = await systemDefaultSalesChannelId(h.em());
    const rows = (await conn.execute('select code from sales_channels where id = ?', [
      defaultId,
    ])) as Array<{ code: string }>;
    defaultCode = rows[0]!.code;
    await conn.execute(
      'delete from sales_channel_products where sales_channel_id = ? and product_id = ?',
      [defaultId, probe.soldHereId],
    );
    await h.em().persistAndFlush(
      h.em().create(StockLevel, {
        productId: probe.soldHereId,
        warehouseId: '00000000-0000-4000-8000-00000000d017',
        onHand: 100,
        reserved: 0,
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function create(
    salesChannelId: string,
    productId: string,
    headers: Record<string, string> = {},
  ) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN,
      headers,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId,
        items: [{ productId, quantity: 1 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });
    const body = res.json() as { data?: { id: string }; error?: { code?: string } };
    return { statusCode: res.statusCode, body, raw: res.body };
  }

  it('refuses an inactive channel the Organization is assigned to with 422 ORDER_SALES_CHANNEL_NOT_ALLOWED', async () => {
    const ordersBefore = await h.em().count(Order, { salesChannelId: inactive.id });
    const res = await create(inactive.id, inactive.soldHereId);
    expect(res.statusCode, res.raw).toBe(422);
    expect(res.body.error?.code).toBe(ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED);
    expect(await h.em().count(Order, { salesChannelId: inactive.id })).toBe(ordersBefore);
  });

  it('lets the body channel win over a conflicting X-Sales-Channel header', async () => {
    const res = await create(probe.id, probe.soldHereId, { 'x-sales-channel': defaultCode });
    expect(res.statusCode, res.raw).toBe(201);
    const order = await h.em().findOne(Order, { id: res.body.data!.id });
    expect(order?.salesChannelId).toBe(probe.id);
  });

  it('still refuses the product the body channel lacks when the header names a channel that sells it', async () => {
    const res = await create(probe.id, probe.notSoldHereId, { 'x-sales-channel': 'pl_retail' });
    expect(res.statusCode, res.raw).toBe(404);
    expect(res.body.error?.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  });

  it('does not let a buyer name the assortment channel through the cart route body', async () => {
    // probe sells only soldHereId; the default channel (no header) does not.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: BUYER,
      headers: { 'content-type': 'application/json' },
      payload: { productId: probe.soldHereId, quantity: 1, salesChannelId: probe.id },
    });
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_NOT_FOUND,
    );
  });
});
