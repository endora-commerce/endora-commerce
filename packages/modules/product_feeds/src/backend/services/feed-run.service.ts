import type { EntityManager } from '@mikro-orm/postgresql';
import type { FeedRunFailureCode, FeedRunStatus, FeedRunTrigger } from '@endora-commerce/contracts';
import { FeedRun, type FeedRunSkipReason } from '../entities/feed-run.entity.js';
import { FeedRunIssue } from '../entities/feed-run-issue.entity.js';

/**
 * Run lifecycle — feature 067 / FR-033, FR-036, FR-038, FR-039, FR-053.
 *
 * The one thing to understand here is the **claim**. Overlap prevention is a
 * conditional `UPDATE` on `product_feeds.current_run_id` (data-model §5), not
 * BullMQ worker concurrency:
 *
 * ```sql
 * UPDATE product_feeds SET current_run_id = :runId
 *  WHERE id = :feedId AND current_run_id IS NULL AND enabled = true;
 * ```
 *
 * It is atomic across N worker processes, which BullMQ concurrency is not, and
 * the `AND enabled = true` clause doubles as the safety net for a stale Job
 * Scheduler left behind by a crash between the Postgres commit and the Redis
 * call (research §R5.2) — a disabled feed simply can never be claimed.
 *
 * Every terminal transition clears the claim **in the same statement** that
 * sets the status, so a crash can never leave a feed claimed by a finished run.
 */

/** Statuses that are allowed to move the publish pointer (FR-035). */
const PUBLISHING_STATUSES: ReadonlySet<FeedRunStatus> = new Set([
  'completed',
  'completed_with_warnings',
]);

export function statusPublishes(status: FeedRunStatus): boolean {
  return PUBLISHING_STATUSES.has(status);
}

export interface ClaimResult {
  acquired: boolean;
  /** Set when the claim failed, so the run is recorded rather than swallowed. */
  skipReason: FeedRunSkipReason | null;
}

export interface RunCounters {
  consideredCount: number;
  emittedCount: number;
  skippedCount: number;
  warningCount: number;
  issueOverflow: boolean;
}

/**
 * Decides the terminal status of a run that produced output without erroring.
 *
 * Both guards exist to protect a **good published artefact** from being
 * replaced by a bad one, which is the failure mode an operator cannot see until
 * a provider disables their account:
 *  - zero items ⇒ `empty` (FR-039);
 *  - too large a skipped share ⇒ `failed(skip_threshold_exceeded)` (FR-038).
 */
export function terminalStatusFor(
  counters: RunCounters,
  skipShareThreshold: number,
): { status: FeedRunStatus; failureCode: FeedRunFailureCode | null } {
  if (counters.emittedCount === 0) return { status: 'empty', failureCode: null };
  const considered = counters.consideredCount || counters.emittedCount + counters.skippedCount;
  const skippedShare = considered > 0 ? counters.skippedCount / considered : 0;
  if (skippedShare > skipShareThreshold) {
    return { status: 'failed', failureCode: 'skip_threshold_exceeded' };
  }
  if (counters.skippedCount > 0 || counters.warningCount > 0) {
    return { status: 'completed_with_warnings', failureCode: null };
  }
  return { status: 'completed', failureCode: null };
}

export interface CreateRunInput {
  productFeedId: string;
  trigger: FeedRunTrigger;
  triggeredByAdminUserId: string | null;
}

