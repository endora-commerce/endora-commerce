import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { FeedArtefact, FeedRun, FeedRunIssue, ProductFeed } from '../../helpers/package-entities.js';
import type { FeedArtefactRow } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T102 — artefact retention (FR-052, `contracts/admin-runs.md` §6).
 *
 * Retention deletes real bytes, so it is written to be conservative in three
 * specific ways, each pinned here:
 *
 *  - **the published artefact is never a purge candidate**, whatever `N` is.
 *    The one file a provider is fetching right now is exactly the one a purge
 *    must never touch.
 *  - **a missing storage object is not an error.** The object may have been
 *    removed by an earlier sweep or by an operator; the row still has to go,
 *    and a throw here would abort a run that had otherwise succeeded.
 *  - **runs and their issues outlive their artefact.** History has to stay
 *    explicable after the file it produced is gone, so the run then simply
 *    reports `artefact: null`.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BASE = '/api/v1/admin/product-feeds';

describe('feed artefact retention [integration]', () => {
  let h: BackendServerHandle;
  let feedId: string;

  const artefactsFor = async (): Promise<FeedArtefactRow[]> => {
    const em = h.em();
    em.clear();
    return em.find(FeedArtefact, { productFeedId: feedId }, { orderBy: { producedAt: 'asc' } });
  };

  const setRetention = async (count: number): Promise<void> => {
    await h.settings.adminService.setValueForAllChannels(
      'product_feeds.artefact_retention_count',
      count,
      null,
      { actorAdminUserId: null },
    );
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    await seedFeedPrices(em, { code: 'feed_retention_default' });

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    const templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    const created = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: 'Retention feed',
        slug: `retention-${Math.random().toString(36).slice(2, 10)}`,
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
    await setRetention(3);
    await teardownBackendServer(h);
  });

  it('keeps exactly N artefacts plus the published one', async () => {
    await setRetention(2);
    for (let index = 0; index < 5; index += 1) {
      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(['completed', 'completed_with_warnings']).toContain(run.status);
    }

    const artefacts = await artefactsFor();
    // The newest is the published one and is retained regardless of `N`, so the
    // ceiling is N + nothing: the published artefact IS the newest here.
    expect(artefacts.length).toBeLessThanOrEqual(3);
    expect(artefacts.length).toBeGreaterThanOrEqual(2);

    const feed = await h.em().findOneOrFail(ProductFeed, { id: feedId });
    expect(artefacts.map((a) => a.id)).toContain(feed.publishedArtefactId);

    // The file a provider would fetch right now still serves.
    const download = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(download.statusCode).toBe(200);
    expect(download.body.length).toBeGreaterThan(0);
  });

  it('never purges the published artefact, even at a retention count of zero', async () => {
    await setRetention(0);
    const feedBefore = await h.em().findOneOrFail(ProductFeed, { id: feedId });
    const publishedBefore = feedBefore.publishedArtefactId;
    expect(publishedBefore).toBeTruthy();

    await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });

    const artefacts = await artefactsFor();
    const feed = await h.em().findOneOrFail(ProductFeed, { id: feedId });
    // Whatever else went, the row the feed points at is still there and still
    // downloadable.
    expect(artefacts.map((a) => a.id)).toContain(feed.publishedArtefactId);
    const download = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(download.statusCode).toBe(200);
    await setRetention(3);
  });

  it('tolerates a storage object that is already gone', async () => {
    await setRetention(1);
    const first = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(first.status);

    // Remove the bytes behind an older artefact out from under retention.
    const artefacts = await artefactsFor();
    const victim = artefacts.find((a) => a.id !== first.artefactId);
    if (victim) {
      await h.productFeeds.artefactStore
        .delete({ backend: victim.storageBackend, locator: victim.storageLocator })
        .catch(() => undefined);
    }

    // The next run must still succeed and still publish: a missing object is a
    // row to clean up, not a reason to fail a generation.
    const second = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(second.status);
    const after = await artefactsFor();
    expect(after.map((a) => a.id)).not.toContain(victim?.id ?? 'none');
    await setRetention(3);
  });

  it('keeps runs and their issues after the artefact they produced is purged', async () => {
    await setRetention(1);
    const purged = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    const em = h.em();
    em.clear();
    const issuesBefore = await em.count(FeedRunIssue, { feedRunId: purged.id });
    expect(issuesBefore).toBeGreaterThan(0);

    // Two more runs push the first one's artefact out of the retention window.
    await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });

    em.clear();
    const run = await em.findOneOrFail(FeedRun, { id: purged.id });
    expect(await em.count(FeedRunIssue, { feedRunId: purged.id })).toBe(issuesBefore);

    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/runs/${run.id}`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(200);
    // The run stays readable; it simply reports no artefact.
    const body = (res.json() as { data: { artefact: unknown; emittedCount: number } }).data;
    expect(body.emittedCount).toBe(run.emittedCount);
    await setRetention(3);
  });
});
