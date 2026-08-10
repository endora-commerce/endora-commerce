import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { ProductFeed } from '../../../src/modules/product_feeds/entities/product-feed.entity.js';
import { FeedRun } from '../../../src/modules/product_feeds/entities/feed-run.entity.js';
import { FeedRunService } from '../../../src/modules/product_feeds/services/feed-run.service.js';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Feature 067 / T071 — no two runs of the same feed at once (FR-033).
 *
 * The mechanism under test is the conditional `UPDATE`:
 *
 * ```sql
 * UPDATE product_feeds SET current_run_id = :runId
 *  WHERE id = :feedId AND current_run_id IS NULL AND enabled = true
 * ```
 *
 * It is chosen over BullMQ worker concurrency because concurrency is
 * per-process and the guarantee has to hold at N ≥ 2 worker processes
 * (Principle X, research §R5.3).
 *
 * So the tests below **race** the claimants. Each claimant gets its own
 * `EntityManager` fork and its own `FeedRunService` instance — two independent
 * units of work contending for one row, which is what a second worker process
 * is from Postgres's point of view. A sequential "claim, then claim again" test
 * would pass against a completely broken implementation, so it is not used.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/** How many concurrent claimants the N-way race fires. */
const RACERS = 8;

describe('product feed overlap claim [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
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

  async function createFeed(over: Record<string, unknown> = {}): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Claim ${Math.random().toString(36).slice(2, 8)}`,
        slug: `claim-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        ...over,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { feed: { id: string } } }).data.feed.id;
  }

  /**
   * One independent claimant: its own EM fork and its own service instance, so
   * nothing is shared but the database row. This is the closest a single-process
   * test can get to a second worker, and it is close enough — the guarantee is
   * Postgres's, not the process's.
   */
  async function independentClaimant(
    feedId: string,
  ): Promise<{ runId: string; acquired: boolean; skipReason: string | null }> {
    const em = h.orm.em.fork();
    const runs = new FeedRunService(() => em);
    const run = await runs.createQueuedRun({
      productFeedId: feedId,
      trigger: 'scheduled',
      triggeredByAdminUserId: null,
    });
    const result = await runs.claim(feedId, run.id);
    return { runId: run.id, acquired: result.acquired, skipReason: result.skipReason };
  }

  describe('two concurrent claimants (FR-033)', () => {
    it('yields exactly one running run and one skipped(already_running)', async () => {
      const feedId = await createFeed();

      const [first, second] = await Promise.all([
        independentClaimant(feedId),
        independentClaimant(feedId),
      ]);

      const acquired = [first, second].filter((r) => r.acquired);
      const refused = [first, second].filter((r) => !r.acquired);
      expect(acquired).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]!.skipReason).toBe('already_running');

      const em = h.orm.em.fork();
      const winner = await em.findOneOrFail(FeedRun, { id: acquired[0]!.runId });
      const loser = await em.findOneOrFail(FeedRun, { id: refused[0]!.runId });
      expect(winner.status).toBe('running');
      expect(winner.startedAt).not.toBeNull();
      expect(loser.status).toBe('skipped');
      expect(loser.skipReason).toBe('already_running');

      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.currentRunId).toBe(acquired[0]!.runId);
    });
  });

  describe(`${RACERS} concurrent claimants`, () => {
    it('still yields exactly one winner — the claim is atomic, not merely ordered', async () => {
      const feedId = await createFeed();

      const results = await Promise.all(
        Array.from({ length: RACERS }, () => independentClaimant(feedId)),
      );

      const winners = results.filter((r) => r.acquired);
      expect(winners).toHaveLength(1);
      for (const loser of results.filter((r) => !r.acquired)) {
        expect(loser.skipReason).toBe('already_running');
      }

      const em = h.orm.em.fork();
      const running = await em.find(FeedRun, { productFeedId: feedId, status: 'running' });
      expect(running).toHaveLength(1);
      const skipped = await em.find(FeedRun, { productFeedId: feedId, status: 'skipped' });
      expect(skipped).toHaveLength(RACERS - 1);
    });
  });

  describe('a disabled feed can never be claimed (the stale-scheduler safety net)', () => {
    it('records skipped(feed_disabled) rather than generating', async () => {
      // The `enabled = true` predicate is what makes a Job Scheduler orphaned by
      // a crash between the Postgres commit and the Redis call harmless
      // (research §R5.2): it fires, and the claim simply refuses it.
      const feedId = await createFeed({ enabled: false });

      const result = await independentClaimant(feedId);

      expect(result.acquired).toBe(false);
      expect(result.skipReason).toBe('feed_disabled');

      const em = h.orm.em.fork();
      const run = await em.findOneOrFail(FeedRun, { id: result.runId });
      expect(run.status).toBe('skipped');
      expect(run.skipReason).toBe('feed_disabled');
      expect(run.startedAt ?? null).toBeNull();

      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.currentRunId ?? null).toBeNull();
    });

    it('refuses even when the feed is disabled *while* schedulers still exist', async () => {
      const feedId = await createFeed();
      const held = await independentClaimant(feedId);
      expect(held.acquired).toBe(true);

      // Release the claim the way a finished run does, then disable the feed.
      const em = h.orm.em.fork();
      await em
        .getConnection()
        .execute(`update "product_feeds" set "current_run_id" = null, "enabled" = false where "id" = ?`, [
          feedId,
        ]);

      const afterDisable = await independentClaimant(feedId);
      expect(afterDisable.acquired).toBe(false);
      expect(afterDisable.skipReason).toBe('feed_disabled');
    });
  });

  describe('the claim is released by the terminal transition', () => {
    it('lets the next claimant through once the previous run finished', async () => {
      const feedId = await createFeed();
      const first = await independentClaimant(feedId);
      expect(first.acquired).toBe(true);

      // A second claimant is refused while the first holds it…
      const blocked = await independentClaimant(feedId);
      expect(blocked.acquired).toBe(false);

      const em = h.orm.em.fork();
      await new FeedRunService(() => em).finish({
        feedId,
        runId: first.runId,
        status: 'completed',
        counters: {
          consideredCount: 1,
          emittedCount: 1,
          skippedCount: 0,
          warningCount: 0,
          issueOverflow: false,
        },
        artefactId: null,
        startedAtMs: Date.now() - 10,
      });

      // …and let through once it has.
      const next = await independentClaimant(feedId);
      expect(next.acquired).toBe(true);

      const check = h.orm.em.fork();
      const feed = await check.findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.currentRunId).toBe(next.runId);
      expect(feed.lastRunId).toBe(first.runId);
    });
  });

  describe('generation itself honours the claim', () => {
    it('a scheduled tick over a running feed records a skipped run, not a second file', async () => {
      const feedId = await createFeed();
      const holder = await independentClaimant(feedId);
      expect(holder.acquired).toBe(true);

      const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'scheduled' });

      expect(run.status).toBe('skipped');
      expect(run.skipReason).toBe('already_running');
      expect(run.emittedCount).toBe(0);

      const em = h.orm.em.fork();
      const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
      // The claim still belongs to the first holder; the tick changed nothing.
      expect(feed.currentRunId).toBe(holder.runId);
      expect(feed.publishedArtefactId ?? null).toBeNull();
    });
  });
});
