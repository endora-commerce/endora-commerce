import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { ProductFeed } from '../../../src/modules/product_feeds/entities/product-feed.entity.js';
import {
  attachFeedScheduleSync,
  FeedScheduleReconciler,
  type FeedScheduleSyncHandle,
} from '../../../src/modules/product_feeds/services/feed-schedule-reconciler.js';
import {
  feedSchedulerId,
  reconcileSchedulers,
  type FeedScheduler,
  type FeedScheduleSpec,
  type FeedSchedulerEntry,
  type ReconcileResult,
  type SchedulerBackend,
  type SchedulerBackendEntry,
} from '../../../src/modules/product_feeds/services/queues/feed-scheduler.js';

/**
 * Feature 067 / T074 — the schedule lifecycle against a real database
 * (FR-031, research §R5.2, §R5.4).
 *
 * T070 proves the reconcile *algorithm* in isolation. This proves the thing an
 * operator actually depends on: that **Postgres is the source of truth**, and
 * that every way a schedule can change — created, edited, disabled, re-enabled,
 * deleted — leaves Redis agreeing with the database and no orphaned scheduler
 * behind.
 *
 * The scheduler here is an in-memory double rather than a live queue. That is
 * not a shortcut: `setupBackendServer()` runs once per test file in a single
 * fork, and adding Redis/BullMQ connections to it has previously taken ~225
 * test files down with "too many clients" (research §R18). The double
 * implements the same interface the BullMQ one does, and the BullMQ one is a
 * thin adapter over three verified `Queue` methods.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

class InMemoryScheduler implements FeedScheduler {
  readonly entries = new Map<string, SchedulerBackendEntry>();
  private nextEpoch = Date.UTC(2026, 7, 3, 4, 0, 0);

  private readonly backend: SchedulerBackend = {
    upsert: async (id, pattern, tz) => {
      this.entries.set(id, { id, pattern, tz, next: this.nextEpoch });
    },
    remove: async (id) => {
      this.entries.delete(id);
    },
    list: async () => [...this.entries.values()],
  };

  async upsert(spec: FeedScheduleSpec): Promise<void> {
    await this.backend.upsert(
      feedSchedulerId(spec.productFeedId),
      spec.pattern,
      spec.timezone,
    );
  }

  async remove(productFeedId: string): Promise<void> {
    await this.backend.remove(feedSchedulerId(productFeedId));
  }

  async list(): Promise<FeedSchedulerEntry[]> {
    return [...this.entries.values()].map((entry) => ({
      productFeedId: entry.id.slice('feed:'.length),
      pattern: entry.pattern ?? '',
      timezone: entry.tz,
      nextRunAt: entry.next === null ? null : new Date(entry.next),
    }));
  }

  async reconcile(specs: FeedScheduleSpec[]): Promise<ReconcileResult> {
    return reconcileSchedulers(this.backend, specs);
  }

  /** Models `FLUSHALL` — an operational reality, not a hypothetical. */
  flush(): void {
    this.entries.clear();
  }

  ids(): string[] {
    return [...this.entries.keys()].sort();
  }
}

