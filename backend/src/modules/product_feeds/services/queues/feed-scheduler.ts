import type { Queue } from 'bullmq';
import type { FeedGenerationJobData } from './feed-generation-queue.js';

/**
 * FeedScheduler — feature 067 / FR-031, research §R5.
 *
 * The seam between "this feed runs on a cron" and BullMQ's Job Schedulers. It
 * is an interface, with a no-op default, for one specific reason: the backend
 * test harness (`backend/test/helpers/test-server.ts`) runs once per test file
 * in a single fork, and wiring Redis into it has previously taken ~225 test
 * files down with "too many clients" — a failure a targeted run never shows.
 * Tests therefore get a scheduler that opens no connection; the real one is
 * injected in `composition.ts` only when Redis is configured.
 *
 * **Postgres is the source of truth.** A feed's schedule lives on
 * `product_feeds.schedule_cron` / `.schedule_timezone`; the Redis Job Scheduler
 * is a derived index. The write path is: commit to Postgres, then touch Redis.
 * A Redis failure is logged, not surfaced — `reconcile()` at the next boot
 * repairs it, so a flushed Redis costs at most one missed tick.
 *
 * Scheduler ids are `feed:<productFeedId>`, which is what makes `reconcile()`
 * able to tell this module's schedulers apart from anything else on the queue.
 *
 * **Cron is never parsed here.** `upsertJobScheduler({ pattern, tz })` hands the
 * expression and the IANA zone to BullMQ, which owns next-occurrence and DST
 * arithmetic through the `cron-parser` it already bundles. We never import that
 * package (it is not resolvable from `backend/`), and `nextRunAt` is read back
 * from `getJobSchedulers()` rather than computed (research §R5, §R5.5).
 */

export const FEED_SCHEDULER_ID_PREFIX = 'feed:';

export function feedSchedulerId(productFeedId: string): string {
  return `${FEED_SCHEDULER_ID_PREFIX}${productFeedId}`;
}

export function productFeedIdFromSchedulerId(schedulerId: string): string | null {
  return schedulerId.startsWith(FEED_SCHEDULER_ID_PREFIX)
    ? schedulerId.slice(FEED_SCHEDULER_ID_PREFIX.length)
    : null;
}

export interface FeedScheduleSpec {
  productFeedId: string;
  /** 5-field cron expression, already validated by `cronExpressionSchema`. */
  pattern: string;
  /** IANA timezone; BullMQ evaluates DST against it. */
  timezone: string;
}

export interface FeedSchedulerEntry {
  productFeedId: string;
  pattern: string;
  timezone: string | null;
  /** Next occurrence as BullMQ computed it, or null when it could not say. */
  nextRunAt: Date | null;
}

export interface FeedScheduler {
  /** Create or update the schedule for one feed. Idempotent. */
  upsert(spec: FeedScheduleSpec): Promise<void>;
  /** Remove a feed's schedule. Removing an absent one is not an error. */
  remove(productFeedId: string): Promise<void>;
  /** Every schedule this module currently holds, for display and reconciliation. */
  list(): Promise<FeedSchedulerEntry[]>;
  /**
   * Re-assert Redis from Postgres: upsert every enabled+scheduled feed, remove
   * every `feed:*` id with no live counterpart. Idempotent by construction.
   */
  reconcile(specs: FeedScheduleSpec[]): Promise<ReconcileResult>;
}

/**
 * The default implementation: does nothing, successfully. Used whenever Redis
 * is absent (tests, an API-only process that must not own schedules), so no
 * caller needs a null check and no test opens a connection.
 */
export class NoopFeedScheduler implements FeedScheduler {
  async upsert(): Promise<void> {
    /* no scheduler backend configured */
  }

  async remove(): Promise<void> {
    /* no scheduler backend configured */
  }

  async list(): Promise<FeedSchedulerEntry[]> {
    return [];
  }

  async reconcile(): Promise<ReconcileResult> {
    return { upserted: 0, removed: 0, failed: 0 };
  }
}

// ---------------------------------------------------------------------------
// The reconcile algorithm, separated from the transport
// ---------------------------------------------------------------------------

/**
 * The three scheduler operations, narrowed to what reconciliation needs. Split
 * out from `FeedScheduler` so the algorithm above can be exercised against an
 * in-memory fake — see the note about Redis in the test harness.
 */
export interface SchedulerBackendEntry {
  id: string;
  pattern: string | null;
  tz: string | null;
  /** Epoch milliseconds of the next occurrence, as BullMQ reports it. */
  next: number | null;
}

export interface SchedulerBackend {
  upsert(id: string, pattern: string, tz: string): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<SchedulerBackendEntry[]>;
}

export interface ReconcileResult {
  upserted: number;
  removed: number;
  /** Operations Redis refused. Counted, never swallowed (research §R5.2). */
  failed: number;
}

