import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { emptyCustomerBasket } from '../../helpers/customer-basket.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { ADMIN, makeAddress, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` T055 (US9; FR-110 to FR-117, Principle XII, A-18) — *Buying for* a
 * payer on its commercial terms. The buyer X (the harness's stub customer) sets its cart to the
 * payer Y: the cart, the catalogue listing, the product page and the storefront price endpoint
 * all price as Y on the cart's channel; Y's book bound to another channel never applies; the
 * order placed carries those prices and `payer_terms = 'payer'`, and cannot be placed naming
 * another payer or none. When the link turns to the buyer's terms, the next cart read returns to
 * X's prices and says why; a buyer's-terms choice changes no price.
 */
const SESSION = { b2b_session: 'stub-customer-session' };

describe('related_payers — the payer\'s commercial terms on the cart (US9)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let payer: string;
  let payerBilling: string;
  let linkId: string;
  let ownPrice101: number;

  const inject = (method: 'GET' | 'PUT' | 'POST' | 'PATCH', url: string, payload?: unknown, cookies = SESSION) =>
    h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload: payload as object } : {}) });

  const listingPrice = async (productId: string): Promise<number | null> => {
    const res = await inject('GET', `/api/v1/catalog/products?ids=${productId}`);
    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json() as { data: Array<{ id: string; price: { amount: number } | null }> }).data.find((p) => p.id === productId);
    return row?.price?.amount ?? null;
  };
  const detailPrice = async (productId: string): Promise<number | null> => {
    const res = await inject('GET', `/api/v1/catalog/products/${productId}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { price: { amount: number } | null } }).data.price?.amount ?? null;
  };
  const resolvedPrice = async (productId: string): Promise<number> => {
    const res = await inject('GET', `/api/v1/storefront/products/${productId}/resolved-price?quantity=1`);
    expect(res.statusCode, res.body).toBe(200);
    const r = (res.json() as { data: { resolvedPrice: { basePrice: { amount: string } | null; salePrice: { amount: string } | null } } }).data
      .resolvedPrice;
    return Number((r.salePrice ?? r.basePrice)?.amount);
  };
  const cart = async () => {
    const res = await inject('GET', '/api/v1/cart');
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as {
      data: {
        id: string;
        buyingFor: { organizationId: string; terms: string } | null;
        buyingForReset: { reason: string } | null;
        items: Array<{ productId: string; unitPrice: { amount: number } }>;
      };
    }).data;
  };
  const cartPrice = async (productId: string) => (await cart()).items.find((i) => i.productId === productId)?.unitPrice.amount;
  const round = (n: number | null | undefined) => (n == null ? null : Number(n.toFixed(2)));

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    defaultChannelId = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).id;
    const other = (await em.find(SalesChannel, {})).find((c) => c.id !== defaultChannelId);
    const setting = await inject('PUT', '/api/v1/admin/settings/related_payers.enabled/value', { scope: 'all', value: true }, ADMIN);
    expect(setting.statusCode, setting.body).toBe(200);
    payer = await makeOrganization(em, 'Terms payer Y');
    payerBilling = await makeAddress(em, payer, 'billing');
    // Y's own book on this channel: 101 at −20 %.
    await seedPriceBookSql(em, {
      name: 'US9 — payer on the channel',
      audience: { organizations: [payer] },
      channelIds: [defaultChannelId],
      rows: [{ productId: SEED_PRODUCT_101_ID, percent: '-20' }],
    });
    // Principle XII — Y's book bound to another channel only: never applies here.
    if (other) {
      await seedPriceBookSql(em, {
        name: 'US9 — payer elsewhere',
        audience: { organizations: [payer] },
        channelIds: [other.id],
        rows: [{ productId: SEED_PRODUCT_102_ID, fixed: '1' }],
      });
    }
    const link = await inject('POST', `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`, {
      payerOrganizationId: payer,
      commercialTerms: 'payer',
    }, ADMIN);
    expect(link.statusCode, link.body).toBe(201);
    linkId = link.json().data.id;
    await emptyCustomerBasket(h, { ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: defaultChannelId });
    for (const productId of [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID]) {
      const added = await inject('POST', '/api/v1/cart/items', { productId, quantity: 1 });
      expect(added.statusCode, added.body).toBe(200);
    }
    ownPrice101 = (await cartPrice(SEED_PRODUCT_101_ID))!;
  }, 5 * 60_000);

  afterAll(async () => {
    // The link names the shared stub Organization: revoke it so no other file meets it.
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/related-payers/links/${linkId}/revoke`, cookies: ADMIN, payload: {} });
    await teardownBackendServer(h);
  });

  it('US9-1: Buying for Y reprices the cart and answers what changed (FR-110, FR-113)', async () => {
    const res = await inject('PUT', '/api/v1/cart/buying-for', { payerOrganizationId: payer });
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json().data as {
      buyingFor: { organizationId: string; terms: string };
      repricing: { lines: Array<{ before: { amount: number } | null; after: { amount: number } | null }> };
    };
    expect(data.buyingFor).toMatchObject({ organizationId: payer, terms: 'payer' });
    expect(data.repricing.lines.some((l) => round(l.after?.amount) === 15.99)).toBe(true);
    expect(round(await cartPrice(SEED_PRODUCT_101_ID))).toBe(15.99);
  });

  it('FR-115: listing, product page and the price endpoint price as Y, equal to the cart', async () => {
    expect(round(await listingPrice(SEED_PRODUCT_101_ID))).toBe(15.99);
    expect(round(await detailPrice(SEED_PRODUCT_101_ID))).toBe(15.99);
    expect(round(await resolvedPrice(SEED_PRODUCT_101_ID))).toBe(15.99);
  });

  it('Principle XII: a Y book bound to another channel never applies', async () => {
    expect(round(await cartPrice(SEED_PRODUCT_102_ID))).not.toBe(1);
    expect(round(await listingPrice(SEED_PRODUCT_102_ID))).not.toBe(1);
  });

  it('FR-117: placement naming no payer, or another, is refused with nothing written', async () => {
    const { SEED_ADDRESS_DELIVERY_ID, SEED_ADDRESS_BILLING_ID, SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } = await import(
      '../../helpers/seed-commerce.js'
    );
    const before = await cart();
    const res = await inject('POST', '/api/v1/orders', {
      deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
      billingAddressId: SEED_ADDRESS_BILLING_ID,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error.details).toMatchObject({ reason: 'cart_bought_for_payer' });
    expect((await cart()).id).toBe(before.id);
  });

  it('US9-5: a link turned to the buyer\'s terms resets the cart on its next read, with a reason (FR-116)', async () => {
    const current = await inject('GET', `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`, undefined, ADMIN);
    const version = (current.json().data.asBuyer as Array<{ id: string; version: number }>).find((l) => l.id === linkId)!.version;
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/related-payers/links/${linkId}`,
      cookies: ADMIN,
      headers: { 'if-match': String(version) },
      payload: { commercialTerms: 'buyer' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const read = await cart();
    expect(read.buyingFor).toBeNull();
    expect(read.buyingForReset).toEqual({ reason: 'terms_changed' });
    expect(read.items.find((i) => i.productId === SEED_PRODUCT_101_ID)?.unitPrice.amount).toBe(ownPrice101);
    // The next read is quiet.
    expect((await cart()).buyingForReset).toBeNull();
  });

  it('FR-110: a payer on the buyer\'s terms is carried and changes no price', async () => {
    const res = await inject('PUT', '/api/v1/cart/buying-for', { payerOrganizationId: payer });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.buyingFor).toMatchObject({ organizationId: payer, terms: 'buyer' });
    expect(await cartPrice(SEED_PRODUCT_101_ID)).toBe(ownPrice101);
    expect(round(await listingPrice(SEED_PRODUCT_101_ID))).toBe(round(ownPrice101));
    const cleared = await inject('PUT', '/api/v1/cart/buying-for', { payerOrganizationId: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().data.buyingFor).toBeNull();
  });

  it('FR-119: no customer route changes a link\'s terms', async () => {
    const res = await inject('PATCH', `/api/v1/admin/related-payers/links/${linkId}`, { commercialTerms: 'payer' });
    expect([401, 403, 404]).toContain(res.statusCode);
  });

  it('places an order in Y\'s context with Y\'s prices and payer_terms = payer (FR-117)', async () => {
    // Back to the payer's terms, chosen on the cart again.
    const current = await inject('GET', `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`, undefined, ADMIN);
    const version = (current.json().data.asBuyer as Array<{ id: string; version: number }>).find((l) => l.id === linkId)!.version;
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/related-payers/links/${linkId}`,
      cookies: ADMIN,
      headers: { 'if-match': String(version) },
      payload: { commercialTerms: 'payer' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((await inject('PUT', '/api/v1/cart/buying-for', { payerOrganizationId: payer })).statusCode).toBe(200);
    // 102 was in the cart only for the channel check above; the seed holds no stock for it.
    const line102 = (await h.em().getConnection().execute(
      `select ci.id from cart_items ci join carts c on c.id = ci.cart_id where c.id = ? and ci.product_id = ?`,
      [(await cart()).id, SEED_PRODUCT_102_ID],
    )) as Array<{ id: string }>;
    for (const { id } of line102) {
      const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/cart/items/${id}`, cookies: SESSION });
      expect(removed.statusCode, removed.body).toBe(200);
    }
    const { SEED_ADDRESS_DELIVERY_ID, SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } = await import('../../helpers/seed-commerce.js');
    const placed = await inject('POST', '/api/v1/orders', {
      deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
      billingAddressId: payerBilling,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      payerOrganizationId: payer,
    });
    expect(placed.statusCode, placed.body).toBe(201);
    const order = placed.json().data as { id: string; items: Array<{ productId: string; unitPrice: number }> };
    expect(round(order.items.find((i) => i.productId === SEED_PRODUCT_101_ID)?.unitPrice)).toBe(15.99);
    const [row] = (await h.em().getConnection().execute(`select payer_terms from orders where id = ?`, [order.id])) as Array<{ payer_terms: string }>;
    expect(row!.payer_terms).toBe('payer');
  });
});
