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

/**
 * The module-wide taxonomy-check schedule, as a port — feature 067 / FR-087,
 * FR-089.
 *
 * Its desired state is a single boolean: **this scheduler exists iff
 * `product_feeds.taxonomy_fetch_enabled` is true**. Turning the switch off
 * therefore *deletes* the job rather than leaving one that wakes weekly and
 * gives up, which is what makes "off means no outbound request whatsoever" a
 * structural claim rather than a code-review claim.
 *
 * A port rather than a direct BullMQ call for the reason everything else here
 * is one: the test harness carries no Redis, and a no-op default keeps that
 * true without a null check at every call site.
 */
export interface TaxonomyRefreshSchedulePort {
  ensure(cron: string): Promise<void>;
  remove(): Promise<void>;
}

export const noopTaxonomyRefreshSchedule: TaxonomyRefreshSchedulePort = {
  async ensure(): Promise<void> {
    /* no scheduler backend configured */
  },
  async remove(): Promise<void> {
    /* no scheduler backend configured */
  },
};

export interface FeedScheduleReconcilerDeps {
  emFactory: () => EntityManager;
  scheduler: FeedScheduler;
  /** Present only where a queue is; defaults to the no-op. */
  taxonomyRefreshSchedule?: TaxonomyRefreshSchedulePort;
  /** Reads `taxonomy_fetch_enabled` / `taxonomy_fetch_cron` from Settings. */
  taxonomyRefreshSettings?: {
    enabled(): Promise<boolean>;
    cron(): Promise<string>;
  };
}

export class FeedScheduleReconciler {
  constructor(private readonly deps: FeedScheduleReconcilerDeps) {}

  /**
   * Asserts the taxonomy-check schedule from the setting (FR-087, FR-089).
   *
   * Never throws: Redis being unreachable must not fail a boot or a settings
   * save, and the next reconcile repairs it. The consequence of a missed
   * removal is a job that runs a check nobody asked for, which the refresh
   * service itself refuses when the switch is off — belt and braces, because
   * "no outbound request" is a promise made to an operator, not an aspiration.
   */
  async reconcileTaxonomyRefreshSchedule(): Promise<'installed' | 'removed' | 'skipped'> {
    // command-coverage-ignore: derived index. Projects the already-committed
    // `product_feeds.taxonomy_fetch_enabled` setting into BullMQ; the audited
    // write is the Settings module's own.
    const settings = this.deps.taxonomyRefreshSettings;
    const schedule = this.deps.taxonomyRefreshSchedule ?? noopTaxonomyRefreshSchedule;
    if (!settings) return 'skipped';
    try {
      if (await settings.enabled()) {
        await schedule.ensure(await settings.cron());
        return 'installed';
      }
      await schedule.remove();
      return 'removed';
    } catch {
      return 'skipped';
    }
  }

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
 * The registration itself lives in this module's `backend.ts` and goes through
 * `ctx.subscribe` (issue #107). As a bare `eventBus.on` it kept re-asserting Job
 * Schedulers in Redis for a module the operator had switched off — the feeds
 * would then generate on schedule while every route serving them refused.
 */
export async function syncFeedScheduleFromEvent(
  schedules: Pick<FeedScheduleReconciler, 'syncOne'>,
  payload: unknown,
): Promise<void> {
  const feedId = (payload as { feedId?: string } | null)?.feedId;
  if (!feedId) return;
  await schedules.syncOne(feedId);
}

/** The two settings whose value decides whether the check scheduler exists. */
const TAXONOMY_SCHEDULE_SETTING_CODES = new Set([
  'product_feeds.taxonomy_fetch_enabled',
  'product_feeds.taxonomy_fetch_cron',
]);

/**
 * Makes the taxonomy master switch take effect immediately — feature 067 /
 * FR-087, FR-089, research §R21.
 *
 * The Settings module emits `settings.value_changed` on commit, so reacting to
 * it means turning the switch off removes the Job Scheduler at that moment
 * rather than at the next boot. An operator who has just been told the platform
 * will stop contacting Google should not have to restart it to make that true.
 *
 * `backend.ts` registers this through `ctx.subscribe`, so the reconcile it
 * triggers re-reads the two settings *after* the kernel's cache invalidator has
 * dropped them: that invalidator subscribes in `composeSettingsKernel`, which
 * runs before any module registers, and the bus dispatches in registration
 * order.
 */
export async function syncTaxonomyScheduleFromEvent(
  schedules: Pick<FeedScheduleReconciler, 'reconcileTaxonomyRefreshSchedule'>,
  payload: unknown,
): Promise<void> {
  const settingCode = (payload as { settingCode?: string } | null)?.settingCode;
  if (!settingCode || !TAXONOMY_SCHEDULE_SETTING_CODES.has(settingCode)) return;
  await schedules.reconcileTaxonomyRefreshSchedule();
}
