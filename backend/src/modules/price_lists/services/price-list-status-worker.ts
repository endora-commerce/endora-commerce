import type { EntityManager } from '@mikro-orm/postgresql';
import { PriceList } from '../entities/price-list.entity.js';

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

  async sweep(now: Date = new Date()): Promise<SweepResult> {
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
