import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { FeedRunIssue } from '../../../src/modules/product_feeds/entities/feed-run-issue.entity.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Regression for the "`g:link` has no value and no fallback" report.
 *
 * The shipped Google Merchant template binds `g:link` to the platform `link`
 * source, which is built from the channel's storefront origin. When that origin
 * is unset — the default on a fresh installation, because
 * `sales_channels.storefront_url` ships empty and `STOREFRONT_BASE_URL` is
 * optional — **every** item loses its link and is skipped as a
 * `missing_required_field`. The run then failed on the skip threshold, and the
 * operator was left reading a per-product message that describes the symptom
 * ("no value and no fallback") rather than the one configuration value that
 * causes it.
 *
 * So this is a configuration failure, and the run has to name it once, up
 * front, like every other configuration failure in this pipeline (FR-029).
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BASE = '/api/v1/admin/product-feeds';

describe('feed run with no storefront URL configured [integration]', () => {
  let h: BackendServerHandle;
  let feedId: string;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await seedFeedPrices(em, { code: 'feed_no_origin_default' });

    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    const templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;

    const created = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: 'No storefront origin feed',
        slug: `no-origin-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
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

  it('fails the run once, naming the setting — not once per product', async () => {
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });

    expect(run.status).toBe('failed');
    expect(run.failureCode).toBe('storefront_url_unconfigured');
    // The detail has to carry the two things the operator needs to act: which
    // setting, and which channel it has to be set for.
    expect(run.failureDetail).toContain('sales_channels.storefront_url');
    expect(run.failureDetail).toContain('pl_retail');
    // …and which template fields stop working without it, so the operator can
    // tell this apart from a template they bound wrongly.
    expect(run.failureDetail).toContain('g:link');

    // Nothing was published, and the catalogue was never walked: no per-item
    // noise about a defect that belongs to the feed's configuration.
    expect(run.emittedCount).toBe(0);
    const em = h.em();
    em.clear();
    const issues = await em.find(FeedRunIssue, { feedRunId: run.id });
    expect(issues).toHaveLength(0);
  });

  it('runs normally as soon as the channel has a storefront URL', async () => {
    await setChannelStorefrontUrl(h, 'pl_retail');
    try {
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(['completed', 'completed_with_warnings']).toContain(run.status);
      expect(run.emittedCount).toBeGreaterThan(0);
    } finally {
      await setChannelStorefrontUrl(h, 'pl_retail', '');
    }
  });
});
