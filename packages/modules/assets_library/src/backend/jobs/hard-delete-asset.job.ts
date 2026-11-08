// Hard-delete worker — feature 013 / FR-031, reworked by feature 156
// (specs/156-asset-stable-url/ contracts/storage-and-retention.md §4 passes 2
// and 3, research R-13).
//
// Finalises soft-deleted assets:
//   1. `sweep(now)` selects assets soft-deleted at least
//      `assets.soft_delete_retention_days` ago — the setting read when the sweep
//      runs (owner ruling P1), oldest deletion first, at most one batch.
//   2. Each is claimed in its own transaction `for update skip locked` and
//      re-checked under the lock: still deleted, still due, and referenced by
//      nothing (`AssetReferenceRegistry`; a referenced asset is skipped and
//      stays soft-deleted).
//   3. Its previous version is released first, then the stable object is
//      deleted. Success removes the row and frees its permalink; failure sets
//      `pending_cleanup` and `sweepPending` retries it on later ticks.
//
// Both passes are plain async methods so tests drive them directly; the clock
// is `workers/retention-sweep-worker.ts`, started from `registerModule`.

import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { Asset, clearPreviousVersion, hasPreviousVersion } from '../entities/asset.entity.js';
import { AssetPermalinkRelease } from '../entities/asset-permalink-release.entity.js';
import { ObjectCleanupLedger, type CleanupKey } from '../services/object-cleanup-ledger.js';
import type { WorkRows } from '../services/scheduled-work-probe.js';
import { isObjectNotFound } from '../services/storage/errors.js';
import {
  ASSET_RETENTION_SWEEP_BATCH,
  cutoffFor,
  deleterOf,
  type RetentionSweepDeps,
} from './retention-sweep-deps.js';
import { pendingCleanupDue, softDeletedDue } from './retention-due-rows.js';

export interface HardDeleteSweepResult {
  hardDeleted: number;
  pendingCleanup: number;
  skippedReferenced: number;
  skippedNotDue: number;
}

type Claim =
  | { outcome: 'locked' | 'not-due' | 'referenced' }
  | { outcome: 'deleted' | 'pending'; previous: CleanupKey | null };

export class HardDeleteAssetWorker {
  private readonly ledger: ObjectCleanupLedger;

  constructor(private readonly deps: RetentionSweepDeps) {
    this.ledger = new ObjectCleanupLedger(deps.emFactory);
  }

  private get batchSize(): number {
    return this.deps.batchSize ?? ASSET_RETENTION_SWEEP_BATCH;
  }

  /** Soft-deleted assets whose retention has passed, oldest deletion first. */
  async sweep(now: Date = new Date(), retentionDays?: number): Promise<HardDeleteSweepResult> {
    const days = retentionDays ?? (await this.deps.loadRetentionDays());
    const cutoff = cutoffFor(now, days);
    const due = await this.dueIds(softDeletedDue(cutoff));
    return this.process(due, now, (row) =>
      row.deletedAt !== null &&
      row.deletedAt !== undefined &&
      row.deletedAt.getTime() <= cutoff.getTime() &&
      !row.pendingCleanup,
    );
  }

