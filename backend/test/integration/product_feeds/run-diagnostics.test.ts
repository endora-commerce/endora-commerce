import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PriceListPriceBracket, PriceListProduct } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { AdminNotification, FeedRunIssue, type AdminNotificationRow } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T100 — run diagnostics (FR-037, FR-054).
 *
 * The property under test is the one an operator's morning depends on: **an
 * item-level defect never aborts the run**. A catalogue where a third of the
 * products are missing something still produces a file for the two thirds that
 * are fine, and the run tells the operator, per reason, what it left out.
 *
 * The issue cap is the other half. A systemic defect over 100 000 products
 * would otherwise make `product_feed_run_issues` the largest table in the
 * database and turn the diagnostics page into a timeout, so writes stop at the
 * settings-driven cap and the run reports `issueOverflow`. The export still
 * streams everything that was recorded.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BASE = '/api/v1/admin/product-feeds';

/** Products seeded with a specific defect, so each reason has a known cause. */
const NO_PRICE_ID = '00000000-0000-4000-8000-0000000d0001';
const NO_TRANSLATION_ID = '00000000-0000-4000-8000-0000000d0002';

describe('feed run diagnostics [integration]', () => {
  let h: BackendServerHandle;
  let feedId: string;
  let channelId: string;
  let templateId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    const listId = await seedFeedPrices(em, { code: 'feed_diag_default' });

    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    // One product with no price at all, and one with no `pl` translation. Both
    // are otherwise perfectly eligible, so their absence from the file can only
    // be explained by the defect the test seeded.
    em.create(Product, {
      id: NO_PRICE_ID,
      sku: 'DIAG-NO-PRICE',
      slug: 'diag-no-price',
      type: 'simple',
      status: 'active',
      visibility: 'public',
      name: { 'en-US': 'No price at all', 'pl-PL': 'Bez ceny' },
      description: { 'en-US': 'x', 'pl-PL': 'x' },
    });
    em.create(Product, {
      id: NO_TRANSLATION_ID,
      sku: 'DIAG-NO-PL',
      slug: 'diag-no-pl',
      type: 'simple',
      status: 'active',
      visibility: 'public',
      // English only: a `pl` feed has to walk the fallback chain for this one.
      name: { 'en-US': 'English only' },
      description: { 'en-US': 'English only' },
    });
    await em.flush();

    const conn = em.getConnection();
    for (const id of [NO_PRICE_ID, NO_TRANSLATION_ID]) {
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`,
        [channelId, id],
      );
    }
    // The translated one gets a price; the other deliberately does not.
    // Assignment first, bracket second: the bracket table cascades off
    // `price_list_products` and MikroORM batches inserts by entity type.
    em.create(PriceListProduct, { priceListId: listId, productId: NO_TRANSLATION_ID });
    await em.flush();
    em.create(PriceListPriceBracket, {
      priceListId: listId,
      productId: NO_TRANSLATION_ID,
      currencyCode: 'PLN',
      minQuantity: 1,
      amount: '42.0000',
    });
    await em.flush();

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;

    const created = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: 'Diagnostics feed',
        slug: `diagnostics-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        // A `pl` feed, so the English-only product exercises the language chain.
        languageCode: 'pl-PL',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records a distinct reason per defect and still completes the run (FR-037)', async () => {
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    // The run finished; the defective items did not take it down with them.
    expect(['completed', 'completed_with_warnings']).toContain(run.status);
    expect(run.emittedCount).toBeGreaterThan(0);

    const em = h.em();
    em.clear();
    const issues = await em.find(FeedRunIssue, { feedRunId: run.id });
    const reasons = new Set(issues.map((issue) => issue.reason));

    // The priceless product is skipped, named, and its SKU is a snapshot so the
    // row stays readable after a rename or a deletion.
    expect(reasons).toContain('missing_price');
    const priceless = issues.find((issue) => issue.reason === 'missing_price');
    expect(priceless?.severity).toBe('skip');
    expect(priceless?.sku).toBe('DIAG-NO-PRICE');
    expect(priceless?.productId).toBe(NO_PRICE_ID);

    // The English-only product is a warning, not a skip: the fallback chain
    // filled it, and the operator is told which language was actually used.
    expect(reasons).toContain('missing_translation');
    const untranslated = issues.find(
      (issue) => issue.reason === 'missing_translation' && issue.productId === NO_TRANSLATION_ID,
    );
    expect(untranslated?.severity).toBe('warning');

    // The seeded catalogue carries no images at all.
    expect(reasons).toContain('missing_image');

    // Field-specific reasons name the offending output field.
    for (const issue of issues.filter((i) => i.reason === 'missing_required_field')) {
      expect(issue.outputName).toBeTruthy();
    }
  });

  it('caps recorded issues and flags the overflow rather than growing without bound', async () => {
    await h.settings.adminService.setValueForAllChannels(
      'product_feeds.run_issue_cap',
      2,
      null,
      { actorAdminUserId: null },
    );
    try {
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      const em = h.em();
      em.clear();
      const issues = await em.find(FeedRunIssue, { feedRunId: run.id });
      expect(issues).toHaveLength(2);
      expect(run.issueOverflow).toBe(true);

      // …and the run itself still completed and still published.
      expect(['completed', 'completed_with_warnings']).toContain(run.status);
    } finally {
      await h.settings.adminService.setValueForAllChannels(
        'product_feeds.run_issue_cap',
        1000,
        null,
        { actorAdminUserId: null },
      );
    }
  });

  it('exports every recorded issue, not only the page the screen shows', async () => {
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    const em = h.em();
    em.clear();
    const stored = await em.find(FeedRunIssue, { feedRunId: run.id });
    expect(stored.length).toBeGreaterThan(2);

    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${run.id}/issues/export`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const rows = res.body.trim().split('\n');
    // Header plus one line per recorded issue.
    expect(rows).toHaveLength(stored.length + 1);
    expect(res.body).toContain('DIAG-NO-PRICE');

    // The listing endpoint's page is bounded; the export is not.
    const page = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${run.id}/issues?limit=2`,
      ...ADMIN,
    });
    expect((page.json() as { data: unknown[] }).data).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Failure notification (FR-056)
  // -------------------------------------------------------------------------

  describe('failed-run notification', () => {
    const BROKEN_CHANNEL = '00000000-0000-4000-8000-0000000000cd';

    const notifications = async (subjectId: string): Promise<AdminNotificationRow[]> => {
      const em = h.em();
      em.clear();
      return em.find(AdminNotification, {
        kind: 'product_feed.run_failed',
        subjectId,
      });
    };

    it('raises exactly one notification with a working deep link, then stops repeating', async () => {
      // A run that fails for a configuration reason, driven through the
      // documented test seam rather than by corrupting the row.
      const first = await h.productFeeds.generation.generateNow(feedId, {
        trigger: 'scheduled',
        overrideSalesChannelId: BROKEN_CHANNEL,
      });
      expect(first.status).toBe('failed');
      expect(first.failureCode).toBe('channel_unavailable');

      const after = await notifications(feedId);
      expect(after).toHaveLength(1);
      const entry = after[0]!;
      expect(entry.title).toContain('Diagnostics feed');
      expect(entry.body).toContain('channel_unavailable');
      // The link points at the run, not at the feed: the counters and the
      // reason only exist on the run detail.
      expect(entry.linkPath).toBe(`/product-feeds/${feedId}/runs/${first.id}`);

      // A scheduled feed fails on every tick. The bell must not become a
      // per-tick spam source, so a repeat of the same failure is silent.
      for (let index = 0; index < 3; index += 1) {
        const repeat = await h.productFeeds.generation.generateNow(feedId, {
          trigger: 'scheduled',
          overrideSalesChannelId: BROKEN_CHANNEL,
        });
        expect(repeat.status).toBe('failed');
      }
      expect(await notifications(feedId)).toHaveLength(1);
    });

    it('speaks again once the feed recovers and breaks anew', async () => {
      // A successful run in between is the transition that re-arms it.
      const recovered = await h.productFeeds.generation.generateNow(feedId, {
        trigger: 'manual',
      });
      expect(['completed', 'completed_with_warnings']).toContain(recovered.status);

      const broken = await h.productFeeds.generation.generateNow(feedId, {
        trigger: 'scheduled',
        overrideSalesChannelId: BROKEN_CHANNEL,
      });
      expect(broken.status).toBe('failed');
      const entries = await notifications(feedId);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.linkPath)).toContain(
        `/product-feeds/${feedId}/runs/${broken.id}`,
      );

      // Leave the feed working for the tests that follow.
      await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    });
  });

  it('keeps the run and its issues explicable after the product is deleted', async () => {
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    const em = h.em();
    // `product_feed_run_issues.product_id` deliberately carries no foreign key,
    // so history survives a catalogue deletion (data-model §6).
    await em
      .getConnection()
      .execute(`delete from sales_channel_products where product_id = ?`, [SEED_PRODUCT_101_ID]);
    em.clear();
    const issues = await em.find(FeedRunIssue, { feedRunId: run.id });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.sku).toBeTruthy();
  });
});
