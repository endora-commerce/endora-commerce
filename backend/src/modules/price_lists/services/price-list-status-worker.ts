import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Status worker (feature 011 / FR-009, SC-006, research §R4 + §R13).
 *
 * Sweeps every 5 min on the existing BullMQ-class queue and:
 *   - Promotes `Scheduled → Active` when `starts_at <= now()`.
 *   - Expires `Active → Expired` when `ends_at < now()`.
 *
 * Idempotent under jitter: the WHERE guards inside each UPDATE mean a row
 * already past the boundary is processed exactly once. `SELECT … FOR UPDATE
 * SKIP LOCKED` lets two parallel sweepers (e.g. during a deploy) coalesce
 * without double-flipping. `modified_at` is bumped only on actual transitions.
 */
export interface SweepResult {
  scheduledToActive: number;
  activeToExpired: number;
}

export class PriceListStatusWorker {
  constructor(private readonly emFactory: () => EntityManager) {}

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const em = this.emFactory();
    const ts = now.toISOString();

    const scheduledToActive = await em.getConnection().execute<{ id: string }[]>(
      `
        with locked as (
          select id from price_lists
          where status = 'scheduled' and starts_at is not null and starts_at <= ?
          for update skip locked
        )
        update price_lists pl
           set status = 'active', modified_at = now()
          from locked
         where pl.id = locked.id
        returning pl.id
      `,
      [ts],
    );

    const activeToExpired = await em.getConnection().execute<{ id: string }[]>(
      `
        with locked as (
          select id from price_lists
          where status = 'active' and ends_at is not null and ends_at < ?
          for update skip locked
        )
        update price_lists pl
           set status = 'expired', modified_at = now()
          from locked
         where pl.id = locked.id
        returning pl.id
      `,
      [ts],
    );

    return {
      scheduledToActive: scheduledToActive.length,
      activeToExpired: activeToExpired.length,
    };
  }
}
