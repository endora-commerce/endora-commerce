import type { EntityManager } from '@mikro-orm/postgresql';
import { ProductFeed } from '../entities/product-feed.entity.js';
import type {
  FeedScheduleSpec,
  FeedScheduler,
  ReconcileResult,
} from './queues/feed-scheduler.js';

/**
 * Postgres → Redis schedule reconciliation — feature 067 / FR-031,
 * research §R5.2, T074.
 *
 * **Postgres is the source of truth and Redis is a derived index.** This class
 * is the only thing that makes that claim true rather than aspirational: it
 * loads the desired state from `product_feeds` and asserts it onto the
 * scheduler, so every way Redis can be wrong converges at the next boot —
 *
 *  - Redis flushed, or restored from an old snapshot ⇒ missing schedulers are
 *    re-upserted;
 *  - a crash between the Postgres commit and the Redis call ⇒ the same;
 *  - a feed disabled or deleted while Redis was unreachable ⇒ the orphaned
 *    `feed:*` scheduler is removed.
 *
 * A flushed Redis therefore costs at most one missed tick, and never a feed
 * that silently stops regenerating.
 *
 * It also writes `next_run_at` back onto the feed rows, from BullMQ's own
 * computation. That column is **display only** — it is what the list page shows
 * — and is deliberately never read to decide whether to run. Nothing in this
 * module parses cron (`cron-parser` is not resolvable from `backend/`, and
 * hand-rolled DST arithmetic is the classic way to break a scheduler).
 */

export interface FeedScheduleReconcilerDeps {
  emFactory: () => EntityManager;
  scheduler: FeedScheduler;
}

export class FeedScheduleReconciler {
  constructor(private readonly deps: FeedScheduleReconcilerDeps) {}

  /**
   * The desired state: every feed that is enabled **and** carries a complete
   * schedule. A feed missing either half has no scheduler, which is what makes
   * "disable the feed" a complete operation on its own.
   */
  async desiredSpecs(): Promise<FeedScheduleSpec[]> {
    const feeds = await this.deps.emFactory().find(ProductFeed, {
      enabled: true,
      scheduleCron: { $ne: null },
      scheduleTimezone: { $ne: null },
    });
    return feeds
      .filter((feed) => !!feed.scheduleCron && !!feed.scheduleTimezone)
      .map((feed) => ({
        productFeedId: feed.id,
        pattern: String(feed.scheduleCron),
        timezone: String(feed.scheduleTimezone),
      }));
  }

  /** Re-assert the whole desired state, then cache the next occurrences. */
  async reconcile(): Promise<ReconcileResult> {
    const specs = await this.desiredSpecs();
    const result = await this.deps.scheduler.reconcile(specs);
    await this.cacheNextRunTimes();
    return result;
  }

  /**
   * One feed's schedule, after its row was committed (research §R5.4).
   *
   * Never throws: Redis being unreachable must not fail an operator's save of a
   * feed that is already committed. The reconciler repairs it at the next boot,
   * and the claim's `enabled = true` predicate keeps a stale scheduler harmless
   * in the meantime.
   */
  async syncOne(productFeedId: string): Promise<void> {
    // command-coverage-ignore: derived index. Postgres is the source of truth for
    // a schedule; this projects an already-committed feed row into BullMQ and
    // caches the next occurrence. The operator's write is the feed Command that
    // emitted the event this reacts to.
    try {
      const feed = await this.deps.emFactory().findOne(ProductFeed, { id: productFeedId });
      if (!feed || !feed.enabled || !feed.scheduleCron || !feed.scheduleTimezone) {
        await this.deps.scheduler.remove(productFeedId);
        await this.clearNextRunTime(productFeedId);
        return;
      }
      await this.deps.scheduler.upsert({
        productFeedId,
        pattern: feed.scheduleCron,
        timezone: feed.scheduleTimezone,
      });
      await this.cacheNextRunTimes();
    } catch {
      /* Redis is a derived index; the next boot repairs it. */
    }
  }

  /** A deleted feed: remove the scheduler so no tick can fire for a missing row. */
  async removeOne(productFeedId: string): Promise<void> {
    // command-coverage-ignore: derived index — removes the BullMQ scheduler of a
    // feed whose deletion was already audited by its Command.
    try {
      await this.deps.scheduler.remove(productFeedId);
    } catch {
      /* Orphan cleared by the next `reconcile()`. */
    }
  }

  /**
   * Copies BullMQ's computed next occurrence onto the feed rows for display
   * (FR-055). Feeds with no scheduler are cleared in the same pass, so the list
   * page cannot show a next run for a schedule that no longer exists.
   */
  private async cacheNextRunTimes(): Promise<void> {
    // command-coverage-ignore: display cache (FR-055). Copies BullMQ's computed
    // next occurrence onto `product_feeds.next_run_at`; no domain state changes.
    const entries = await this.deps.scheduler.list();
    const em = this.deps.emFactory();
    const byId = new Map(entries.map((entry) => [entry.productFeedId, entry.nextRunAt]));
    const feeds = await em.find(ProductFeed, {});
    let dirty = false;
    for (const feed of feeds) {
      const next = byId.get(feed.id) ?? null;
      const current = feed.nextRunAt ?? null;
      if ((current?.getTime() ?? null) === (next?.getTime() ?? null)) continue;
      feed.nextRunAt = next;
      dirty = true;
    }
    if (dirty) await em.flush();
  }

  private async clearNextRunTime(productFeedId: string): Promise<void> {
    // command-coverage-ignore: display cache — the other half of
    // `cacheNextRunTimes`, clearing a stale next-run stamp.
    const em = this.deps.emFactory();
    const feed = await em.findOne(ProductFeed, { id: productFeedId });
    if (!feed || feed.nextRunAt == null) return;
    feed.nextRunAt = null;
    await em.flush();
  }
}

export interface FeedScheduleSyncHandle {
  dispose: () => void;
}

export interface ScheduleEventBus {
  on(eventName: string, handler: (payload: unknown) => void | Promise<void>): () => void;
}

/**
 * Keeps Redis following Postgres for every write path at once — feature 067 /
 * research §R5.4.
 *
 * `product_feeds.feed_changed` is emitted by the Command Bus **on commit**, so
 * subscribing here rather than calling the scheduler from
 * `ProductFeedService` gives the required ordering for free: the row is
 * durable before Redis is touched, and a Redis failure can never roll back a
 * feed the operator was told was saved.
 *
 * One handler covers create, update, duplicate, disable, re-enable, schedule
 * edit **and** delete, because `syncOne` derives the desired state from the row:
 * a feed that is gone, disabled or unscheduled has its scheduler removed, and
 * anything else is upserted. Enumerating the events instead would be one
 * `switch` that has to be updated every time a write path is added — and the
 * symptom of forgetting is an orphaned scheduler nobody notices.
 *
 * Returns `dispose()` for deterministic teardown, matching
 * `attachFeedCacheInvalidator` and the sales-channels invalidator it copies.
 */
export function attachFeedScheduleSync(
  eventBus: ScheduleEventBus,
  schedules: Pick<FeedScheduleReconciler, 'syncOne'>,
): FeedScheduleSyncHandle {
  const onChange = async (payload: unknown): Promise<void> => {
    const feedId = (payload as { feedId?: string } | null)?.feedId;
    if (!feedId) return;
    await schedules.syncOne(feedId);
  };

  const off = eventBus.on('product_feeds.feed_changed', onChange);
  return {
    dispose() {
      off();
    },
  };
}
