import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
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
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Cart, Organization } from '../../helpers/package-entities.js';

/**
 * The two method gates of order placement, **together**.
 *
 * A delivery or payment method can be withheld from an order for two unrelated
 * reasons, each with a gate and a test file of its own:
 *
 *   - the buyer's Organization is restricted to a list that does not contain it
 *     (`place-order-organization-method-allow-list.test.ts`);
 *   - the method is not offered on the order's sales channel
 *     (`place-order-method-channel.test.ts`).
 *
 * Each of those files proves one gate with the other standing open. This one
 * holds the pair, because two gates on one request have an **order**, and the
 * order is observable: it decides which `details.code` a method that fails both
 * reports, and whether a refusal by the second gate still arrives before
 * anything is written. The order is allow-list first, then the channel:
 *
 *   | allow-list | channel     | answer                                     |
 *   | ---------- | ----------- | ------------------------------------------ |
 *   | excludes   | not offered | 400, `…_not_allowed_for_organization`      |
 *   | allows     | not offered | 400, `…_not_in_sales_channel`              |
 *   | allows     | offered     | placed                                     |
 *
 * on every surface that places or previews an order — the storefront route and
 * its preview, admin order creation and its preview, and the API-key intake —
 * and for the delivery method and the payment method separately. After every
 * refusal the customer's basket is the same rows it was before: admin creation
 * and the intake replace the basket before they place, so a refusal that came
 * late would leave the operator's or the integration's lines in it.
 *
 * Fixture. Channel A is the system default and channel B a second one; one
 * delivery and one payment method are offered on B only. The harness's seeded
 * methods carry no channel assignment and are offered everywhere. The API key
 * is bound to a third channel that publishes the product, so for the intake
 * "the order's channel" is that one — which the B-only methods are not offered
 * on either.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

type Res = { statusCode: number; body: string; json: () => unknown };
type Methods = { deliveryMethodId: string; paymentMethodId: string };

describe('order placement — the Organization allow-list and the channel gate together', () => {
  let h: BackendServerHandle;
  let channelA: { id: string; code: string };
  let deliveryOnlyB: string;
  let paymentOnlyB: string;
  let intakeToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const systemDefault = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    channelA = { id: systemDefault.id, code: systemDefault.code };

    const createChannel = async (code: string): Promise<string> => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/sales-channels',
        cookies: ADMIN,
        payload: {
          code,
          name: { 'en-US': code },
          languages: ['en-US'],
          defaultLanguage: 'en-US',
          currencies: ['PLN'],
          defaultCurrency: 'PLN',
          active: true,
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      return (created.json() as { id: string }).id;
    };
    const channelBId = await createChannel('gates-combined-b');
    const intakeChannelId = await createChannel('gates-combined-intake');

    const delivery = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/gates_delivery_only_b',
      cookies: ADMIN,
      payload: {
        code: 'gates_delivery_only_b',
        name: { 'en-US': 'Only on B' },
        cost: 0,
        currency: 'PLN',
        adapter: 'manual_courier',
        salesChannelIds: [channelBId],
      },
    });
    expect(delivery.statusCode, delivery.body).toBe(200);
    deliveryOnlyB = (delivery.json() as { data: { id: string } }).data.id;

    const payment = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/payment-methods/gates_payment_only_b',
      cookies: ADMIN,
      payload: {
        name: { 'en-US': 'Only on B' },
        kind: 'bank_transfer',
        adapter: 'bank_transfer',
        salesChannelIds: [channelBId],
      },
    });
    expect(payment.statusCode, payment.body).toBe(200);
    paymentOnlyB = (payment.json() as { data: { id: string } }).data.id;

    // The intake checks the bound channel's assortment for its lines.
    await em
      .getConnection()
      .execute('insert into sales_channel_products (sales_channel_id, product_id) values (?,?)', [
        intakeChannelId,
        SEED_PRODUCT_101_ID,
      ]);
    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: 'Combined gates intake key',
        scopes: ['orders:read', 'orders:write'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: intakeChannelId,
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    intakeToken = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterEach(async () => {
    // No file after this one may inherit a restricted Organization.
    await restrict({ deliveryMethodIds: [], paymentMethodIds: [] });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** The Organization's two method allow-lists, written the way the admin screen writes them. */
  async function restrict(lists: {
    deliveryMethodIds: string[];
    paymentMethodIds: string[];
  }): Promise<void> {
    const em = h.em();
    em.clear();
    const organization = await em.findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    await h.organizations.restrictionService.replaceAllowLists(TEST_ORGANIZATION_ID, {
      expectedVersion: organization.version,
      ...lists,
      warehouseIds: [],
    });
  }

  async function freshBasket(): Promise<void> {
    const em = h.em();
    em.clear();
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    await seedCartForStubCustomer(em);
  }

  /** The customer's baskets and their lines, as whole rows. */
  async function basketRows(): Promise<string> {
    const connection = h.em().getConnection();
    const carts = await connection.execute(
      'select to_jsonb(c) as row from carts c where customer_account_id = ? order by id',
      [TEST_CUSTOMER_ID],
    );
    const items = await connection.execute(
      'select to_jsonb(i) as row from cart_items i join carts c on c.id = i.cart_id ' +
        'where c.customer_account_id = ? order by i.id',
      [TEST_CUSTOMER_ID],
    );
    return JSON.stringify({ carts, items });
  }

  /** Every surface that places or previews an order, with the same two methods. */
  function surfaces(methods: Methods): Record<string, () => Promise<Res>> {
    return {
      'POST /api/v1/orders': () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/orders',
          cookies: BUYER,
          payload: {
            deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
            billingAddressId: SEED_ADDRESS_BILLING_ID,
            ...methods,
          },
        }),
      'POST /api/v1/orders/preview-total': () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/orders/preview-total',
          cookies: BUYER,
          payload: { billingAddressId: SEED_ADDRESS_BILLING_ID, ...methods },
        }),
      'POST /api/v1/admin/orders': () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/orders',
          cookies: ADMIN,
          payload: {
            customerAccountId: TEST_CUSTOMER_ID,
            salesChannelId: channelA.id,
            // Not the basket's own line: a late refusal would leave this one behind.
            items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }],
            deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
            billingAddressId: SEED_ADDRESS_BILLING_ID,
            ...methods,
          },
        }),
      'POST /api/v1/admin/orders/preview': () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/orders/preview',
          cookies: ADMIN,
          payload: {
            customerAccountId: TEST_CUSTOMER_ID,
            salesChannelId: channelA.id,
            items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
            ...methods,
          },
        }),
      'POST /api/v1/external/orders': () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/external/orders',
          headers: {
            authorization: `Bearer ${intakeToken}`,
            'idempotency-key': `gates-${randomUUID()}`,
          },
          payload: {
            lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 7 }],
            deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
            billingAddressId: SEED_ADDRESS_BILLING_ID,
            ...methods,
          },
        }),
    };
  }

  function detailsCode(res: Res): string | undefined {
    return (res.json() as { error?: { details?: { code?: string } } }).error?.details?.code;
  }

  /** One kind at a time: the method under test is B-only, the other is the seeded one. */
  const KINDS = [
    {
      kind: 'delivery',
      methods: (): Methods => ({
        deliveryMethodId: deliveryOnlyB,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      }),
    },
    {
      kind: 'payment',
      methods: (): Methods => ({
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: paymentOnlyB,
      }),
    },
  ] as const;

  async function expectRefusedEverywhere(methods: Methods, code: string): Promise<void> {
    for (const [surface, call] of Object.entries(surfaces(methods))) {
      await freshBasket();
      const before = await basketRows();

      const res = await call();

      expect(res.statusCode, `${surface}: ${res.body}`).toBe(400);
      expect(detailsCode(res), surface).toBe(code);
      expect(await basketRows(), `${surface}: the basket changed`).toBe(before);
    }
  }

  describe.each(KINDS)('a $kind method', ({ kind, methods }) => {
    it('outside the allow-list and not offered on the channel is refused with the allow-list code', async () => {
      // The lists hold the seeded methods only, so the B-only one fails both gates.
      await restrict({
        deliveryMethodIds: [SEED_DELIVERY_METHOD_ID],
        paymentMethodIds: [SEED_PAYMENT_METHOD_ID],
      });

      await expectRefusedEverywhere(methods(), `${kind}_method_not_allowed_for_organization`);
    });

    it('on the allow-list but not offered on the channel is refused with the channel code', async () => {
      await restrict({
        deliveryMethodIds: [SEED_DELIVERY_METHOD_ID, deliveryOnlyB],
        paymentMethodIds: [SEED_PAYMENT_METHOD_ID, paymentOnlyB],
      });

      await expectRefusedEverywhere(methods(), `${kind}_method_not_in_sales_channel`);
    });

    it('with no allow-list at all and not offered on the channel is refused with the channel code', async () => {
      await restrict({ deliveryMethodIds: [], paymentMethodIds: [] });

      await expectRefusedEverywhere(methods(), `${kind}_method_not_in_sales_channel`);
    });
  });

  /**
   * The control for everything above: the same surfaces, the same requests, a
   * pair of methods neither gate withholds — once with no allow-list and once
   * with a list that names them. Without it the refusals could be a placement
   * that is broken for another reason.
   */
  it.each([
    { name: 'no allow-list', lists: { deliveryMethodIds: [], paymentMethodIds: [] } },
    {
      name: 'an allow-list that names them',
      lists: {
        deliveryMethodIds: [SEED_DELIVERY_METHOD_ID],
        paymentMethodIds: [SEED_PAYMENT_METHOD_ID],
      },
    },
  ])('places and previews with methods neither gate withholds — $name', async ({ lists }) => {
    await restrict(lists);

    const allowed = {
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
    };
    for (const [surface, call] of Object.entries(surfaces(allowed))) {
      await freshBasket();

      const res = await call();

      expect(res.statusCode, `${surface}: ${res.body}`).toBeLessThan(300);
    }
  });
});
