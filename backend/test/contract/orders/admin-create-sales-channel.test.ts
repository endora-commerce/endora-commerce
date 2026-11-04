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
  seedCartForStubCustomer,
} from '../../helpers/seed-commerce.js';
import {
  seedProbeChannelAssortment,
  type ChannelAssortment,
} from '../../helpers/channel-assortment-fixture.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Cart, CartItem, Order, StockLevel } from '../../helpers/package-entities.js';

/**
 * `POST /api/v1/admin/orders` — the channel the operator chose is the channel
 * that decides.
 *
 * ## The two defects this file was written to observe
 *
 * 1. The customer's basket is seeded through `CartService.addItem`, whose
 *    assortment gate read the **request's** resolved channel. An admin request
 *    names no storefront channel, so it resolved the system default, and an
 *    order for channel B had its products judged against the default channel:
 *    a product B sells and the default does not was refused, and a product the
 *    default sells and B does not was accepted.
 * 2. A `salesChannelId` naming no channel was accepted: placement fell back to
 *    the system default and answered 201 on a channel nobody chose. It was
 *    refused `404 NOT_FOUND` from then on, and since issue #515 with `422
 *    ORDER_SALES_CHANNEL_NOT_ALLOWED` — the answer for every channel that is not
 *    one of the customer's Organization's active channels, so the refusal does
 *    not tell which ids exist.
 *
 * The probe channel sells `soldHereId` only. `beforeAll` removes that product
 * from the system-default channel, so the two products separate the channels:
 * one is on B and not on the default, the other on the default and not on B.
 * The tables are reseeded per file, so the removal does not leak. The commerce
 * seed stocks only the other product, so `soldHereId` gets stock of its own
 * in the seed's warehouse — placement would otherwise refuse it for stock.
 */
describe('POST /api/v1/admin/orders — the order\'s sales channel decides', () => {
  let h: BackendServerHandle;
  let probe: ChannelAssortment;

  const ADMIN = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    probe = await seedProbeChannelAssortment(h.em(), 'admin-create-assortment');
    const defaultId = await systemDefaultSalesChannelId(h.em());
    await h
      .em()
      .getConnection()
      .execute(
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

  async function create(salesChannelId: string, productId: string) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN,
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

  it('refuses a salesChannelId naming no channel with 422 ORDER_SALES_CHANNEL_NOT_ALLOWED, writing nothing', async () => {
    const em = h.em();
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    await seedCartForStubCustomer(em);
    const ordersBefore = await em.count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID });

    const res = await create('00000000-0000-4000-8000-00000000dead', probe.notSoldHereId);

    expect(res.statusCode, res.raw).toBe(422);
    expect(res.body.error?.code).toBe(ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED);

    const after = h.em();
    expect(await after.count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID })).toBe(
      ordersBefore,
    );
    // The customer's own basket is untouched: the refusal comes before the
    // basket is cleared and reseeded with the operator's lines.
    const cart = await after.findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    expect(cart).not.toBeNull();
    const items = await after.find(CartItem, { cartId: cart!.id });
    expect(items.map((i) => i.productId)).toEqual([probe.notSoldHereId]);
  });

  it('accepts a product the order\'s channel sells and the default channel does not', async () => {
    const res = await create(probe.id, probe.soldHereId);

    expect(res.statusCode, res.raw).toBe(201);
    const order = await h.em().findOne(Order, { id: res.body.data!.id });
    expect(order?.salesChannelId).toBe(probe.id);
  });

  it('refuses a product the default channel sells and the order\'s channel does not', async () => {
    const res = await create(probe.id, probe.notSoldHereId);

    expect(res.statusCode, res.raw).toBe(404);
    // The same answer as an unknown or restricted product, as on every other
    // acquisition seam.
    expect(res.body.error?.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  });
});
