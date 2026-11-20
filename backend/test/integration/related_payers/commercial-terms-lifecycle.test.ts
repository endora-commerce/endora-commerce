import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { emptyCustomerBasket } from '../../helpers/customer-basket.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { ADMIN, makeAddress, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` T055, the rest of US9 (FR-115, FR-116, FR-112, A-6):
 *
 *  - X keeps its own visibility while priced as Y — a product only X may see stays listed, one
 *    only Y may see does not appear;
 *  - a link revoked, deactivated or ended (out of window) while the cart is in Y's context:
 *    the next cart read resets it, reprices it and says why, and a placement already on its
 *    way is refused with nothing written;
 *  - a terms change racing the placement: the cart still says "payer's terms", the link says
 *    "buyer's" — placement refuses rather than book Y's prices on the buyer's terms;
 *  - the minimum order value judged on the subtotal at Y's prices.
 */
const SESSION = { b2b_session: 'stub-customer-session' };

describe('related_payers — the payer\'s terms over a link\'s life (US9)', () => {
  let h: BackendServerHandle;
  let channelId: string;

  const inject = (method: 'GET' | 'PUT' | 'POST' | 'PATCH', url: string, payload?: unknown, cookies: Record<string, string> = SESSION) =>
    h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload: payload as object } : {}) });

  /** A fresh payer Y on its terms (101 at 11), linked to X, the basket holding 101 and bought for Y. */
  async function boughtForPayer(): Promise<{ payer: string; billing: string; linkId: string }> {
    const payer = await makeOrganization(h.em(), 'Lifecycle payer');
    const billing = await makeAddress(h.em(), payer, 'billing');
    await seedPriceBookSql(h.em(), {
      name: `Lifecycle ${payer.slice(0, 8)}`,
      audience: { organizations: [payer] },
      channelIds: [channelId],
      rows: [{ productId: SEED_PRODUCT_101_ID, fixed: '11' }],
    });
    const link = await inject('POST', `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`, {
      payerOrganizationId: payer,
      commercialTerms: 'payer',
    }, ADMIN);
    expect(link.statusCode, link.body).toBe(201);
    expect((await inject('POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 })).statusCode).toBe(200);
    const set = await inject('PUT', '/api/v1/cart/buying-for', { payerOrganizationId: payer });
    expect(set.statusCode, set.body).toBe(200);
    return { payer, billing, linkId: link.json().data.id };
  }

  async function patchLink(linkId: string, body: Record<string, unknown>): Promise<void> {
    const list = await inject('GET', `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`, undefined, ADMIN);
    const version = (list.json().data.asBuyer as Array<{ id: string; version: number }>).find((l) => l.id === linkId)!.version;
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/related-payers/links/${linkId}`,
      cookies: ADMIN,
      headers: { 'if-match': String(version) },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function place(payer: string, billing: string) {
    const { SEED_ADDRESS_DELIVERY_ID, SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } = await import('../../helpers/seed-commerce.js');
    return inject('POST', '/api/v1/orders', {
      deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
      billingAddressId: billing,
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      payerOrganizationId: payer,
    });
  }

  const orderCount = async () =>
    Number(
      ((await h.em().getConnection().execute('select count(*)::int as n from orders where organization_id = ?', [TEST_ORGANIZATION_ID])) as Array<{ n: number }>)[0]!.n,
    );

  const cartRead = async () => {
    const res = await inject('GET', '/api/v1/cart');
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as {
      buyingFor: unknown;
      buyingForReset: { reason: string } | null;
      items: Array<{ productId: string; unitPrice: { amount: number } }>;
    };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = (await h.em().findOneOrFail(SalesChannel, { systemDefault: true })).id;
    const setting = await inject('PUT', '/api/v1/admin/settings/related_payers.enabled/value', { scope: 'all', value: true }, ADMIN);
    expect(setting.statusCode, setting.body).toBe(200);
  }, 5 * 60_000);

  beforeEach(async () => {
    await emptyCustomerBasket(h, { ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: channelId });
  });

  afterAll(async () => {
    // Every link this file made names the shared stub Organization: revoke them.
    const list = await inject('GET', `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`, undefined, ADMIN);
    for (const l of list.json().data.asBuyer as Array<{ id: string; state: string }>) {
      if (l.state !== 'revoked') await inject('POST', `/api/v1/admin/related-payers/links/${l.id}/revoke`, {}, ADMIN);
    }
    await emptyCustomerBasket(h, { ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: channelId });
    await teardownBackendServer(h);
  });

  it('X keeps its own visibility while priced as Y', async () => {
    const { payer } = await boughtForPayer();
    const make = async (allowed: string) => {
      const res = await inject('POST', '/api/v1/admin/catalog/products', {
        sku: `RP182-VIS-${randomUUID().slice(0, 8)}`,
        type: 'simple',
        name: 'Restricted',
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        allowedOrganizationIds: [allowed],
        status: 'active',
      }, ADMIN);
      expect(res.statusCode, res.body).toBe(201);
      return res.json().data.id as string;
    };
    const xOnly = await make(TEST_ORGANIZATION_ID);
    const yOnly = await make(payer);
    const listed = async (id: string) =>
      ((await inject('GET', `/api/v1/catalog/products?ids=${id}`)).json().data as Array<{ id: string }>).some((p) => p.id === id);
    expect(await listed(xOnly)).toBe(true);
    expect(await listed(yOnly)).toBe(false);
  });

  for (const [label, change, reason] of [
    ['revoked', 'revoke', 'link_not_usable'],
    ['deactivated', { state: 'inactive' }, 'link_not_usable'],
    ['out of window', { validTo: '2020-01-01T00:00:00.000Z' }, 'link_not_usable'],
  ] as const) {
    it(`a link ${label} while bought for Y: placement refused, the next read resets and reprices (FR-116)`, async () => {
      const { payer, billing, linkId } = await boughtForPayer();
      expect((await cartRead()).items.find((i) => i.productId === SEED_PRODUCT_101_ID)?.unitPrice.amount).toBe(11);
      if (change === 'revoke') {
        expect((await inject('POST', `/api/v1/admin/related-payers/links/${linkId}/revoke`, {}, ADMIN)).statusCode).toBe(200);
      } else {
        await patchLink(linkId, change);
      }
      const before = await orderCount();
      const refused = await place(payer, billing);
      expect(refused.statusCode, refused.body).toBe(422);
      expect(await orderCount()).toBe(before);
      const read = await cartRead();
      expect(read.buyingFor).toBeNull();
      expect(read.buyingForReset).toEqual({ reason });
      expect(read.items.find((i) => i.productId === SEED_PRODUCT_101_ID)?.unitPrice.amount).not.toBe(11);
    });
  }

  it('a terms change racing the placement is refused, nothing written (FR-116)', async () => {
    const { payer, billing, linkId } = await boughtForPayer();
    await patchLink(linkId, { commercialTerms: 'buyer' });
    const before = await orderCount();
    // The cart was not read again: it still says "payer's terms" when the placement arrives.
    const refused = await place(payer, billing);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error.code).toBe('RELATED_PAYER_NOT_USABLE');
    expect(await orderCount()).toBe(before);
  });

  it('the minimum order value is judged on the subtotal at Y\'s prices (FR-112)', async () => {
    const { payer, billing } = await boughtForPayer();
    const min = await inject('PUT', '/api/v1/admin/settings/orders.min_order_value/value', { scope: 'all', value: 15 }, ADMIN);
    expect(min.statusCode, min.body).toBe(200);
    try {
      const refused = await place(payer, billing);
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe('ORDER_BELOW_MINIMUM_VALUE');
      expect(Number(refused.json().error.details.subtotal)).toBe(11);
    } finally {
      await inject('PUT', '/api/v1/admin/settings/orders.min_order_value/value', { scope: 'all', value: 0 }, ADMIN);
    }
  });
});
