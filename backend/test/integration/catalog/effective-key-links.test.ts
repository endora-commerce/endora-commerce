import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 163 (T113a, FR-071, R28) — every storefront link S1's surfaces emit is the
 * product's **effective URL key** at the request's (channel, language), not the global
 * `slug`. A product with a key of its own in a language answers 404 at the global slug
 * there once `seo` is off (no redirect), so a link built on the global slug was a dead
 * link in that language.
 *
 * P has the global slug `g163-…` and its own pl-PL key `k163-…`; every buyer channel
 * here offers pl-PL. The surfaces: the quick-order type-ahead (catalog's quick search),
 * the basket line, the comparison column, and the product page and listing (R28,
 * already on the key) as the reference. The Meilisearch hit is a module-local case
 * (`search-hit-channel-values.test.ts`): the harness runs no search engine.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail', 'accept-language': 'pl-PL' };

describe('163 — S1 surfaces link to the effective URL key (T113a) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let P: MinimumProductFixture;
  const KEY = `k163-${RUN}`.toLowerCase();

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channelIds = await buyerChannelIds(em);
    P = await createMinimumProduct(em, {
      sku: `G163-${RUN}`,
      nameEn: `Linked ${RUN}`,
      namePl: `Linkowany ${RUN}`,
      channelIds,
    });
    // Feature 174 — 163's pl-PL language key is a (C, pl-PL) key in each of the product's channels.
    for (const channelId of channelIds) {
      await em
        .getConnection()
        .execute(
          `insert into product_url_keys (id, product_id, language_code, sales_channel_id, key, created_at, updated_at)
           values (?, ?, 'pl-PL', ?, ?, now(), now())`,
          [randomUUID(), P.id, channelId, KEY],
        );
    }
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    if (P) await h.em().getConnection().execute(`delete from product_url_keys where product_id = ?`, [P.id]);
    await teardownBackendServer(h);
  });

  it('the product page and the listing carry the key (the reference, R28)', async () => {
    const page = await h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${P.id}`, headers: CHANNEL });
    expect(page.statusCode, page.body).toBe(200);
    expect((page.json() as { data: { slug: string } }).data.slug).toBe(KEY);
  });

  it('the quick-order type-ahead hit links to the key', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quick-order/search?q=${encodeURIComponent(`G163-${RUN}`)}&limit=5`,
      cookies: CUSTOMER,
      headers: CHANNEL,
    });
    expect(res.statusCode, res.body).toBe(200);
    const hit = (res.json() as { data: Array<{ productId: string; slug: string }> }).data.find((h2) => h2.productId === P.id);
    expect(hit?.slug).toBe(KEY);
  });

  it('a basket line links to the key', async () => {
    const cookies = { b2b_cart_anon: `anon-163-keys-${randomUUID()}` };
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId: P.id, quantity: 1 },
    });
    expect(added.statusCode, added.body).toBe(200);
    const view = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies, headers: CHANNEL });
    const line = (view.json() as { data: { items: Array<{ productId: string; productSlug: string | null }> } }).data.items.find(
      (item) => item.productId === P.id,
    );
    expect(line?.productSlug).toBe(KEY);
  });

  it('a comparison column links to the key', async () => {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      cookies: CUSTOMER,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId: P.id },
    });
    expect(added.statusCode, added.body).toBe(200);
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: CUSTOMER, headers: CHANNEL });
    const column = (res.json() as { data: { products: Array<{ id: string; slug: string }> } }).data.products.find(
      (p) => p.id === P.id,
    );
    expect(column?.slug).toBe(KEY);
  });
});
