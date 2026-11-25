import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Order, OrderItem } from '../../helpers/package-entities.js';

/**
 * Issue #1011 — a buyer's clone of an order into a quote request judges the lines in the channel
 * language the whole `Accept-Language` header asks for, through `requestScopeLanguage`:
 * q-weighted, each tag matched against the channel's languages (exact, then base language), else
 * the channel's default. Before, the route passed the header's first tag alone, so
 * `en;q=0.2, pl-PL;q=0.9` asked about English and `de-DE, pl;q=0.5` about the default.
 *
 * The run's channel offers `en-US` (default) and `pl-PL`. The order's one line names a product
 * switched off at (channel, `en-US`): available in Polish only, so the clone creates a quote
 * request there and is refused with the absent product's 404 elsewhere (feature 163, FR-018).
 */
describe('Order clone-to-quote language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const channelId = randomUUID();
  const channelCode = `or1011-${run}`;
  const productId = randomUUID();
  let orderId = '';
  const CUSTOMER = { b2b_session: 'stub-customer-session' };

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params)) as T;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': `Order Accept-Language ${run}` })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)`, [
      channelId,
      TEST_ORGANIZATION_ID,
    ]);
    const sku = `OR1011-${run}`.toUpperCase();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, '', '{}'::jsonb, 'public', '[]'::jsonb, now(), now())`,
      [productId, sku, sku.toLowerCase(), `Order ${run}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [productId, channelId],
    );

    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: channelId,
      status: 'completed',
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persist(order).flush();
    await em.persist(
      em.create(OrderItem, {
        orderId: order.id,
        productId,
        productSnapshot: { sku, name: `Order ${run}`, primaryAssetUrl: null },
        quantity: 1,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: '10.00',
      }),
    ).flush();
    orderId = order.id;
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from quote_requests where sales_channel_id = ?`, [channelId]);
      if (orderId) {
        await sql(`delete from order_items where order_id = ?`, [orderId]);
        await sql(`delete from orders where id = ?`, [orderId]);
      }
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [productId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await sql(`delete from products where id = ?`, [productId]);
      await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channelId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  /** The status of the buyer's clone of the order into a quote request. */
  async function clone(acceptLanguage?: string): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/clone-to-quote`,
      cookies: CUSTOMER,
      headers: {
        'x-sales-channel': channelCode,
        ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
      },
    });
    return res.statusCode;
  }

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` is Polish', async () => {
    expect(await clone('en;q=0.2, pl-PL;q=0.9')).toBe(200);
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    expect(await clone('pl')).toBe(200);
  });

  it('skips an unoffered tag for the next offered one', async () => {
    expect(await clone('de-DE, pl;q=0.5')).toBe(200);
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    expect(await clone('de-DE')).toBe(404);
  });

  it('without the header, asks in the channel default, as before', async () => {
    expect(await clone()).toBe(404);
  });
});
