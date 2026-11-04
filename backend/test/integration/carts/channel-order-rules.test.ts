import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart } from '../../helpers/package-entities.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 163, Phase 12 (T082, US10 #1, FR-100; research R26) — the minimum order
 * quantity is the **channel's**: a `product_channel_scopes.min_order_quantity`
 * override replaces the global value in that channel only, and every feature-155
 * seam judges the basket's, the order's or the request's channel.
 *
 * - P: no global minimum; the B2B channel (`pl_retail` here) says 10. Adding 5 is
 *   refused in B2B and accepted in the other channel (the system default, "B2C").
 * - Q: global minimum 10; the B2C channel says 1 ("no minimum here"). Adding 5 is
 *   accepted in B2C and refused in B2B.
 * - The storefront product detail and listing carry the channel's minimum.
 * - The checkout preview and placement judge the order's channel; quote requests
 *   the request's channel; the quick-order import the buyer's channel.
 *
 * Every channel row this file writes is removed in `afterAll`.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const PLACEMENT = {
  deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
  billingAddressId: SEED_ADDRESS_BILLING_ID,
  deliveryMethodId: SEED_DELIVERY_METHOD_ID,
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
};

describe('163 — order rules per channel: the minimum (T082) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let b2b: { id: string; code: string };
  let b2c: { id: string; code: string };
  let P: MinimumProductFixture;
  let Q: MinimumProductFixture;
  let R: MinimumProductFixture;

  const conn = () => h.em().getConnection();

  /**
   * The channel's own minimum, or `null` = the channel inherits the Global one. Feature 172
   * (data-model §4): an own value carries `min_order_quantity_overridden`; an inheriting row
   * carries neither.
   */
  async function setChannelMinimum(productId: string, channelId: string, minimum: number | null): Promise<void> {
    await conn().execute(
      `insert into product_channel_scopes (product_id, sales_channel_id, min_order_quantity, min_order_quantity_overridden, created_at, updated_at)
       values (?, ?, ?, ?, now(), now())
       on conflict (product_id, sales_channel_id) do update set min_order_quantity = excluded.min_order_quantity,
         min_order_quantity_overridden = excluded.min_order_quantity_overridden, updated_at = now()`,
      [productId, channelId, minimum, minimum !== null],
    );
  }

  const anonBasket = () => ({ b2b_cart_anon: `anon-163-rules-${randomUUID()}` });
  const add = (channel: { code: string }, cookies: Record<string, string>, productId: string, quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { 'x-sales-channel': channel.code, 'content-type': 'application/json', 'accept-language': 'en' },
      payload: { productId, quantity },
    });

  const completeActiveBaskets = () =>
    conn().execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
      TEST_CUSTOMER_ID,
    ]);

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await em.find(SalesChannel, { id: { $in: await buyerChannelIds(em) } });
    const retail = channels.find((c) => c.code === 'pl_retail');
    const fallback = channels.find((c) => c.systemDefault);
    if (!retail || !fallback || retail.id === fallback.id) throw new Error('the two buyer channels are not seeded');
    b2b = { id: retail.id, code: retail.code };
    b2c = { id: fallback.id, code: fallback.code };
    const ids = [b2b.id, b2c.id];
    P = await createMinimumProduct(em, { sku: `R163-P-${RUN}`, nameEn: `P ${RUN}`, namePl: `P ${RUN}`, channelIds: ids });
    Q = await createMinimumProduct(em, {
      sku: `R163-Q-${RUN}`,
      nameEn: `Q ${RUN}`,
      namePl: `Q ${RUN}`,
      minOrderQuantity: 10,
      channelIds: ids,
    });
    R = await createMinimumProduct(em, { sku: `R163-R-${RUN}`, nameEn: `R ${RUN}`, namePl: `R ${RUN}`, channelIds: ids });
    await setChannelMinimum(P.id, b2b.id, 10);
    await setChannelMinimum(Q.id, b2c.id, 1);
  }, 60_000);

  beforeEach(async () => {
    await completeActiveBaskets();
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await conn().execute(`delete from product_channel_scopes where product_id = any(?::uuid[])`, [
      `{${[P, Q, R].filter(Boolean).map((p) => p.id).join(',')}}`,
    ]);
    await teardownBackendServer(h);
  });

  describe('the basket (US10 #1)', () => {
    it('P × 5: refused in B2B with its minimum of 10, accepted in B2C', async () => {
      const refused = await add(b2b, anonBasket(), P.id, 5);
      expect(refused.statusCode, refused.body).toBe(422);
      const error = (refused.json() as { error: { code: string; details: Record<string, unknown> } }).error;
      expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      expect(error.details).toMatchObject({ productId: P.id, minimum: 10, total: 5 });
      expect((await add(b2c, anonBasket(), P.id, 5)).statusCode).toBe(200);
    });

    it('Q × 5: the B2C override of 1 beats the global 10; B2B keeps the global minimum', async () => {
      expect((await add(b2c, anonBasket(), Q.id, 5)).statusCode).toBe(200);
      expect((await add(b2b, anonBasket(), Q.id, 5)).statusCode).toBe(422);
    });

    it('the basket view reports the channel’s minimum on the line', async () => {
      const cookies = anonBasket();
      expect((await add(b2b, cookies, P.id, 12)).statusCode).toBe(200);
      const view = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies, headers: { 'x-sales-channel': b2b.code } });
      const items = (view.json() as { data: { items: Array<{ productId: string; minOrderQuantity: number | null }> } }).data.items;
      expect(items.find((i) => i.productId === P.id)?.minOrderQuantity).toBe(10);
    });

    it('the quick-order batch into the basket judges the basket’s channel', async () => {
      // `/quick-order/build` is the signed-in buyer's, on the system-default channel ("B2C").
      const build = async () => {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/quick-order/build',
          cookies: CUSTOMER,
          payload: { target: 'cart', items: [{ productId: R.id, quantity: 5 }] },
        });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: { rejected: Array<{ reason: string }> } }).data.rejected;
      };
      // A minimum in B2B does not reach the B2C basket …
      await setChannelMinimum(R.id, b2b.id, 10);
      try {
        expect(await build()).toEqual([]);
        await completeActiveBaskets();
        // … B2C's own does.
        await setChannelMinimum(R.id, b2c.id, 10);
        expect(await build()).toEqual([expect.objectContaining({ reason: 'below_minimum' })]);
      } finally {
        await setChannelMinimum(R.id, b2b.id, null);
        await setChannelMinimum(R.id, b2c.id, null);
      }
    });
  });

  describe('the storefront read model', () => {
    it('the product detail carries the channel’s minimum', async () => {
      const read = (channel: { code: string }, id: string) =>
        h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${id}`, headers: { 'x-sales-channel': channel.code } });
      const minimum = (res: { json(): unknown }) => (res.json() as { data: { minOrderQuantity: number | null } }).data.minOrderQuantity;
      expect(minimum(await read(b2b, P.id))).toBe(10);
      expect(minimum(await read(b2c, P.id))).toBeNull();
      expect(minimum(await read(b2c, Q.id))).toBe(1);
      expect(minimum(await read(b2b, Q.id))).toBe(10);
    });

    it('the listing carries the channel’s minimum', async () => {
      const list = async (channel: { code: string }) => {
        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/catalog/products?q=${encodeURIComponent(`R163-P-${RUN}`)}&limit=10`,
          headers: { 'x-sales-channel': channel.code },
        });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: Array<{ id: string; minOrderQuantity: number | null }> }).data.find((p) => p.id === P.id);
      };
      expect((await list(b2b))?.minOrderQuantity).toBe(10);
      expect((await list(b2c))?.minOrderQuantity).toBeNull();
    });
  });

  describe('placement, the checkout preview and quote requests use their own channel', () => {
    /** The customer's basket on the system-default channel ("B2C"), written as a reorder writes it. */
    const seedCustomerBasket = (productId: string, quantity: number) =>
      cartWritePortOf(h).replaceItemsForCustomer(
        { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID, salesChannelId: b2c.id },
        [{ productId, quantity, unitPrice: '10.00', currency: 'PLN' }],
      );
    const preview = async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders/preview-total',
        cookies: CUSTOMER,
        payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { belowMinimumLines: Array<{ productId: string; minimum?: number }> } }).data
        .belowMinimumLines;
    };

    it('a minimum in another channel does not apply; the order channel’s does, at preview and at placement', async () => {
      await setChannelMinimum(R.id, b2b.id, 10);
      await seedCustomerBasket(R.id, 5);
      expect(await preview()).toEqual([]);

      await setChannelMinimum(R.id, b2c.id, 10);
      expect(await preview()).toEqual([expect.objectContaining({ productId: R.id, minimum: 10 })]);
      const placed = await h.app.inject({ method: 'POST', url: '/api/v1/orders', cookies: CUSTOMER, payload: PLACEMENT });
      expect(placed.statusCode, placed.body).toBe(422);
      expect((placed.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      const em = h.em();
      em.clear();
      expect(await em.count(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false })).toBe(1);
      await setChannelMinimum(R.id, b2c.id, null);
    });

    it('a quote request is judged on its channel', async () => {
      const create = () =>
        h.app.inject({ method: 'POST', url: '/api/v1/quote-requests', cookies: CUSTOMER, payload: { items: [{ productId: P.id, quantity: 5 }] } });
      // The customer's requests are raised on the system-default channel, where P has no minimum.
      expect((await create()).statusCode).toBe(201);
      await setChannelMinimum(P.id, b2c.id, 10);
      try {
        const refused = await create();
        expect(refused.statusCode, refused.body).toBe(422);
        expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      } finally {
        await setChannelMinimum(P.id, b2c.id, null);
      }
    });

    it('the quick-order import flags a row below the buyer channel’s minimum', async () => {
      const importCsv = async (channel: { code: string }) => {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/quick-order/import',
          cookies: CUSTOMER,
          headers: { 'x-sales-channel': channel.code },
          payload: { csv: `sku,quantity\nR163-P-${RUN},5` },
        });
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: { rejected: Array<{ reason: string; minimum?: number }> } }).data.rejected;
      };
      expect(await importCsv(b2c)).toEqual([]);
      await setChannelMinimum(P.id, b2c.id, 10);
      try {
        expect(await importCsv(b2c)).toEqual([expect.objectContaining({ reason: 'below_minimum', minimum: 10 })]);
      } finally {
        await setChannelMinimum(P.id, b2c.id, null);
      }
    });
  });
});
