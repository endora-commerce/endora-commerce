import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import {
  clearProductScopes,
  errorBodyOf,
  setChannelStatus,
  setLanguageStatus,
} from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 6 (T040) — quote-request lines and scoped availability
 * (`contracts/consumers.md` row 16, FR-018).
 *
 *  - a buyer's line naming a product not available at the request's (channel,
 *    language) refuses the whole request with the single not-found an absent
 *    product gets;
 *  - an operator creating a request on a customer's behalf is not refused — the
 *    exemption stands — and the answer names each such line in `warnings` with
 *    `PRODUCT_UNAVAILABLE_IN_SCOPE`.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('163 — quote request lines honour scoped availability [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let off: MinimumProductFixture;
  let on: MinimumProductFixture;
  const createdRfqIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    off = await createMinimumProduct(em, { sku: `S163-RFQ-OFF-${RUN}`, nameEn: 'Off', namePl: 'Wył', channelIds: channels });
    on = await createMinimumProduct(em, { sku: `S163-RFQ-ON-${RUN}`, nameEn: 'On', namePl: 'Wł', channelIds: channels });
    await setChannelStatus(em, off.id, channels, 'inactive');
  });

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [off.id, on.id]);
    await teardownBackendServer(h);
  });

  it('refuses a buyer’s request naming a product off in the channel with the absent product’s 404', async () => {
    const create = (productId: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: CUSTOMER,
        payload: { items: [{ productId: on.id, quantity: 1 }, { productId, quantity: 1 }] },
      });
    const absent = await create(randomUUID());
    expect(absent.statusCode).toBe(404);
    const refused = await create(off.id);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(errorBodyOf(refused)).toEqual(errorBodyOf(absent));
    expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  });

  it('accepts an operator’s request on the customer’s behalf and warns about the unavailable line', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [
          { productId: on.id, quantity: 1, agreedUnitPrice: 10 },
          { productId: off.id, quantity: 1, agreedUnitPrice: 10 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as {
      data: { id: string };
      warnings?: Array<{ productId: string; code: string }>;
    };
    createdRfqIds.push(body.data.id);
    expect(body.warnings).toEqual([{ productId: off.id, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]);
  });

  it('carries no warnings when every line is available', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: on.id, quantity: 1, agreedUnitPrice: 10 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).not.toHaveProperty('warnings');
  });
});

/**
 * T155 finding §1.5b — the scope language of a buyer's quote line is the
 * request's language tag resolved against the channel, as the basket's is,
 * never the language the response's messages fall back to. A channel speaking
 * `pl-PL` and `de-DE` (the message bundles carry `en` and `pl`, so a `de-DE`
 * request is answered in Polish) and a product switched off at (C, de-DE) only.
 */
describe('163 — a quote line honours a language switched off at (channel, language) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const channelId = randomUUID();
  const channelCode = `s163-rfq-de-${RUN}`;
  const productId = randomUUID();
  /** Switched off at C itself — what an operator's warning names at C's default language. */
  const channelOffId = randomUUID();

  async function sql(query: string, params: unknown[] = []): Promise<void> {
    await h.em().getConnection().execute(query, params);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'pl-PL', '["pl-PL","de-DE"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': '163 RFQ German off' })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(
      `insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?) on conflict do nothing`,
      [channelId, TEST_ORGANIZATION_ID],
    );
    const sku = `S163-RFQ-DE-${RUN}`;
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, '', '{}'::jsonb, 'public', '[]'::jsonb, now(), now())`,
      [productId, sku, sku.toLowerCase(), 'German off'],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
    await setLanguageStatus(h.em(), productId, channelId, 'de-DE', 'inactive');
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, '', '{}'::jsonb, 'public', '[]'::jsonb, now(), now())`,
      [channelOffId, `${sku}-C`, `${sku.toLowerCase()}-c`, 'Channel off'],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, channelOffId]);
    await setChannelStatus(h.em(), channelOffId, [channelId], 'inactive');
  });

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [productId, channelOffId]);
    await sql(`delete from quote_requests where sales_channel_id = ?`, [channelId]);
    await sql(`delete from carts where sales_channel_id = ?`, [channelId]);
    await sql(`delete from sales_channel_products where product_id in (?, ?)`, [productId, channelOffId]);
    await sql(`delete from products where id in (?, ?)`, [productId, channelOffId]);
    await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channelId]);
    await sql(`delete from sales_channels where id = ?`, [channelId]);
    await teardownBackendServer(h);
  });

  const create = (language: string, items: Array<{ productId: string; quantity: number }>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      headers: { 'x-sales-channel': channelCode, 'accept-language': language },
      payload: { items },
    });

  it('refuses the line in German with the absent product’s 404, as the basket does', async () => {
    const absent = await create('de-DE', [{ productId: randomUUID(), quantity: 1 }]);
    expect(absent.statusCode, absent.body).toBe(404);
    const refused = await create('de-DE', [{ productId, quantity: 1 }]);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(errorBodyOf(refused)).toEqual(errorBodyOf(absent));

    const basket = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: CUSTOMER,
      headers: { 'x-sales-channel': channelCode, 'accept-language': 'de-DE' },
      payload: { productId, quantity: 1 },
    });
    expect(basket.statusCode, basket.body).toBe(404);
  });

  it('accepts the same line in Polish, where the product is on', async () => {
    const res = await create('pl-PL', [{ productId, quantity: 1 }]);
    expect(res.statusCode, res.body).toBe(201);
  });

  it('raises an operator’s request on the channel the body names, and warns about the line off there (T155 §1.5c)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        items: [
          { productId, quantity: 1, agreedUnitPrice: 10 },
          { productId: channelOffId, quantity: 1, agreedUnitPrice: 10 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { salesChannelId?: string | null }; warnings?: unknown };
    expect(body.data.salesChannelId).toBe(channelId);
    expect(body.warnings).toEqual([{ productId: channelOffId, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]);
  });

  it('refuses an operator’s request naming a channel that is not one of the Organization’s active channels (security M1)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: randomUUID(),
        items: [{ productId, quantity: 1, agreedUnitPrice: 10 }],
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.RFQ_SALES_CHANNEL_NOT_ALLOWED);
  });
});
