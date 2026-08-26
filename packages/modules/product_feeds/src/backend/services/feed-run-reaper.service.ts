import type { EntityManager } from '@mikro-orm/postgresql';
import { FeedArtefact } from '../entities/feed-artefact.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';
import type { ArtefactStorageBackend, ArtefactStorePort } from './artefact-store.js';

/**
 * Stale-claim reaper — feature 067 / FR-036, research §R5.3.
 *
 * The overlap claim (`product_feeds.current_run_id`) is what stops two runs of
 * one feed overlapping. Its cost is a failure mode with no alarm attached: a
 * worker killed mid-run holds the claim forever, and the feed silently stops
 * regenerating. Nothing errors, nothing pages, and the merchant finds out when
 * their prices are a fortnight old.
 *
 * This sweep is the counterweight. A `running` run whose `heartbeat_at` is
 * older than `product_feeds.stale_claim_timeout_minutes` becomes
 * `failed(worker_lost)`, its claim is released, and the object it was part way
 * through writing is deleted.
 *
 * Three properties matter and are each pinned by a test:
 *
 *  - **The published artefact is never touched.** Publication is the last step
 *    of a run, so a run that died never published; only artefacts belonging to
 *    the dead run, and never the one `published_artefact_id` points at, are
 *    removed. The merchant's live feed keeps serving throughout.
 *  - **A missing storage object is not an error.** The object may never have
 *    been created, or a previous sweep may have removed it; either way the row
 *    still has to go.
 *  - **It is idempotent.** The `status = 'running'` predicate is re-evaluated
 *    per sweep, so a second pass over the same data releases nothing.
 *
 * `heartbeat_at` is compared in SQL, against the database clock, deliberately:
 * a worker and an API process on different hosts with drifting clocks must not
 * disagree about whether a run is alive.
 */

/** Matches the `stale_claim_timeout_minutes` default in the module manifest. */
export const DEFAULT_STALE_CLAIM_TIMEOUT_MINUTES = 30;

export interface ReapResult {
  released: number;
  /** Orphaned artefact rows removed with their storage objects. */
  purgedArtefacts: number;
}

export interface FeedRunReaperDeps {
  emFactory: () => EntityManager;
  artefactStore: ArtefactStorePort;
  /** Reads `product_feeds.stale_claim_timeout_minutes`; falls back to the default. */
  staleTimeoutMinutes: () => Promise<number>;
  /**
   * FR-056 — a run reaped to `failed(worker_lost)` is the failure most in need
   * of a notification: nothing errored anywhere an operator can see, and the
   * feed has simply stopped regenerating. Optional so the sweep works without
   * the notification surface wired.
   */
  notifyFailedRun?: (input: {
    feedId: string;
    runId: string;
    failureCode: 'worker_lost';
    failureDetail: string | null;
  }) => Promise<unknown>;
}

interface StaleRunRow {
  id: string;
  product_feed_id: string;
}

export class FeedRunReaperService {
  constructor(private readonly deps: FeedRunReaperDeps) {}

  /**
   * One sweep. Returns counts so the worker can log something an operator can
   * act on ("released 3") rather than a bare success.
   */
  async releaseStaleClaims(): Promise<ReapResult> {
    // command-coverage-ignore: machine recovery of a claim whose worker died.
    // There is no acting administrator to attribute it to, and the run it
    // repairs was already audited at `product_feeds.run.start` when a human
    // asked for it (research §R17).
    const timeoutMinutes = await this.staleTimeout();
    const em = this.deps.emFactory();
    const conn = em.getConnection();

    const stale = (await conn.execute(
      `select "id", "product_feed_id"
         from "product_feed_runs"
        where "status" = 'running'
          and "heartbeat_at" is not null
          and "heartbeat_at" < now() - (? || ' minutes')::interval`,
      [String(timeoutMinutes)],
      'all',
    )) as StaleRunRow[];

    if (stale.length === 0) return { released: 0, purgedArtefacts: 0 };

    let purgedArtefacts = 0;
    for (const row of stale) {
      purgedArtefacts += await this.purgeOrphanedArtefacts(row.product_feed_id, row.id);
      await this.release(row);
      // Raised after the transition, so the notifier's "did the previous run
      // already fail this way" check reads a database that agrees with reality.
      await this.deps.notifyFailedRun?.({
        feedId: row.product_feed_id,
        runId: row.id,
        failureCode: 'worker_lost',
        failureDetail: 'The worker running this generation stopped responding.',
      });
    }
    em.clear();
    return { released: stale.length, purgedArtefacts };
  }