/**
 * Assert the desired state, then remove our orphans.
 *
 * Ordering matters: upserts run **first**, so a reconcile interrupted halfway
 * leaves a feed over-scheduled (harmless — the claim in `feed-run.service.ts`
 * refuses the overlap) rather than under-scheduled (a silently dead feed).
 *
 * Ownership is decided purely by the `feed:` id prefix. Anything else on the
 * queue belongs to another module and is left strictly alone; reconciliation
 * that "cleans up" a neighbour's scheduler is an outage, not a repair.
 *
 * A backend failure is counted and reconciliation continues. Redis being down
 * must not stop the process from booting or from repairing the feeds it can:
 * Postgres still holds the truth, and the next boot tries again.
 */
export async function reconcileSchedulers(
  backend: SchedulerBackend,
  specs: ReadonlyArray<FeedScheduleSpec>,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { upserted: 0, removed: 0, failed: 0 };
  const desired = new Set<string>();

  for (const spec of specs) {
    const id = feedSchedulerId(spec.productFeedId);
    desired.add(id);
    try {
      await backend.upsert(id, spec.pattern, spec.timezone);
      result.upserted += 1;
    } catch {
      result.failed += 1;
    }
  }

  let existing: SchedulerBackendEntry[];
  try {
    existing = await backend.list();
  } catch {
    result.failed += 1;
    return result;
  }

  // command-coverage-ignore: Redis-only. `backend.remove` here drops a BullMQ Job
  // Scheduler, not a database row; Postgres remains the source of truth for
  // schedules and this pass only makes the derived index agree with it.
  for (const entry of existing) {
    if (productFeedIdFromSchedulerId(entry.id) === null) continue;
    if (desired.has(entry.id)) continue;
    try {
      await backend.remove(entry.id);
      result.removed += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// The BullMQ-backed implementation
// ---------------------------------------------------------------------------

/**
 * `Queue` methods verified present on the pinned `bullmq@5.76.1`:
 * `upsertJobScheduler`, `getJobSchedulers`, `removeJobScheduler`.
 * `RepeatOptions` carries both `pattern` and `tz`, which is what puts DST on
 * BullMQ's code rather than ours.
 */
export function bullSchedulerBackend(
  queue: Queue<FeedGenerationJobData>,
): SchedulerBackend {
  return {
    async upsert(id, pattern, tz): Promise<void> {
      const productFeedId = productFeedIdFromSchedulerId(id) ?? id;
      await queue.upsertJobScheduler(
        id,
        { pattern, tz },
        {
          name: 'generate',
          // `feedRunId` is empty: a scheduled tick creates its own `queued` run
          // inside the worker, so the row cannot be pre-created by a producer
          // that may fire while a previous run still holds the claim.
          data: { productFeedId, feedRunId: '' },
        },
      );
    },

    async remove(id): Promise<void> {
      await queue.removeJobScheduler(id);
    },

    async list(): Promise<SchedulerBackendEntry[]> {
      const schedulers = await queue.getJobSchedulers();
      return schedulers.map((scheduler) => ({
        id: String(scheduler.key ?? scheduler.name ?? ''),
        pattern: scheduler.pattern ?? null,
        tz: scheduler.tz ?? null,
        next: typeof scheduler.next === 'number' ? scheduler.next : null,
      }));
    },
  };
}

export class BullFeedScheduler implements FeedScheduler {
  private readonly backend: SchedulerBackend;

  constructor(queue: Queue<FeedGenerationJobData>) {
    this.backend = bullSchedulerBackend(queue);
  }

  async upsert(spec: FeedScheduleSpec): Promise<void> {
    await this.backend.upsert(
      feedSchedulerId(spec.productFeedId),
      spec.pattern,
      spec.timezone,
    );
  }

  async remove(productFeedId: string): Promise<void> {
    // command-coverage-ignore: Redis-only — removes this feed's BullMQ Job
    // Scheduler. The audited write is the feed Command that made it obsolete.
    await this.backend.remove(feedSchedulerId(productFeedId));
  }

  async list(): Promise<FeedSchedulerEntry[]> {
    const entries = await this.backend.list();
    const out: FeedSchedulerEntry[] = [];
    for (const entry of entries) {
      const productFeedId = productFeedIdFromSchedulerId(entry.id);
      if (productFeedId === null) continue;
      out.push({
        productFeedId,
        pattern: entry.pattern ?? '',
        timezone: entry.tz,
        nextRunAt: entry.next === null ? null : new Date(entry.next),
      });
    }
    return out;
  }

  async reconcile(specs: FeedScheduleSpec[]): Promise<ReconcileResult> {
    return reconcileSchedulers(this.backend, specs);
  }
}
