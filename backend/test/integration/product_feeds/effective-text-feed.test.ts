import { randomUUID } from 'node:crypto';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { Category, Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T055; FR-030, US3 #1, #2) — a feed line
 * carries the product's name and description at the **feed's** (channel, language), C×L → C →
 * Global. A feed of another
 * channel in the same language carries the Global texts.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const PUBLISHING_STATUSES = ['completed', 'completed_with_warnings'];
const DRILL_ID = '00000000-0000-4000-8000-0000000c1701';
const HIDDEN_URL = 'https://cdn.example.test/s170-feed-hidden-at-cxl.jpg';
/** The feed links the image by its permalink, which carries the stored file's stem. */
const HIDDEN_MARK = 's170-feed-hidden-at-cxl';

describe('170 — feed lines at the feed (channel, language) [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let vipId: string;
  let retailId: string;
  let priceListId: string;
  let categoryId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    retailId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    for (const code of ['pl_retail', 'pl_b2b_vip']) await setChannelStorefrontUrl(h, code);
    em.create(Product, {
      id: DRILL_ID,
      sku: 'S170-FEED-DRILL',
      slug: 's170-feed-drill',
      type: 'simple',
      status: 'active',
      visibility: 'public',
      name: 'Drill X',
      description: 'A drill.',
    });
    const category = em.create(Category, { name: { 'en-US': 'Feed 170' }, slug: `feed-170-${Date.now()}` });
    await em.flush();
    categoryId = category.id;
    const conn = em.getConnection();
    await conn.execute(`insert into product_categories (product_id, category_id) values (?,?)`, [DRILL_ID, categoryId]);
    for (const channelId of [vipId, retailId]) {
      await conn.execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`, [channelId, DRILL_ID]);
    }
    await seedScopedValues(em, DRILL_ID, [
      { field: 'name', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: 'Wiertarka X Pro' },
      { field: 'description', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: 'Wiertarka udarowa.' },
    ]);
    // A second gallery image, hidden at VIP x pl-PL only (the feed's scope below).
    const assetId = randomUUID();
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'image', 'hidden.jpg', 'image/jpeg', 1024, ?, now(), now())`,
      [assetId, HIDDEN_URL],
    );
    const attached = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${DRILL_ID}/gallery`,
      payload: { assetId, labels: [] },
      ...ADMIN,
    });
    expect(attached.statusCode, attached.body).toBe(201);
    const itemId = (attached.json() as { data: { id: string } }).data.id;
    await seedScopedValues(em, DRILL_ID, [
      { field: `gallery:${itemId}:hidden`, scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: true },
    ]);
    priceListId = await seedPriceBookSql(em, {
      name: 'Feed 170 book',
      audience: 'everyone',
      rows: [{ productId: DRILL_ID, fixed: '349.0000' }],
    });
    em.clear();
    const templates = await h.app.inject({ method: 'GET', url: '/api/v1/admin/feed-templates', ...ADMIN });
    templateId = (templates.json() as { data: Array<{ id: string; systemCode: string | null }> }).data.find(
      (t) => t.systemCode === 'google_merchant_v1',
    )!.id;
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [DRILL_ID]);
    await teardownBackendServer(h);
  });

  async function feedDocument(salesChannelId: string): Promise<string> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Feed 170 ${Math.random().toString(36).slice(2, 8)}`,
        slug: `feed-170-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId,
        languageCode: 'pl-PL',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        priceListId,
        selectionRule: { kind: 'condition', field: { kind: 'builtin', key: 'category' }, op: 'in', values: [categoryId] },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(PUBLISHING_STATUSES, JSON.stringify(run)).toContain(run.status);
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/product-feeds/${feedId}/artefact`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  it("carries the C×L name and description at the feed's scope", async () => {
    const document = await feedDocument(vipId);
    expect(document).toContain('Wiertarka X Pro');
    expect(document).toContain('Wiertarka udarowa.');
    expect(document).not.toContain('A drill.');
  });

  it('carries the Global texts on a channel without the translation (US3 #1)', async () => {
    const document = await feedDocument(retailId);
    expect(document).toContain('Drill X');
    expect(document).not.toContain('Wiertarka X Pro');
    expect(document).toContain('A drill.');
  });

  it("leaves out a gallery image hidden at the feed's (channel, language), and keeps it elsewhere", async () => {
    expect(await feedDocument(vipId)).not.toContain(HIDDEN_MARK);
    expect(await feedDocument(retailId)).toContain(HIDDEN_MARK);
  });
});
