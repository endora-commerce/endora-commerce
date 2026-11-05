import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { CustomerAccount, Product } from '../../helpers/package-entities.js';
import { assignOrganizationRole } from '../../helpers/seed-organization-roles.js';
import { seedRoleGranting } from '../../helpers/cart-approval-roles.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumPackagingUnit,
  createMinimumProduct,
  minimumFixtureRun,
  setProductMinimum,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { seedOtherTestCustomer } from '../../helpers/seed-organizations.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { acceptedQuoteRequest, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 155, owner ruling 2026-10-18 — a basket that cannot be ordered cannot be
 * sent for approval either.
 *
 * `POST /api/v1/cart/submit-for-approval` refuses a basket with a line below a
 * minimum the way placement does (`422 PRODUCT_BELOW_MINIMUM_QUANTITY`, every
 * flagged line in `details.lines` with its `cartItemId`), and the cart's
 * `approvalStatus` stays `not_required`. A basket that meets its minimums is
 * submitted as before.
 *
 * FR-039, `contracts/cart-and-checkout-api.md` §12 — the basket is judged as
 * placement judges it: a quote-seeded line keeps its exemption only once the
 * quote source is confirmed valid now (same Organization, `Approved`, not
 * expired, not yet ordered, an agreed line still present), and with
 * `quote_requests` off nothing is exempt. Scenarios 18 and 18a.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('155 — submit-for-approval refuses a basket below a minimum [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const MEMBER_ID = randomUUID();
  const COOKIE = `stub-148-approval-member-${RUN}`;
  const cookies = { b2b_session: COOKIE };
  let product: MinimumProductFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    product = await createMinimumProduct(em, {
      sku: `CAM-${RUN}`,
      nameEn: `Approval bolt ${RUN}`,
      namePl: `Śruba akceptacji ${RUN}`,
      channelIds: channels,
    });
    // Feature 174 (FR-030) — the Polish name is the pl_retail × pl-PL translation the basket reads.
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    await seedScopedValues(em, product.id, [
      { field: 'name', scope: { level: 'channel_language', channelId: retail.id, languageCode: 'pl-PL' }, value: product.namePl },
    ]);
    // An ordinary member: an Org Admin's own cart is exempt from approval.
    const member = em.create(CustomerAccount, {
      id: MEMBER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      email: `approval-member-${RUN}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Approval',
      lastName: 'Member',
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(member);
    // `specs/170-organization-roles/` WP-04 — the member's basket needs approval
    // because their role lacks `carts.order_without_approval` (R-4).
    await assignOrganizationRole(em, MEMBER_ID, await seedRoleGranting(em, TEST_ORGANIZATION_ID, ['carts.create']));
    CUSTOMER_COOKIES[COOKIE] = { customerAccountId: MEMBER_ID, organizationId: TEST_ORGANIZATION_ID };
  }, 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES[COOKIE];
    await teardownBackendServer(h);
  });

  async function cartView(): Promise<{ approvalStatus: string; items: Array<{ id: string; belowMinimum?: unknown }> }> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies, headers: CHANNEL });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { approvalStatus: string; items: Array<{ id: string }> } }).data;
  }

  async function submit() {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/submit-for-approval',
      cookies,
      headers: { ...CHANNEL, 'accept-language': 'en' },
    });
  }

  it('refuses a line below the pieces minimum with 422 and leaves the cart not_required', async () => {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId: product.id, quantity: 3 },
    });
    expect(add.statusCode, add.body).toBe(200);
    await setProductMinimum(h.em(), product.id, 10);

    const before = await cartView();
    expect(before.approvalStatus).toBe('not_required');
    const lineId = before.items[0]!.id;
    expect(before.items[0]!.belowMinimum).toMatchObject({ kind: 'pieces', minimum: 10 });

    const res = await submit();
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json() as { error: { code: string; details?: Record<string, unknown> } };
    expect(body.error.code).toBe('PRODUCT_BELOW_MINIMUM_QUANTITY');
    expect(body.error.details).toMatchObject({
      productId: product.id,
      minimum: 10,
      lines: [{ cartItemId: lineId, productId: product.id, kind: 'pieces', minimum: 10 }],
    });

    expect((await cartView()).approvalStatus).toBe('not_required');
  });

  it('submits the basket once the line meets its minimum', async () => {
    const lineId = (await cartView()).items[0]!.id;
    const edit = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${lineId}`,
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { quantity: 10 },
    });
    expect(edit.statusCode, edit.body).toBe(200);

    const res = await submit();
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { approvalStatus: string } }).data.approvalStatus).toBe('pending');
  });
  async function retireMemberCart(): Promise<void> {
    await h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        MEMBER_ID,
      ]);
  }

  async function errorOf(res: { json(): unknown }) {
    return (res.json() as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
  }

  it('PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY — a pallet line below its unit minimum is refused with the unit', async () => {
    await retireMemberCart();
    const palletName = `Pallet A ${RUN}`;
    const palletised = await createMinimumProduct(h.em(), {
      sku: `CAM-U-${RUN}`,
      nameEn: `Palletised ${RUN}`,
      namePl: `Paletowy ${RUN}`,
      channelIds: await buyerChannelIds(h.em()),
    });
    const pallet = await createMinimumPackagingUnit(h.em(), {
      productId: palletised.id,
      name: palletName,
      baseQuantity: 64,
      minOrderUnits: 2,
    });
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId: palletised.id, packagingUnitId: pallet, quantity: 2 },
    });
    expect(add.statusCode, add.body).toBe(200);
    const lineId = (await cartView()).items[0]!.id;
    // One pallet behind the cart's back: the basket a raised unit minimum leaves.
    await h.em().getConnection().execute(`update cart_items set quantity = 64 where id = ?`, [lineId]);

    const res = await submit();
    expect(res.statusCode, res.body).toBe(422);
    const error = await errorOf(res);
    expect(error.code).toBe('PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY');
    expect(error.details).toMatchObject({
      productId: palletised.id,
      packagingUnitName: palletName,
      minimum: 2,
      lines: [{ cartItemId: lineId, kind: 'packaging_unit', minimum: 2, packagingUnitName: palletName }],
    });
    expect((await cartView()).approvalStatus).toBe('not_required');
  });

  it('FR-037 — a line whose product record is gone is refused 404 PRODUCT_NOT_FOUND naming the cart lines, no name', async () => {
    await retireMemberCart();
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId: product.id, quantity: 10 },
    });
    expect(add.statusCode, add.body).toBe(200);
    const cartId = (add.json() as { data: { id: string } }).data.id;
    const ghostItemId = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into cart_items (id, cart_id, product_id, quantity, unit_price, currency, created_at, updated_at)
         values (?, ?, ?, 3, 10, 'PLN', now() + interval '1 second', now())`,
        [ghostItemId, cartId, randomUUID()],
      );

    const res = await submit();
    expect(res.statusCode, res.body).toBe(404);
    const error = await errorOf(res);
    expect(error.code).toBe('PRODUCT_NOT_FOUND');
    expect(error.details).toEqual({ cartItemIds: [ghostItemId] });
    expect(JSON.stringify(error)).not.toContain(product.nameEn);
    expect((await cartView()).approvalStatus).toBe('not_required');
  });

  it('answers in Polish when the request asks for it, naming the product in Polish', async () => {
    await retireMemberCart();
    await setProductMinimum(h.em(), product.id, null);
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId: product.id, quantity: 3 },
    });
    expect(add.statusCode, add.body).toBe(200);
    await setProductMinimum(h.em(), product.id, 10);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/submit-for-approval',
      cookies,
      headers: { ...CHANNEL, 'accept-language': 'pl' },
    });
    expect(res.statusCode, res.body).toBe(422);
    const error = await errorOf(res);
    expect(error.code).toBe('PRODUCT_BELOW_MINIMUM_QUANTITY');
    expect(error.message).toBe(`Minimalna ilość zamówienia produktu „${product.namePl}” to 10 szt.`);
    expect(error.details).toMatchObject({ productName: product.namePl, minimum: 10 });
  });

  /**
   * Scenario 18a — a basket seeded from an accepted quote with an exempt A × 5
   * (A minimum 10). Every quote is accepted for A × 5 at 11.25 before A's
   * minimum is set; the member's basket is seeded with the agreed line and the
   * quote's mark, as `quote_requests`' conversion seeds it.
   */
  describe('18a — a quote-seeded line is exempt only while its quote source is confirmed valid', () => {
    const A = SEED_PRODUCT_101_ID;
    const ORG_ADMIN = { b2b_session: 'stub-customer-session' };
    const OTHER_ORG_CUSTOMER = { b2b_session: 'stub-customer-session-other-org' };
    type QuoteKey = 'valid' | 'expired' | 'cancelled' | 'ordered' | 'offState';
    const quotes = {} as Record<QuoteKey, string>;
    let foreignQuote = '';
    let previousMinimumOfA: number | null = null;

    beforeAll(async () => {
      const em = h.em();
      await em.getConnection().execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [A]);
      await seedOtherTestCustomer(em);
      const a = await em.findOneOrFail(Product, { id: A }, { filters: false });
      previousMinimumOfA = a.minOrderQuantity ?? null;
      await setProductMinimum(em, A, null);
      for (const key of ['valid', 'expired', 'cancelled', 'ordered', 'offState'] as const) {
        quotes[key] = (await acceptedQuoteRequest(h, { quantity: 5, agreedUnitPrice: 11.25 }, ORG_ADMIN)).id;
      }
      foreignQuote = (await acceptedQuoteRequest(h, { quantity: 5, agreedUnitPrice: 11.25 }, OTHER_ORG_CUSTOMER)).id;

      // An Order already carries `ordered`: the administrator converts it and
      // checks out, then the request is put back to `Approved` — whatever its
      // status reads, an Order names it.
      await h
        .em()
        .getConnection()
        .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
          TEST_CUSTOMER_ID,
        ]);
      const converted = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${quotes.ordered}/convert-to-order`,
        cookies: ORG_ADMIN,
        payload: {},
      });
      expect(converted.statusCode, converted.body).toBe(200);
      const placed = await whenOrderCreatedSettled(h, () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/orders',
          cookies: ORG_ADMIN,
          payload: {
            deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
            billingAddressId: SEED_ADDRESS_BILLING_ID,
            deliveryMethodId: SEED_DELIVERY_METHOD_ID,
            paymentMethodId: SEED_PAYMENT_METHOD_ID,
          },
        }),
      );
      expect(placed.statusCode, placed.body).toBe(201);
      await h
        .em()
        .getConnection()
        .execute(
          `update "quote_requests" set "status" = 'Approved', "completed_at" = null, "converted_order_id" = null where "id" = ?`,
          [quotes.ordered],
        );

      await setProductMinimum(em, A, 10);
    }, 180_000);

    afterAll(async () => {
      await setProductMinimum(h.em(), A, previousMinimumOfA);
    });

    /** The member's basket: A × 5 at the agreed price, marked with `quoteRequestId`. */
    async function seedMemberBasket(quoteRequestId: string): Promise<string> {
      await retireMemberCart();
      await cartWritePortOf(h).replaceItemsForCustomer(
        {
          customerAccountId: MEMBER_ID,
          organizationId: TEST_ORGANIZATION_ID,
          // The basket of the channel the views below are read on.
          salesChannelId: await ensureSalesChannelId(h.em(), CHANNEL['x-sales-channel']),
        },
        [{ productId: A, quantity: 5, unitPrice: '11.25', currency: 'PLN' }],
        { sourceQuoteRequestId: quoteRequestId },
      );
      const view = await cartView();
      expect(view.approvalStatus).toBe('not_required');
      // The cart view trusts the mark (FR-028): the line is never flagged.
      expect(view.items[0]!.belowMinimum ?? null).toBeNull();
      return view.items[0]!.id;
    }

    async function expectRefusedLikeAnyLine(lineId: string): Promise<void> {
      const res = await submit();
      expect(res.statusCode, res.body).toBe(422);
      const error = await errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      expect(error.details).toMatchObject({
        productId: A,
        minimum: 10,
        lines: [{ cartItemId: lineId, productId: A, kind: 'pieces', minimum: 10 }],
      });
      expect((await cartView()).approvalStatus).toBe('not_required');
    }

    it('a valid quote — the exempt line is not refused and the cart is sent for approval', async () => {
      await seedMemberBasket(quotes.valid);
      const res = await submit();
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { approvalStatus: string } }).data.approvalStatus).toBe('pending');
    });

    it('the quote’s validity lapsed (still Approved) → refused 422 like any line', async () => {
      const lineId = await seedMemberBasket(quotes.expired);
      await h
        .em()
        .getConnection()
        .execute(`update "quote_requests" set "expires_at" = now() - interval '1 day' where "id" = ?`, [quotes.expired]);
      await expectRefusedLikeAnyLine(lineId);
    });

    it('the quote cancelled → refused 422 like any line', async () => {
      const lineId = await seedMemberBasket(quotes.cancelled);
      await h
        .em()
        .getConnection()
        .execute(`update "quote_requests" set "status" = 'Canceled', "canceled_at" = now() where "id" = ?`, [
          quotes.cancelled,
        ]);
      await expectRefusedLikeAnyLine(lineId);
    });

    it('an Order already carries the quote → refused 422 like any line', async () => {
      const lineId = await seedMemberBasket(quotes.ordered);
      await expectRefusedLikeAnyLine(lineId);
    });

    it('a quote of another Organization named by the basket → refused 422 like any line (XI)', async () => {
      const lineId = await seedMemberBasket(foreignQuote);
      await expectRefusedLikeAnyLine(lineId);
    });

    it('quote_requests off → nothing can vouch for the quote, so the line is refused; back on, it submits', async () => {
      const lineId = await seedMemberBasket(quotes.offState);
      await withModulesDeactivated(['quote_requests'], async () => {
        await expectRefusedLikeAnyLine(lineId);
      });
      const res = await submit();
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { approvalStatus: string } }).data.approvalStatus).toBe('pending');
    });
  });
});
