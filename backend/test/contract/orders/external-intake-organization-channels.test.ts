import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { addOrganizationChannels } from '../../helpers/sales-channel-access.js';
import { Cart, CartItem, Order } from '../../helpers/package-entities.js';

/**
 * Issue #699 — an API-key order lands on one of the bound Organization's
 * **active assigned** sales channels, the rule the admin order create (#515)
 * and the quote request (#473) already follow, with the same refusal:
 * `422 ORDER_SALES_CHANNEL_NOT_ALLOWED`. It is asked at placement, because the
 * assignment can change after the key is issued, and before the service
 * account's basket is replaced, so a refusal writes nothing.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const CODE = 'ext-org-channels-699';

describe('POST /api/v1/external/orders — the bound Organization’s channels (#699)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let token: string;

  const payload = () => ({
    lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 1 }],
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
  });

  const place = () =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      payload: payload(),
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `org-ch-${randomUUID()}` },
    });

  /** What a placement writes: orders on the channel, and the service account's basket lines there. */
  const written = async (): Promise<{ orders: number; basketLines: number }> => {
    const em = h.em().fork({ clear: true });
    const orders = await em.count(Order, { salesChannelId: channelId });
    const carts = await em.find(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: channelId,
    });
    const basketLines =
      carts.length === 0 ? 0 : await em.count(CartItem, { cartId: { $in: carts.map((c) => c.id) } });
    return { orders, basketLines };
  };

  const expectRefusedWithNothingWritten = async (
    status: number = 422,
    code: string = ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED,
  ) => {
    const before = await written();
    const res = await place();
    expect(res.statusCode, res.body).toBe(status);
    expect((res.json() as { error: { code: string } }).error.code).toBe(code);
    expect(await written()).toEqual(before);
  };

  const setChannelActive = async (active: boolean) => {
    const em = h.em().fork();
    const channel = await em.findOneOrFail(SalesChannel, { id: channelId });
    channel.active = active;
    await em.flush();
    await h.salesChannels.cache.invalidate(CODE);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: CODE,
      name: { 'en-US': 'Organization channels (#699)' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    await em.persistAndFlush(channel);
    channelId = channel.id;
    await h.salesChannels.cache.invalidate(CODE);
    await em.getConnection().execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`,
      [channelId, SEED_PRODUCT_101_ID],
    );
    await seedPriceBookSql(em, {
      name: 'Org A intake (#699)',
      audience: { organizations: [TEST_ORGANIZATION_ID] },
      rows: [{ productId: SEED_PRODUCT_101_ID, fixed: '100.00' }],
    });

    // The key is bound to a channel the Organization is NOT assigned to.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN_COOKIE,
      payload: {
        name: 'Intake key (#699)',
        scopes: ['orders:read', 'orders:write'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: channelId,
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    token = (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a channel the Organization is not assigned to, and writes nothing', async () => {
    await expectRefusedWithNothingWritten();
  });

  it('places the order once the Organization is assigned to the channel', async () => {
    await addOrganizationChannels(h, TEST_ORGANIZATION_ID, [CODE]);
    const res = await place();
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { data: { salesChannelId: string } }).data.salesChannelId).toBe(channelId);
  });

  it('refuses an assigned channel that has been deactivated', async () => {
    // The request's channel resolution refuses a bound channel that is
    // inactive before the intake runs (`distributor_api/channel-pinning`), so
    // this answer is that one; the gate's own `active` test stands behind it.
    await setChannelActive(false);
    try {
      await expectRefusedWithNothingWritten(400, ERROR_CODES.INACTIVE_SALES_CHANNEL);
    } finally {
      await setChannelActive(true);
    }
  });

  it('refuses once the channel is unassigned after the key was issued', async () => {
    await h.salesChannels.membershipService.removeFromChannel(
      channelId,
      'organization',
      TEST_ORGANIZATION_ID,
    );
    await expectRefusedWithNothingWritten();
  });
});
