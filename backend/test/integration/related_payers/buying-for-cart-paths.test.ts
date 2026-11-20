import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { emptyCustomerBasket } from '../../helpers/customer-basket.js';
import { createUnpricedProduct } from '../../helpers/tiered-product-fixture.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { ADMIN, makeAddress, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` FR-111 (RP-18 a) — every path that prices a line of a cart bought
 * for a payer on its terms prices it for the payer:
 *
 *  - the add path's orderability pre-check (every add goes through the batch): a product only
 *    the payer's book prices is orderable in the payer's context and is added at its price;
 *  - the sign-in merge: a guest line moved into a payer's-terms cart takes the payer's price.
 */
const SESSION = { b2b_session: 'stub-customer-session' };

describe('related_payers — the cart paths price in the cart\'s context', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let payer: string;
  let linkId: string;
  let payerOnly: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).id;
    const setting = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.enabled/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: true },
    });
    expect(setting.statusCode, setting.body).toBe(200);
    payer = await makeOrganization(em, 'Cart paths payer');
    await makeAddress(em, payer, 'billing');
    payerOnly = await createUnpricedProduct(h, `rp182-${randomUUID().slice(0, 8)}`);
    await seedPriceBookSql(em, {
      name: 'Cart paths — payer',
      audience: { organizations: [payer] },
      channelIds: [channelId],
      rows: [
        { productId: payerOnly, fixed: '42' },
        { productId: SEED_PRODUCT_101_ID, fixed: '11' },
      ],
    });
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: payer, commercialTerms: 'payer' },
    });
    expect(link.statusCode, link.body).toBe(201);
    linkId = link.json().data.id;
    await emptyCustomerBasket(h, { ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: channelId });
    const seed = await h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: SESSION, payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 } });
    expect(seed.statusCode, seed.body).toBe(200);
    const set = await h.app.inject({ method: 'PUT', url: '/api/v1/cart/buying-for', cookies: SESSION, payload: { payerOrganizationId: payer } });
    expect(set.statusCode, set.body).toBe(200);
  }, 5 * 60_000);

  afterAll(async () => {
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/related-payers/links/${linkId}/revoke`, cookies: ADMIN, payload: {} });
    await emptyCustomerBasket(h, { ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: channelId });
    await teardownBackendServer(h);
  });

  const linePrice = async (productId: string): Promise<number | undefined> => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: SESSION });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json().data as { items: Array<{ productId: string; unitPrice: { amount: number } }> }).items;
    return items.find((i) => i.productId === productId)?.unitPrice.amount;
  };

  it('adds a product only the payer prices, at the payer\'s price', async () => {
    // Control: in the buyer's own context the product has no price and is refused.
    await h.app.inject({ method: 'PUT', url: '/api/v1/cart/buying-for', cookies: SESSION, payload: { payerOrganizationId: null } });
    const own = await h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: SESSION, payload: { productId: payerOnly, quantity: 1 } });
    expect(own.statusCode, own.body).toBe(422);
    await h.app.inject({ method: 'PUT', url: '/api/v1/cart/buying-for', cookies: SESSION, payload: { payerOrganizationId: payer } });
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: SESSION, payload: { productId: payerOnly, quantity: 1 } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await linePrice(payerOnly)).toBe(42);
    const [row] = (await h.em().getConnection().execute(
      `select ci.unit_price from cart_items ci join carts c on c.id = ci.cart_id
        where c.customer_account_id = ? and c.status = 'active' and ci.product_id = ?`,
      [CUSTOMER_COOKIES[SESSION.b2b_session]!.customerAccountId, payerOnly],
    )) as Array<{ unit_price: string }>;
    expect(Number(row!.unit_price)).toBe(42);
  });

  it('a guest line merged at sign-in takes the payer\'s price', async () => {
    const token = `anon-rp182-${randomUUID()}`;
    const guest = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: { b2b_cart_anon: token },
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
    });
    expect(guest.statusCode, guest.body).toBe(200);
    const customer = CUSTOMER_COOKIES[SESSION.b2b_session]!;
    await h.cartService()!.mergeAnonymousIntoCustomer(token, {
      customerAccountId: customer.customerAccountId,
      organizationId: customer.organizationId,
      salesChannelId: channelId,
    } as never);
    const [row] = (await h.em().getConnection().execute(
      `select ci.unit_price from cart_items ci join carts c on c.id = ci.cart_id
        where c.customer_account_id = ? and c.status = 'active' and ci.product_id = ?`,
      [customer.customerAccountId, SEED_PRODUCT_101_ID],
    )) as Array<{ unit_price: string }>;
    expect(Number(row!.unit_price)).toBe(11);
  });
});