describe('product feed schedule lifecycle [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let channelId: string;
  let scheduler: InMemoryScheduler;
  let schedules: FeedScheduleReconciler;
  let sync: FeedScheduleSyncHandle | null = null;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
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
    sync?.dispose();
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    sync?.dispose();
    sync = null;
    // Each case owns the whole desired state, so previous feeds must not leak
    // into the next one's reconcile.
    const em = h.orm.em.fork();
    await em.getConnection().execute(`delete from "product_feeds"`);
  });

  function freshReconciler(): FeedScheduleReconciler {
    scheduler = new InMemoryScheduler();
    schedules = new FeedScheduleReconciler({ emFactory: () => h.orm.em.fork(), scheduler });
    return schedules;
  }

  async function createFeed(over: Record<string, unknown> = {}): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Sched ${Math.random().toString(36).slice(2, 8)}`,
        slug: `sched-${Math.random().toString(36).slice(2, 10)}`,
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

  const WARSAW = { cron: '0 */4 * * *', timezone: 'Europe/Warsaw' };

  describe('the boot reconciler (research §R5.2)', () => {
    it('asserts a scheduler for every enabled, scheduled feed and for nothing else', async () => {
      freshReconciler();
      const scheduled = await createFeed({ schedule: WARSAW });
      const manualOnly = await createFeed();
      const disabled = await createFeed({ schedule: WARSAW, enabled: false });

      const result = await schedules.reconcile();

      expect(scheduler.ids()).toEqual([feedSchedulerId(scheduled)]);
      expect(result.upserted).toBe(1);
      expect(scheduler.entries.get(feedSchedulerId(scheduled))?.pattern).toBe(WARSAW.cron);
      expect(scheduler.entries.get(feedSchedulerId(scheduled))?.tz).toBe('Europe/Warsaw');
      expect(scheduler.entries.has(feedSchedulerId(manualOnly))).toBe(false);
      expect(scheduler.entries.has(feedSchedulerId(disabled))).toBe(false);
    });

    it('rebuilds everything after Redis is flushed — one tick, not one dead feed', async () => {
      freshReconciler();
      const a = await createFeed({ schedule: WARSAW });
      const b = await createFeed({ schedule: { cron: '*/15 * * * *', timezone: 'UTC' } });
      await schedules.reconcile();
      expect(scheduler.ids()).toHaveLength(2);

      scheduler.flush();
      expect(scheduler.ids()).toHaveLength(0);

      const result = await schedules.reconcile();

      expect(scheduler.ids()).toEqual([feedSchedulerId(a), feedSchedulerId(b)].sort());
      expect(result.upserted).toBe(2);
      expect(scheduler.entries.get(feedSchedulerId(b))?.tz).toBe('UTC');
    });

    it('removes a scheduler orphaned by a crash between the commit and the Redis call', async () => {
      freshReconciler();
      const live = await createFeed({ schedule: WARSAW });
      // The exact residue of a feed deleted while Redis was unreachable.
      await scheduler.upsert({
        productFeedId: '00000000-0000-4000-8000-0000000000ff',
        pattern: '0 * * * *',
        timezone: 'UTC',
      });

      const result = await schedules.reconcile();

      expect(scheduler.ids()).toEqual([feedSchedulerId(live)]);
      expect(result.removed).toBe(1);
    });

    it('is idempotent across repeated boots', async () => {
      freshReconciler();
      await createFeed({ schedule: WARSAW });
      const first = await schedules.reconcile();
      const snapshot = new Map(scheduler.entries);
      const second = await schedules.reconcile();

      expect(second.removed).toBe(0);
      expect(first.upserted).toBe(second.upserted);
      expect(scheduler.entries).toEqual(snapshot);
    });

    it('caches BullMQ’s next occurrence onto the feed row for display', async () => {
      freshReconciler();
      const feedId = await createFeed({ schedule: WARSAW });

      await schedules.reconcile();

      const feed = await h.orm.em.fork().findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.nextRunAt).toBeInstanceOf(Date);
      // Display only — never read to decide whether to run.
      expect(feed.nextRunAt!.getTime()).toBe(Date.UTC(2026, 7, 3, 4, 0, 0));
    });
  });

  describe('the write path — Postgres first, Redis after (research §R5.4)', () => {
    /** Subscribes the real sync to the real `feed_changed` event. */
    function attach(): void {
      sync = attachFeedScheduleSync(h.eventBus, freshReconciler());
    }

    it('creates a scheduler when a feed is created with a schedule', async () => {
      attach();
      const feedId = await createFeed({ schedule: WARSAW });
      expect(scheduler.ids()).toEqual([feedSchedulerId(feedId)]);
    });

    it('applies an edited schedule to the same scheduler id', async () => {
      attach();
      const feedId = await createFeed({ schedule: WARSAW });

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
        payload: { schedule: { cron: '*/15 * * * *', timezone: 'Europe/Warsaw' } },
      });
      expect(res.statusCode, res.body).toBe(200);

      expect(scheduler.ids()).toEqual([feedSchedulerId(feedId)]);
      expect(scheduler.entries.get(feedSchedulerId(feedId))?.pattern).toBe('*/15 * * * *');
    });

    it('removes the scheduler when the schedule is cleared', async () => {
      attach();
      const feedId = await createFeed({ schedule: WARSAW });

      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
        payload: { schedule: null },
      });

      expect(scheduler.ids()).toEqual([]);
      const feed = await h.orm.em.fork().findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.nextRunAt ?? null).toBeNull();
    });

    it('removes the scheduler when the feed is disabled, and restores it when re-enabled', async () => {
      attach();
      const feedId = await createFeed({ schedule: WARSAW });
      expect(scheduler.ids()).toHaveLength(1);

      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
        payload: { enabled: false },
      });
      expect(scheduler.ids()).toEqual([]);

      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
        payload: { enabled: true },
      });
      expect(scheduler.ids()).toEqual([feedSchedulerId(feedId)]);
    });

    it('removes the scheduler when the feed is deleted', async () => {
      attach();
      const feedId = await createFeed({ schedule: WARSAW });
      expect(scheduler.ids()).toHaveLength(1);

      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(204);

      expect(scheduler.ids()).toEqual([]);
    });

    it('gives a duplicated feed its own scheduler', async () => {
      attach();
      const feedId = await createFeed({ schedule: WARSAW });
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${feedId}/duplicate`,
        ...ADMIN,
        payload: { name: 'Copy', slug: `copy-${Math.random().toString(36).slice(2, 8)}` },
      });
      expect(res.statusCode, res.body).toBe(201);
      const copyId = (res.json() as { data: { feed: { id: string } } }).data.feed.id;

      expect(scheduler.ids()).toEqual([feedSchedulerId(feedId), feedSchedulerId(copyId)].sort());
    });

    it('does not fail an operator’s save when the scheduler backend is down', async () => {
      // Postgres is the source of truth: a committed feed must stay committed
      // even if Redis refuses, and the next boot repairs the index.
      const broken: FeedScheduler = {
        upsert: async () => {
          throw new Error('redis unavailable');
        },
        remove: async () => {
          throw new Error('redis unavailable');
        },
        list: async () => {
          throw new Error('redis unavailable');
        },
        reconcile: async () => ({ upserted: 0, removed: 0, failed: 1 }),
      };
      sync = attachFeedScheduleSync(
        h.eventBus,
        new FeedScheduleReconciler({ emFactory: () => h.orm.em.fork(), scheduler: broken }),
      );

      const feedId = await createFeed({ schedule: WARSAW });

      const feed = await h.orm.em.fork().findOneOrFail(ProductFeed, { id: feedId });
      expect(feed.scheduleCron).toBe(WARSAW.cron);
      expect(feed.scheduleTimezone).toBe('Europe/Warsaw');
    });
  });

  describe('timezone fidelity (research §R5.5)', () => {
    it('hands the IANA zone to the scheduler verbatim — DST is never computed here', async () => {
      freshReconciler();
      const warsaw = await createFeed({ schedule: { cron: '30 2 * * *', timezone: 'Europe/Warsaw' } });
      const utc = await createFeed({ schedule: { cron: '30 2 * * *', timezone: 'UTC' } });

      await schedules.reconcile();

      // Same pattern, different zones, two distinct schedulers: the zone is part
      // of the schedule, not a display preference. `30 2 * * *` is the classic
      // spring-forward case, and it reaches BullMQ unmodified.
      expect(scheduler.entries.get(feedSchedulerId(warsaw))?.tz).toBe('Europe/Warsaw');
      expect(scheduler.entries.get(feedSchedulerId(utc))?.tz).toBe('UTC');
      expect(scheduler.entries.get(feedSchedulerId(warsaw))?.pattern).toBe('30 2 * * *');
    });
  });
});
