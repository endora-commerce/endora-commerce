// The retention sweep — specs/156-asset-stable-url/ contracts/storage-and-retention.md §4.
//
// One tick reads `assets.soft_delete_retention_days` once, then runs four
// passes, each bounded by its own batch: previous versions, soft-deleted
// assets, assets parked in `pending_cleanup`, and the cleanup ledger. It writes
// one log line per tick (FR-035).
//
// **No tick enters a system scope.** `Asset`, `AssetPermalinkRelease` and
// `AssetObjectCleanup` are `@GlobalEntity()`, which the tenancy guard does not
// filter, and every reference resolver the soft-delete pass asks reads with
// plain SQL.

import { ObjectCleanupLedger } from '../services/object-cleanup-ledger.js';
import type { StorageAdapter } from '../services/storage/storage-adapter.js';
import { HardDeleteAssetWorker } from './hard-delete-asset.job.js';
import { PurgePreviousVersionsJob } from './purge-previous-versions.job.js';
import { RetentionDueProbe } from './retention-due-probe.js';
import {
  ASSET_CLEANUP_GRACE_MS,
  ASSET_RETENTION_SWEEP_BATCH,
  deleterOf,
  type RetentionSweepDeps,
} from './retention-sweep-deps.js';

export const ASSET_RETENTION_SWEEP_LOG_EVENT = 'assets_library.retention.sweep';

export interface AssetRetentionSweepResult {
  retentionDays: number;
  previousPurged: number;
  hardDeleted: number;
  pendingCleanup: number;
  cleanupsDone: number;
  skippedReferenced: number;
  skippedNotDue: number;
  /** Due soft-deleted assets left for later ticks (FR-035). */
  dueRemaining: number;
}

export interface AssetRetentionSweeper {
  /** One cheap boolean: is anything due? Errors count as "yes" (the tick decides that). */
  hasDue(now?: Date): Promise<boolean>;
  /** The retention a tick would use — what an idle tick reports. */
  retentionDays(): Promise<number>;
  sweep(now?: Date): Promise<AssetRetentionSweepResult>;
}

export function idleSweepResult(retentionDays: number): AssetRetentionSweepResult {
  return {
    retentionDays,
    previousPurged: 0,
    hardDeleted: 0,
    pendingCleanup: 0,
    cleanupsDone: 0,
    skippedReferenced: 0,
    skippedNotDue: 0,
    dueRemaining: 0,
  };
}

export function createAssetRetentionSweeper(deps: RetentionSweepDeps): AssetRetentionSweeper {
  const previous = new PurgePreviousVersionsJob(deps);
  const softDeleted = new HardDeleteAssetWorker(deps);
  const ledger = new ObjectCleanupLedger(deps.emFactory);
  const probe = new RetentionDueProbe(deps);
  const batch = deps.batchSize ?? ASSET_RETENTION_SWEEP_BATCH;

  const adapterFor = async (
    backend: 'local' | 's3' | 'gcs',
  ): Promise<Pick<StorageAdapter, 'delete'>> => {
    const remove = deleterOf(await deps.adapters.getForBackend(backend));
    if (!remove) throw new Error(`assets_library: backend "${backend}" cannot delete objects`);
    return { delete: remove };
  };

  return {
    retentionDays: () => deps.loadRetentionDays(),

    hasDue: (now = new Date()) => probe.hasDue(now),

    async sweep(now = new Date()) {
      const retentionDays = await deps.loadRetentionDays();
      const previousPass = await previous.run(now, retentionDays);
      const deletedPass = await softDeleted.sweep(now, retentionDays);
      const pendingPass = await softDeleted.sweepPending(now);
      const dueRemaining = await softDeleted.countDue(now, retentionDays);
      const cleanupPass = await ledger.sweepDue(now, ASSET_CLEANUP_GRACE_MS, batch, adapterFor);
      const result: AssetRetentionSweepResult = {
        retentionDays,
        previousPurged: previousPass.previousPurged,
        hardDeleted: deletedPass.hardDeleted + pendingPass.hardDeleted,
        pendingCleanup: deletedPass.pendingCleanup + pendingPass.pendingCleanup,
        cleanupsDone: cleanupPass.cleanupsDone,
        skippedReferenced: deletedPass.skippedReferenced + pendingPass.skippedReferenced,
        skippedNotDue:
          previousPass.skippedNotDue + deletedPass.skippedNotDue + pendingPass.skippedNotDue,
        dueRemaining,
      };
      deps.log?.info({ event: ASSET_RETENTION_SWEEP_LOG_EVENT, ...result }, 'assets_library: retention sweep');
      return result;
    },
  };
}