  private async staleTimeout(): Promise<number> {
    try {
      const value = await this.deps.staleTimeoutMinutes();
      return Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_STALE_CLAIM_TIMEOUT_MINUTES;
    } catch {
      // An unreadable setting must not stop the sweep — a stuck feed is worse
      // than a sweep that used the default threshold.
      return DEFAULT_STALE_CLAIM_TIMEOUT_MINUTES;
    }
  }

  /**
   * Removes the artefacts the dead run produced, bytes first, row second: a
   * deleted row with a surviving object leaks storage silently, while a deleted
   * object with a surviving row is visible and self-corrects on the next sweep.
   *
   * The feed's `published_artefact_id` is excluded explicitly rather than
   * relying on "a dead run cannot have published". That invariant is true today
   * and cheap to assert, and if a future change breaks it the failure would be
   * deleting a live merchant's feed file.
   */
  private async purgeOrphanedArtefacts(feedId: string, runId: string): Promise<number> {
    // command-coverage-ignore: crash cleanup (FR-036). Removes the partial object
    // a lost worker left behind; the published artefact is explicitly protected.
    // A system sweep with no operator behind it, and undoing it would mean
    // restoring bytes that are by definition incomplete.
    const em = this.deps.emFactory();
    const feed = await em.findOne(ProductFeed, { id: feedId });
    const publishedId = feed?.publishedArtefactId ?? null;

    const artefacts = await em.find(FeedArtefact, { feedRunId: runId });
    let purged = 0;
    for (const artefact of artefacts) {
      if (publishedId !== null && artefact.id === publishedId) continue;
      if (artefact.storageLocator) {
        try {
          await this.deps.artefactStore.delete({
            backend: artefact.storageBackend as ArtefactStorageBackend,
            locator: artefact.storageLocator,
          });
        } catch {
          // Already gone, or a backend that cannot say. The row still goes.
        }
      }
      em.remove(artefact);
      purged += 1;
    }
    if (purged > 0) await em.flush();
    return purged;
  }

  /**
   * The terminal transition and the claim release, in one transaction. The
   * `current_run_id = :runId` predicate means a claim that was released between
   * the scan and this statement is left alone rather than clobbered.
   */
  private async release(row: StaleRunRow): Promise<void> {
    const em = this.deps.emFactory();
    await em.transactional(async (tx) => {
      const conn = tx.getConnection();
      await conn.execute(
        `update "product_feed_runs"
            set "status" = 'failed',
                "failure_code" = 'worker_lost',
                "failure_detail" = 'The worker running this generation stopped responding.',
                "finished_at" = now(),
                "duration_ms" = coalesce("duration_ms",
                  greatest(0, extract(epoch from (now() - coalesce("started_at", "created_at"))) * 1000)::int)
          where "id" = ? and "status" = 'running'`,
        [row.id],
        'run',
        tx.getTransactionContext(),
      );
      await conn.execute(
        `update "product_feeds"
            set "current_run_id" = null, "last_run_id" = ?, "updated_at" = now()
          where "id" = ? and "current_run_id" = ?`,
        [row.id, row.product_feed_id, row.id],
        'run',
        tx.getTransactionContext(),
      );
    });
  }
}
