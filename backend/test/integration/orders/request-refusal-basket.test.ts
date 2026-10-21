import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CartWritePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, PriceDisplayModeOverride, Product } from '../../helpers/package-entities.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155 (D1, D3/D4) — what a request refused for a minimum leaves behind,
 * and the language it names the product in, on the two order paths that build
 * a basket from a request: admin create-order and the API order intake.
 *
 * - **D1.** The refusal is a whole-request refusal (FR-009, US4 #6), and the
 *   customer's own basket is not the request: it comes through untouched — not
 *   cleared, not partly re-seeded with the lines that passed.
 * - **D3/D4.** The product is named in the language the sentence is written in:
 *   for an admin, the stored preference whatever the browser sends (D-132); for
 *   an API client, the q-weighted `Accept-Language`.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CTX = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
/** The buyer's basket of the system-default channel (`specs/154-sales-channel-access/`). */
let BASKET_CTX: typeof CTX & { salesChannelId: string };
const PL_SENTENCE = (name: string) => `Minimalna ilość zamówienia produktu „${name}” to 10 szt.`;
const EN_SENTENCE = (name: string) => `"${name}" has a minimum order quantity of 10 pcs.`;

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('155 — a refused order request leaves the basket alone and names the product in the sentence language [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelId = '';
  let token = '';
  let A: MinimumProductFixture;
  let D: MinimumProductFixture;
  let K: MinimumProductFixture;
  /** Visible and sold, but with no price: refused at the write step (`CART_PRODUCT_UNPRICED`). */
  let U: MinimumProductFixture;
  /** Visible, sold and priced, but quote-only (`displayMode: 'none'`): refused at the write step. */
  let Q: MinimumProductFixture;

  const write = () => (h.container.cradle as unknown as { cartWritePort: CartWritePort }).cartWritePort;

  /** The customer's basket: every line of every cart of theirs that is still active. */
  const basket = async () => {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ product_id: string; quantity: number }>>(
        `select ci.product_id, ci.quantity from cart_items ci join carts c on c.id = ci.cart_id
          where c.customer_account_id = ? and c.status = 'active'`,
        [TEST_CUSTOMER_ID],
      );
    return rows.map((r) => `${r.product_id}:${r.quantity}`).sort();
  };

  const seedBasket = async () => {
    await write().replaceItemsForCustomer(BASKET_CTX, [
      { productId: K.id, quantity: 3, unitPrice: '10.00', currency: 'PLN' },
    ]);
    const before = await basket();
    expect(before).toEqual([`${K.id}:3`]);
    return before;
  };

  const adminCreate = (items: Array<{ productId: string; quantity: number }>, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN,
      headers,
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

  const intake = (lines: Array<{ sku: string; quantity: number }>, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `moq-${randomUUID()}`, ...headers },
      payload: {
        lines,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });

  const errorOf = (res: { json: () => unknown }) => (res.json() as ErrorBody).error;

  const setAdminLanguage = async (value: 'pl' | 'en' | null) => {
    const em = h.em();
    em.clear();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    BASKET_CTX = { ...CTX, salesChannelId: await systemDefaultSalesChannelId(h.em()) };
    const em = h.em();
    channelId = await systemDefaultSalesChannelId(em);
    const channels = Array.from(new Set([channelId, ...(await buyerChannelIds(em))]));
    A = await createMinimumProduct(em, {
      sku: `RRB-A-${RUN}`,
      nameEn: `Anchor ${RUN}`,
      namePl: `Kotwa ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    D = await createMinimumProduct(em, { sku: `RRB-D-${RUN}`, nameEn: `Dowel ${RUN}`, namePl: `Kołek ${RUN}`, channelIds: channels });
    K = await createMinimumProduct(em, { sku: `RRB-K-${RUN}`, nameEn: `Keep ${RUN}`, namePl: `Zachowaj ${RUN}`, channelIds: channels });
    U = await createMinimumProduct(em, { sku: `RRB-U-${RUN}`, nameEn: `Unpriced ${RUN}`, namePl: `Bez ceny ${RUN}`, channelIds: channels });
    Q = await createMinimumProduct(em, { sku: `RRB-Q-${RUN}`, nameEn: `On request ${RUN}`, namePl: `Na zapytanie ${RUN}`, channelIds: channels });
    await em.nativeUpdate(Product, { id: { $in: [A.id, D.id, K.id, U.id, Q.id] } }, { manageStock: false });
    await em.nativeUpdate(Product, { id: U.id }, { attributeValues: {} });
    // Feature 160 — unpriced means no base-book row (the fixture writes one).
    await em.getConnection().execute(`delete from "price_list_matrix_entries" where "product_id" = ?`, [U.id]);
    em.create(PriceDisplayModeOverride, { scope: 'product', targetId: Q.id, mode: 'none' });
    await em.flush();

    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN,
      payload: {
        name: `Refusal basket ${RUN}`,
        scopes: ['orders:read', 'orders:write'],
        binding: { organizationId: TEST_ORGANIZATION_ID, salesChannelId: channelId, customerAccountId: TEST_CUSTOMER_ID },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    token = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  }, 180_000);

  afterAll(async () => {
    await setAdminLanguage(null);
    await teardownBackendServer(h);
  });

  describe('D1 — the basket comes through a refusal untouched', () => {
    it('admin create: K × 3 in the basket, D × 2 + A × 5 (minimum 10) refused 422, the basket is still K × 3', async () => {
      const before = await seedBasket();
      const res = await adminCreate([
        { productId: D.id, quantity: 2 },
        { productId: A.id, quantity: 5 },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      expect(errorOf(res).details).toMatchObject({ productId: A.id, total: 5, lines: [{ index: 1 }] });
      expect(await basket()).toEqual(before);
    });

    it('admin create: an unknown product is refused 404 and the basket is still K × 3', async () => {
      const before = await seedBasket();
      const res = await adminCreate([
        { productId: D.id, quantity: 2 },
        { productId: randomUUID(), quantity: 5 },
      ]);
      expect(res.statusCode, res.body).toBe(404);
      expect(await basket()).toEqual(before);
    });

    it('API intake: K × 3 in the basket, D × 2 + A × 5 (minimum 10) refused 422, the basket is still K × 3', async () => {
      const before = await seedBasket();
      const res = await intake([
        { sku: D.sku, quantity: 2 },
        { sku: A.sku, quantity: 5 },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      expect(errorOf(res).details).toMatchObject({ productId: A.id, total: 5, lines: [{ index: 1 }] });
      expect(await basket()).toEqual(before);
    });

    /**
     * Round B, item 3 — a refusal raised by the write step (here: no price) used
     * to arrive after the basket had been cleared and D written, leaving the
     * customer a basket of D × 2. The write step's refusals are judged before
     * the basket is replaced now.
     */
    it('admin create: D × 2 + an unpriced U × 1 is refused and the basket is still K × 3', async () => {
      const before = await seedBasket();
      const res = await adminCreate([
        { productId: D.id, quantity: 2 },
        { productId: U.id, quantity: 1 },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).code).toBe(ERROR_CODES.CART_PRODUCT_UNPRICED);
      expect(await basket()).toEqual(before);
    });

    it('API intake: D × 2 + a quote-only Q × 1 is refused and the basket is still K × 3', async () => {
      const before = await seedBasket();
      const res = await intake([
        { sku: D.sku, quantity: 2 },
        { sku: Q.sku, quantity: 1 },
      ]);
      expect(res.statusCode, res.body).toBe(400);
      expect(errorOf(res).code).toBe(ERROR_CODES.CART_PRODUCT_QUOTE_ONLY);
      expect(await basket()).toEqual(before);
    });

    it('the basket being replaced does not count: K-less A × 7 in the basket does not carry an admin A × 5', async () => {
      await write().replaceItemsForCustomer(BASKET_CTX, [{ productId: A.id, quantity: 7, unitPrice: '10.00', currency: 'PLN' }]);
      const before = await basket();
      const res = await adminCreate([{ productId: A.id, quantity: 5 }]);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).details).toMatchObject({ total: 5 });
      expect(await basket()).toEqual(before);
    });
  });

  describe('D3/D4 — the product is named in the language of the sentence', () => {
    it('admin create: an admin whose stored language is English, sending Accept-Language: pl, reads English with the English name', async () => {
      await setAdminLanguage('en');
      const res = await adminCreate([{ productId: A.id, quantity: 5 }], { 'accept-language': 'pl' });
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).message).toBe(EN_SENTENCE(A.nameEn));
      expect(errorOf(res).details).toMatchObject({ productName: A.nameEn });
    });

    it('admin create: an admin whose stored language is Polish, sending no header, reads Polish with the Polish name', async () => {
      await setAdminLanguage('pl');
      const res = await adminCreate([{ productId: A.id, quantity: 5 }]);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).message).toBe(PL_SENTENCE(A.namePl));
      expect(errorOf(res).details).toMatchObject({ productName: A.namePl });
      await setAdminLanguage(null);
    });

    it('API intake: Accept-Language `en;q=0.2,pl;q=0.9` reads Polish with the Polish name', async () => {
      const res = await intake([{ sku: A.sku, quantity: 5 }], { 'accept-language': 'en;q=0.2,pl;q=0.9' });
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).message).toBe(PL_SENTENCE(A.namePl));
      expect(errorOf(res).details).toMatchObject({ productName: A.namePl });
    });
  });
});
