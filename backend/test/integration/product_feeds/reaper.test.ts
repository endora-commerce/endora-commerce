import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { FeedRunService } from '../../../../packages/modules/product_feeds/src/backend/services/feed-run.service.js';
import { setChannelStorefrontUrl, seedFeedPrices } from '../../helpers/seed-product-feeds.js';
import { FeedArtefact, FeedRun, ProductFeed } from '../../helpers/package-entities.js';

/**
 * Feature 067 / T072 — releasing a claim held by a worker that died (FR-036).
 *
 * The claim in `feed-run.service.ts` is what stops two runs overlapping. Its
 * cost is that a worker killed mid-run holds `current_run_id` forever, and the
 * feed silently never generates again — the worst kind of outage, because
 * nothing is on fire and nobody is paged.
 *
 * The reaper is the counterweight: a `running` run whose `heartbeat_at` went
 * stale becomes `failed(worker_lost)`, the claim is released, and the half
 * written object is deleted. The one thing it must **never** touch is the
 * previously published artefact — publication is the last step of a run, so a
 * run that died never published, and the merchant's live feed must keep serving
 * throughout.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const PUBLISHING_STATUSES = ['completed', 'completed_with_warnings'];

/** Comfortably past the default 30-minute stale-claim timeout. */
const LONG_AGO_MINUTES = 90;

describe('product feed run reaper [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    await seedFeedPrices(em, { code: 'feed_reaper_list' });
    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createFeed(): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Reaped ${Math.random().toString(36).slice(2, 8)}`,
        slug: `reaped-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { feed: { id: string } } }).data.feed.id;
  }

  /** A run that claimed the feed and then had its worker killed. */
  async function abandonedRun(
    feedId: string,
    minutesAgo = LONG_AGO_MINUTES,
  ): Promise<string> {
    const em = h.orm.em.fork();
    const run = await new FeedRunService(() => em).createQueuedRun({
      productFeedId: feedId,
      trigger: 'scheduled',
      triggeredByAdminUserId: null,
    });
    const claim = await new FeedRunService(() => em).claim(feedId, run.id);
    expect(claim.acquired).toBe(true);
    await em
      .getConnection()
      .execute(
        `update "product_feed_runs"
            set "heartbeat_at" = now() - (? || ' minutes')::interval
          where "id" = ?`,
        [String(minutesAgo), run.id],
      );
    return run.id;
  }

  describe('a stale claim (FR-036)', () => {
    it('becomes failed(worker_lost) and releases the feed', async () => {
      const feedId = await createFeed();
      const runId = await abandonedRun(feedId);

      const result = await h.productFeeds.reaper.releaseStaleClaims();
      expect(result.released).toBeGreaterThanOrEqual(1);

      const em = h.orm.em.fork();
      const run = await em.findOneOrFail(FeedRun, { id: runId });
      expect(run.status).toBe('failed');
      expect(run.failureCode).toBe('worker_lost');
      expect(run.finishedAt).not.toBeNull();

      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.currentRunId ?? null).toBeNull();
      // The released feed must be immediately claimable again — a reaper that
      // marks the run but leaves the feed stuck has fixed nothing.
      expect(feed.lastRunId).toBe(runId);
    });

    it('lets the feed generate again straight afterwards', async () => {
      const feedId = await createFeed();
      await abandonedRun(feedId);
      await h.productFeeds.reaper.releaseStaleClaims();

      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(PUBLISHING_STATUSES).toContain(run.status);
      expect(run.emittedCount).toBeGreaterThan(0);
    });

    it('deletes the orphaned object of the run that never published', async () => {
      const feedId = await createFeed();
      const runId = await abandonedRun(feedId);

      // The half-written artefact row a killed worker leaves behind: metadata
      // persisted, never published.
      const em = h.orm.em.fork();
      const artefact = em.create(FeedArtefact, {
        productFeedId: feedId,
        feedRunId: runId,
        kind: 'feed',
        storageBackend: 'local',
        storageLocator: `product-feeds/or/ph/${runId}.xml`,
        contentType: 'application/xml',
        byteSize: 10,
        itemCount: 0,
      });
      await em.persistAndFlush(artefact);
      const artefactId = artefact.id;

      await h.productFeeds.reaper.releaseStaleClaims();

      const check = h.orm.em.fork();
      expect(await check.findOne(FeedArtefact, { id: artefactId })).toBeNull();
    });

    it('tolerates a storage object that is already gone', async () => {
      const feedId = await createFeed();
      const runId = await abandonedRun(feedId);
      const em = h.orm.em.fork();
      await em.persistAndFlush(
        em.create(FeedArtefact, {
          productFeedId: feedId,
          feedRunId: runId,
          kind: 'feed',
          storageBackend: 'local',
          storageLocator: 'product-feeds/no/su/ch-object-anywhere.xml',
          contentType: 'application/xml',
          byteSize: 0,
          itemCount: 0,
        }),
      );

      await expect(h.productFeeds.reaper.releaseStaleClaims()).resolves.toBeTruthy();

      const check = h.orm.em.fork();
      const run = await check.findOneOrFail(FeedRun, { id: runId });
      expect(run.status).toBe('failed');
    });
  });

  describe('the published artefact is untouched', () => {
    it('keeps serving while a later run is reaped', async () => {
      const feedId = await createFeed();
      const good = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
      expect(PUBLISHING_STATUSES).toContain(good.status);

      const before = await h.orm.em.fork().findOneOrFail(ProductFeed, { id: feedId });
      const publishedArtefactId = before.publishedArtefactId;
      expect(publishedArtefactId).not.toBeNull();

      const runId = await abandonedRun(feedId);
      await h.productFeeds.reaper.releaseStaleClaims();

      const em = h.orm.em.fork();
      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.publishedArtefactId).toBe(publishedArtefactId);
      expect(await em.findOne(FeedArtefact, { id: String(publishedArtefactId) })).not.toBeNull();
      expect((await em.findOneOrFail(FeedRun, { id: runId })).status).toBe('failed');

      // And the bytes are still downloadable — the reaper deleting the wrong
      // object would show up here and nowhere else.
      const download = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
        ...ADMIN,
      });
      expect(download.statusCode).toBe(200);
      expect(download.body.length).toBeGreaterThan(0);
    });
  });

  describe('a healthy run is left alone', () => {
    it('does not reap a run whose heartbeat is recent', async () => {
      const feedId = await createFeed();
      const runId = await abandonedRun(feedId, 0);

      const result = await h.productFeeds.reaper.releaseStaleClaims();

      const em = h.orm.em.fork();
      const run = await em.findOneOrFail(FeedRun, { id: runId });
      expect(run.status).toBe('running');
      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.currentRunId).toBe(runId);
      expect(result.released).toBe(0);
    });

    it('is idempotent — a second sweep releases nothing more', async () => {
      const feedId = await createFeed();
      await abandonedRun(feedId);

      const first = await h.productFeeds.reaper.releaseStaleClaims();
      const second = await h.productFeeds.reaper.releaseStaleClaims();

      expect(first.released).toBeGreaterThanOrEqual(1);
      expect(second.released).toBe(0);
    });
  });
});