  /** How many due soft-deleted assets are left for later ticks (FR-035). */
  async countDue(now: Date, retentionDays: number): Promise<number> {
    const source = softDeletedDue(cutoffFor(now, retentionDays));
    const rows = await this.deps.emFactory().fork().execute<Array<{ count: number | string }>>(
      `select count(*) as "count" ${source.from}`,
      [...source.params],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Retry pass for rows a storage failure parked in `pending_cleanup`: the same
   * claim, re-checks and deletion as `sweep`.
   */
  async sweepPending(now: Date = new Date()): Promise<HardDeleteSweepResult> {
    const due = await this.dueIds(pendingCleanupDue());
    return this.process(due, now, (row) =>
      row.deletedAt !== null && row.deletedAt !== undefined && row.pendingCleanup,
    );
  }

  /**
   * One batch of ids from a pass's row source — the one the tick's probe asks
   * about (issue #909) — oldest deletion first.
   */
  private async dueIds(source: WorkRows): Promise<string[]> {
    const rows = await this.deps.emFactory().fork().execute<Array<{ id: string }>>(
      `select "id" ${source.from} order by "deleted_at" asc, "id" asc limit ?`,
      [...source.params, this.batchSize],
    );
    return rows.map((row) => row.id);
  }

  private async process(
    ids: readonly string[],
    now: Date,
    stillDue: (row: Asset) => boolean,
  ): Promise<HardDeleteSweepResult> {
    const result: HardDeleteSweepResult = {
      hardDeleted: 0,
      pendingCleanup: 0,
      skippedReferenced: 0,
      skippedNotDue: 0,
    };
    for (const id of ids) {
      await this.deps.beforeClaim?.(id);
      const claim = await this.claim(id, now, stillDue);
      switch (claim.outcome) {
        case 'locked':
          break;
        case 'not-due':
          result.skippedNotDue += 1;
          break;
        case 'referenced':
          result.skippedReferenced += 1;
          break;
        case 'deleted':
        case 'pending':
          if (claim.outcome === 'deleted') result.hardDeleted += 1;
          else result.pendingCleanup += 1;
          if (claim.previous) await this.deleteReleased(claim.previous);
          break;
      }
    }
    return result;
  }

  /**
   * One asset, in its own transaction: lock, re-check, release the previous
   * version, delete the stable object, then remove the row or park it.
   */
  private async claim(id: string, now: Date, stillDue: (row: Asset) => boolean): Promise<Claim> {
    // command-coverage-ignore: retention purge, not an operator write. The
    // auditable decision was the soft delete that set `deletedAt`; this pass
    // only executes the retention window that write already committed, with no
    // actor behind it and nothing to undo.
    return this.deps.emFactory().fork().transactional(async (tx): Promise<Claim> => {
      const row = await tx.findOne(Asset, { id }, { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE });
      if (!row) return { outcome: 'locked' };
      if (!stillDue(row)) return { outcome: 'not-due' };
      const references = await this.deps.referenceRegistry.findReferences(row.id);
      if (references.length > 0) return { outcome: 'referenced' };

      let previous: CleanupKey | null = null;
      if (hasPreviousVersion(row) && row.storageBackend !== 'legacy') {
        previous = { storageBackend: row.storageBackend, locator: row.previousStorageLocator as string };
        await this.ledger.record([{ ...previous, reason: 'purge', assetId: row.id }], tx);
        clearPreviousVersion(row);
      }

      try {
        // A backend this deployment cannot reach parks the row like a failed
        // delete — the batch goes on, and a later tick retries it (FR-032).
        const remove = deleterOf(await this.deps.adapters.getForBackend(row.storageBackend));
        // Legacy rows name a file this platform did not store: only the row goes.
        if (remove) await remove({ locator: row.storageLocator || row.storageUrl });
      } catch (err) {
        // An object already gone is deleted; anything else is retried later.
        if (!isObjectNotFound(err)) {
          row.pendingCleanup = true;
          await tx.flush();
          return { outcome: 'pending', previous };
        }
      }
      await this.releasePermalink(tx, row, now);
      tx.remove(row);
      await tx.flush();
      return { outcome: 'deleted', previous };
    });
  }

  /** A purged asset's permalink becomes a previously used name (research R-22). */
  private async releasePermalink(tx: EntityManager, row: Asset, now: Date): Promise<void> {
    if (!row.permalink) return;
    await tx.upsert(AssetPermalinkRelease, {
      permalinkLower: row.permalink.toLowerCase(),
      permalink: row.permalink,
      assetId: row.id,
      releasedAt: now,
      reason: 'purged',
    });
  }

  /** Deletes a released previous object after commit; a failure leaves its entry for the cleanup pass. */
  private async deleteReleased(key: CleanupKey): Promise<void> {
    try {
      const remove = deleterOf(await this.deps.adapters.getForBackend(key.storageBackend));
      if (remove) await remove({ locator: key.locator });
    } catch (err) {
      if (!isObjectNotFound(err)) return;
    }
    await this.ledger.clear([key]);
  }
}
