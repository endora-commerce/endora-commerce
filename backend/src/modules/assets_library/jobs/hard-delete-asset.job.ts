// Hard-delete worker — feature 013 / FR-031 / Phase 9 / T100.
//
// Periodic sweep that finalises soft-deleted assets:
//   1. Find every Asset where deletedAt is set, purgeAfterAt has elapsed,
//      and pendingCleanup is false.
//   2. For each, call adapter.delete(locator). Success → DELETE the row.
//      Failure → set pendingCleanup = true; the row stays soft-deleted and
//      the worker retries on the next tick.
//
// `sweep()` is a plain async method so tests can drive it directly without
// Redis/BullMQ. Production wiring registers it on the existing repeatable
// queue (omitted here — repeatable scheduling lives in composition.ts).

import type { EntityManager } from '@mikro-orm/postgresql';
import { Asset } from '../entities/asset.entity.js';
import type { AdapterRegistry } from '../services/storage/adapter-registry.js';
import type { StorageBackendCode } from '../services/storage/storage-adapter.js';

export interface HardDeleteSweepResult {
  hardDeleted: number;
  pendingCleanup: number;
}

export class HardDeleteAssetWorker {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly adapters: AdapterRegistry,
  ) {}

  async sweep(now: Date = new Date()): Promise<HardDeleteSweepResult> {
    const em = this.emFactory();
    const due = await em.find(Asset, {
      deletedAt: { $ne: null },
      purgeAfterAt: { $lte: now },
      pendingCleanup: false,
    });
    let hardDeleted = 0;
    let newlyPending = 0;
    for (const a of due) {
      const adapter = await this.adapters.getForBackend(
        a.storageBackend as StorageBackendCode,
      );
      // Legacy resolver has no delete — skip and just hard-delete the row.
      if (!('delete' in adapter) || typeof adapter.delete !== 'function') {
        em.remove(a);
        hardDeleted += 1;
        continue;
      }
      try {
        await adapter.delete({ locator: a.storageLocator || a.storageUrl });
        em.remove(a);
        hardDeleted += 1;
      } catch {
        a.pendingCleanup = true;
        newlyPending += 1;
      }
    }
    if (due.length > 0) await em.flush();
    return { hardDeleted, pendingCleanup: newlyPending };
  }

  /**
   * Retry pass for rows the worker previously parked in pendingCleanup.
   * Same logic as `sweep` but selects rows with pending_cleanup = true.
   */
  async sweepPending(): Promise<HardDeleteSweepResult> {
    const em = this.emFactory();
    const due = await em.find(Asset, {
      deletedAt: { $ne: null },
      pendingCleanup: true,
    });
    let hardDeleted = 0;
    let stillPending = 0;
    for (const a of due) {
      const adapter = await this.adapters.getForBackend(
        a.storageBackend as StorageBackendCode,
      );
      if (!('delete' in adapter) || typeof adapter.delete !== 'function') {
        em.remove(a);
        hardDeleted += 1;
        continue;
      }
      try {
        await adapter.delete({ locator: a.storageLocator || a.storageUrl });
        em.remove(a);
        hardDeleted += 1;
      } catch {
        stillPending += 1;
      }
    }
    if (due.length > 0) await em.flush();
    return { hardDeleted, pendingCleanup: stillPending };
  }
}
