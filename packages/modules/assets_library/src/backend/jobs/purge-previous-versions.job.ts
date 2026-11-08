// The previous-version pass of the retention sweep — specs/156-asset-stable-url/
// contracts/storage-and-retention.md §4 pass 1, research R-13, R-21.
//
// A kept previous version is purged once `assets.soft_delete_retention_days`
// have passed since it was replaced, the setting read when the sweep runs
// (owner ruling P1). Each row is claimed in its own transaction, `for update
// skip locked`, and re-checked under the lock; the columns are cleared and a
// `purge` cleanup entry recorded in that transaction, and the object is
// deleted only after it commits — so a reader never sees a row naming an
// object that is gone, and a failed delete leaves an entry the cleanup pass
// retries.

import { LockMode } from '@mikro-orm/core';

import { Asset, clearPreviousVersion, hasPreviousVersion } from '../entities/asset.entity.js';
import { ObjectCleanupLedger, type CleanupKey } from '../services/object-cleanup-ledger.js';
import { isObjectNotFound } from '../services/storage/errors.js';
import {
  ASSET_RETENTION_SWEEP_BATCH,
  cutoffFor,
  deleterOf,
  type RetentionSweepDeps,
} from './retention-sweep-deps.js';
import { previousVersionsDue } from './retention-due-rows.js';

export interface PreviousVersionPassResult {
  previousPurged: number;
  skippedNotDue: number;
}

export class PurgePreviousVersionsJob {
  private readonly ledger: ObjectCleanupLedger;

  constructor(private readonly deps: RetentionSweepDeps) {
    this.ledger = new ObjectCleanupLedger(deps.emFactory);
  }

  async run(now: Date, retentionDays: number): Promise<PreviousVersionPassResult> {
    const cutoff = cutoffFor(now, retentionDays);
    // The ids through the pass's row source — the one the tick's probe asks
    // about (issue #909) — then the rows through the ORM.
    const em = this.deps.emFactory().fork();
    const source = previousVersionsDue(cutoff);
    const ids = await em.execute<Array<{ id: string }>>(
      `select "id" ${source.from} order by "previous_replaced_at" asc limit ?`,
      [...source.params, this.deps.batchSize ?? ASSET_RETENTION_SWEEP_BATCH],
    );
    const due =
      ids.length === 0
        ? []
        : await em.find(Asset, { id: { $in: ids.map((row) => row.id) } }, { orderBy: { previousReplacedAt: 'asc' } });
    let previousPurged = 0;
    let skippedNotDue = 0;
    for (const selected of due) {
      // The row source selects only rows this pass can purge (issue #914); one
      // that changed since is re-checked under the lock and counted not due.
      const selectedLocator = selected.previousStorageLocator ?? '';
      await this.deps.beforeClaim?.(selected.id);
      const claimed = await this.claim(selected.id, selectedLocator, cutoff);
      if (claimed === 'locked') continue;
      if (claimed === 'not-due') {
        skippedNotDue += 1;
        continue;
      }
      previousPurged += 1;
      await this.deleteObject(claimed);
    }
    return { previousPurged, skippedNotDue };
  }

  /** Lock, re-check, clear the columns and record the object for deletion — one transaction. */
  private async claim(
    assetId: string,
    selectedLocator: string,
    cutoff: Date,
  ): Promise<CleanupKey | 'locked' | 'not-due'> {
    // command-coverage-ignore: retention purge, not an operator write. The
    // auditable decision was the replace that demoted this file; this pass
    // only executes the retention window that write already committed, with no
    // actor behind it and nothing to undo.
    return this.deps.emFactory().fork().transactional(async (tx) => {
      const row = await tx.findOne(Asset, { id: assetId }, { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE });
      if (!row) return 'locked';
      if (
        !hasPreviousVersion(row) ||
        !row.previousStorageLocator ||
        row.previousStorageLocator !== selectedLocator ||
        !row.previousReplacedAt ||
        row.previousReplacedAt.getTime() > cutoff.getTime() ||
        row.storageBackend === 'legacy'
      ) {
        return 'not-due';
      }
      const key: CleanupKey = { storageBackend: row.storageBackend, locator: selectedLocator };
      await this.ledger.record([{ ...key, reason: 'purge', assetId: row.id }], tx);
      clearPreviousVersion(row);
      await tx.flush();
      return key;
    });
  }

  /** Deletes the released object and clears its entry; a failure leaves the entry for the cleanup pass. */
  private async deleteObject(key: CleanupKey): Promise<void> {
    try {
      const remove = deleterOf(await this.deps.adapters.getForBackend(key.storageBackend));
      if (remove) await remove({ locator: key.locator });
    } catch (err) {
      if (!isObjectNotFound(err)) return;
    }
    await this.ledger.clear([key]);
  }
}
