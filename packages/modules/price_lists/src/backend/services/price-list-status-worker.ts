import type { EntityManager } from '@mikro-orm/postgresql';
import { PriceList } from '../entities/price-list.entity.js';
import { anyRowExists } from './scheduled-work-probe.js';

/**
 * Status worker (feature 011 / FR-009, SC-006, research §R4 + §R13).
 *
 * Sweeps every 5 min on the existing BullMQ-class queue and:
 *   - Promotes `scheduled → active` when `starts_at <= now()`.
 *   - Expires `active → expired` when `ends_at < now()`.
 *
 * Idempotent under jitter: each transition bumps `modifiedAt` exactly once
 * because the candidate set is filtered to "still in old state" before each
 * pass. Public `sweep()` is a plain async method so tests can drive it
 * directly without Redis/BullMQ.
 *
 * Implementation note: uses MikroORM's EM API (find + mutate + flush) so
 * the worker participates in the caller's transaction during integration
 * tests; production path runs outside any test transaction so the same
 * code commits normally on the next worker tick.
 */
export interface SweepResult {
  scheduledToActive: number;
  activeToExpired: number;
}

export class PriceListStatusWorker {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Whether a {@link sweep} at `now` would flip anything — **yes or no, and
   * nothing else** (issue #120).
   *
   * The timer asks this before it opens its system scope, so that a tick with
   * no transition due writes no `tenant.escape_hatch` audit row. It runs with
   * no tenant context and returns one bit, through `anyRowExists`: no price
   * list leaves the statement. The predicate is the sweep's own two — a
   * `scheduled` list whose start has come, an `active` one whose end has
   * passed — and its answer is never handed to the sweep, which re-reads
   * inside the scope.
   *
   * **Two statements of the predicate, unlike the other scheduled probes.**
   * The sweep selects through the ORM (`em.find` with a filter object, so that
   * it joins the caller's unit of work and flushes entities), and a probe may
   * not load entities at all; sharing one would mean rewriting the sweep as
   * raw SQL. What holds the two together instead is a test per branch in
   * which only that branch makes the tick do its work
   * (`backend/test/integration/tenancy/idle-worker-ticks-audit.test.ts`).
   */
  async hasDueTransitions(now: Date = new Date()): Promise<boolean> {
    return anyRowExists(this.emFactory(), [
      {
        from: `from "price_lists" where "status" = 'scheduled' and "starts_at" is not null and "starts_at" <= ?`,
        params: [now],
      },
      {
        from: `from "price_lists" where "status" = 'active' and "ends_at" is not null and "ends_at" < ?`,
        params: [now],
      },
    ]);
  }

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    // command-coverage-ignore: automatic date-driven status transitions
    // (scheduled→active / active→expired) by the background sweeper — a system
    // operation on a schedule, not an admin action; the manual admin transitions
    // (activate/draftify) are audited via their Commands.
    const em = this.emFactory();

    const toActivate = await em.find(PriceList, {
      status: 'scheduled',
      startsAt: { $lte: now, $ne: null },
    });
    const toExpire = await em.find(PriceList, {
      status: 'active',
      endsAt: { $lt: now, $ne: null },
    });

    for (const row of toActivate) {
      row.status = 'active';
      row.modifiedAt = now;
    }
    for (const row of toExpire) {
      row.status = 'expired';
      row.modifiedAt = now;
    }

    if (toActivate.length > 0 || toExpire.length > 0) {
      await em.flush();
    }

    return {
      scheduledToActive: toActivate.length,
      activeToExpired: toExpire.length,
    };
  }
}