export class FeedRunService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /** Creates the `queued` row the enqueued job will later claim against. */
  async createQueuedRun(input: CreateRunInput): Promise<FeedRun> {
    // command-coverage-ignore: run bookkeeping (FR-053). The operator-visible
    // write is `product_feeds.run.start`, which calls this; a scheduled tick has
    // no actor by design (FR-060). The row is the run's own progress record.
    const em = this.emFactory();
    const run = em.create(FeedRun, {
      productFeedId: input.productFeedId,
      trigger: input.trigger,
      triggeredByAdminUserId: input.triggeredByAdminUserId,
      status: 'queued',
    });
    await em.persistAndFlush(run);
    return run;
  }

  /**
   * The atomic claim (data-model §5). One row updated ⇒ acquired; zero rows ⇒
   * the feed is busy or disabled, and which one is distinguishable by a second
   * read that happens only on the failure path.
   */
  async claim(feedId: string, runId: string): Promise<ClaimResult> {
    const em = this.emFactory();
    const conn = em.getConnection();
    const updated = (await conn.execute(
      `update "product_feeds"
          set "current_run_id" = ?, "updated_at" = now()
        where "id" = ? and "current_run_id" is null and "enabled" = true
        returning "id"`,
      [runId, feedId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string }>;

    if (updated.length === 1) {
      await conn.execute(
        `update "product_feed_runs"
            set "status" = 'running', "started_at" = now(), "heartbeat_at" = now()
          where "id" = ?`,
        [runId],
        'run',
        em.getTransactionContext(),
      );
      return { acquired: true, skipReason: null };
    }

    const rows = (await conn.execute(
      `select "current_run_id", "enabled" from "product_feeds" where "id" = ?`,
      [feedId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ current_run_id: string | null; enabled: boolean }>;
    const row = rows[0];
    const skipReason: FeedRunSkipReason =
      row && row.current_run_id !== null ? 'already_running' : 'feed_disabled';

    await conn.execute(
      `update "product_feed_runs"
          set "status" = 'skipped', "skip_reason" = ?, "finished_at" = now()
        where "id" = ?`,
      [skipReason, runId],
      'run',
      em.getTransactionContext(),
    );
    return { acquired: false, skipReason };
  }

  /**
   * True while a pre-created run row is still waiting to be picked up.
   *
   * The generation consumer asks this before acting on a **manual** job, so a
   * BullMQ redelivery of an already-finished run is dropped instead of
   * overwriting the counters an operator is reading. The claim would refuse the
   * overlap anyway; this refuses the pointless second attempt one step earlier,
   * and without inventing a spurious `skipped` row for it.
   */
  async isClaimable(runId: string): Promise<boolean> {
    const run = await this.emFactory().findOne(FeedRun, { id: runId });
    return run?.status === 'queued';
  }

  /** Refreshed once per hydrated batch; the reaper's only input (FR-036). */
  async heartbeat(runId: string): Promise<void> {
    const em = this.emFactory();
    await em
      .getConnection()
      .execute(
        `update "product_feed_runs" set "heartbeat_at" = now() where "id" = ?`,
        [runId],
        'run',
        em.getTransactionContext(),
      );
  }

  /**
   * The single terminal transition. Status, counters, artefact pointer, the
   * claim release and the feed's `last_run_id` all move together — a partial
   * application of this is exactly the state the reaper exists to clean up, and
   * there is no reason to ever produce it deliberately.
   *
   * The publish pointer moves only for a publishing status (FR-035, FR-039).
   */
  async finish(input: {
    feedId: string;
    runId: string;
    status: FeedRunStatus;
    counters: RunCounters;
    failureCode?: FeedRunFailureCode | null;
    failureDetail?: string | null;
    artefactId?: string | null;
    startedAtMs: number;
  }): Promise<FeedRun> {
    const em = this.emFactory();
    const durationMs = Math.max(0, Date.now() - input.startedAtMs);
    const publishes = statusPublishes(input.status) && input.artefactId != null;

    await em.transactional(async (tx) => {
      const conn = tx.getConnection();
      await conn.execute(
        `update "product_feed_runs"
            set "status" = ?, "finished_at" = now(), "duration_ms" = ?,
                "considered_count" = ?, "emitted_count" = ?, "skipped_count" = ?,
                "warning_count" = ?, "issue_overflow" = ?, "failure_code" = ?,
                "failure_detail" = ?, "artefact_id" = ?
          where "id" = ?`,
        [
          input.status,
          durationMs,
          input.counters.consideredCount,
          input.counters.emittedCount,
          input.counters.skippedCount,
          input.counters.warningCount,
          input.counters.issueOverflow,
          input.failureCode ?? null,
          input.failureDetail ?? null,
          input.artefactId ?? null,
          input.runId,
        ],
        'run',
        tx.getTransactionContext(),
      );

      // command-coverage-ignore: machine transition inside an operation already
      // audited at `product_feeds.run.start` (research §R17). Auditing it would
      // add one audit row per scheduled run, forever, burying the operator's
      // own decisions in machine noise.
      await conn.execute(
        `update "product_feeds"
            set "current_run_id" = null,
                "last_run_id" = ?,
                "published_artefact_id" = case when ? then ? else "published_artefact_id" end,
                "avg_run_duration_ms" = case
                  when "avg_run_duration_ms" is null then ?
                  else (("avg_run_duration_ms" * 3) + ?) / 4
                end,
                "updated_at" = now()
          where "id" = ? and ("current_run_id" = ? or "current_run_id" is null)`,
        [
          input.runId,
          publishes,
          input.artefactId ?? null,
          durationMs,
          durationMs,
          input.feedId,
          input.runId,
        ],
        'run',
        tx.getTransactionContext(),
      );
    });

    em.clear();
    return em.findOneOrFail(FeedRun, { id: input.runId });
  }

  /**
   * Records one item-level issue, up to the settings-driven per-run cap.
   * Returns false once the cap is reached so the caller can flip
   * `issueOverflow` — a systemic defect over 100k products would otherwise make
   * this the largest table in the database (FR-054).
   *
   * **The caller supplies the `EntityManager`.** `emFactory()` is
   * `orm.em.fork()`, so it hands back a *new* manager on every call: persisting
   * into one obtained here would drop the row on the floor, because the fork is
   * discarded before anything flushes it. The generation pipeline already owns a
   * per-run manager it flushes and clears once per batch, and that is the one
   * these rows have to land on.
   */
  recordIssue(
    em: EntityManager,
    runId: string,
    issue: {
      severity: 'skip' | 'warning';
      reason: FeedRunIssue['reason'];
      productId: string | null;
      variantId: string | null;
      sku: string | null;
      outputName: string | null;
      detail: string | null;
    },
    written: number,
    cap: number,
  ): boolean {
    // command-coverage-ignore: per-item diagnostics (FR-054) — one row per skip
    // or warning inside a run, capped and purely observational.
    if (written >= cap) return false;
    em.persist(
      em.create(FeedRunIssue, {
        feedRunId: runId,
        severity: issue.severity,
        reason: issue.reason,
        productId: issue.productId,
        variantId: issue.variantId,
        sku: issue.sku,
        outputName: issue.outputName,
        detail: issue.detail ? issue.detail.slice(0, 255) : null,
      }),
    );
    return true;
  }
}
