// The cleanup ledger — specs/156-asset-stable-url/ research R-21.
//
// Every storage object the module is about to create, or stop referencing
// outside a row's own columns, is recorded here first and cleared once it is
// referenced by a row or deleted. A crash or a failed delete therefore leaves
// either a referenced object or an entry the retention sweep retries.

import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from './storage/storage-adapter.js';
import { isObjectNotFound } from './storage/errors.js';
import type { EntityManager } from '@mikro-orm/postgresql';

import { Asset } from '../entities/asset.entity.js';
import { cleanupEntriesDue } from '../jobs/retention-due-rows.js';
import {
  AssetObjectCleanup,
  type AssetObjectCleanupReason,
} from '../entities/asset-object-cleanup.entity.js';

export interface CleanupEntry {
  storageBackend: 'local' | 's3' | 'gcs';
  locator: string;
  reason: AssetObjectCleanupReason;
  assetId?: string | null;
}

export type CleanupKey = Pick<CleanupEntry, 'storageBackend' | 'locator'>;

export interface CleanupLedgerPort {
  /** Records entries — in the given transaction, or in a short one of its own. */
  record(entries: readonly CleanupEntry[], em?: EntityManager): Promise<void>;
  /** Clears entries — in the given transaction, or on an entity manager of its own. */
  clear(entries: readonly CleanupKey[], em?: EntityManager): Promise<void>;
}

export class ObjectCleanupLedger implements CleanupLedgerPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async record(entries: readonly CleanupEntry[], em?: EntityManager): Promise<void> {
    // Storage bookkeeping with no operator intent and nothing to undo — the
    // decision is the audited `asset.replace` Command.
    if (entries.length === 0) return;
    const write = async (tx: EntityManager): Promise<void> => {
      for (const entry of entries) {
        await tx.upsert(
          AssetObjectCleanup,
          {
            id: randomUUID(),
            storageBackend: entry.storageBackend,
            locator: entry.locator,
            reason: entry.reason,
            assetId: entry.assetId ?? null,
            recordedAt: new Date(),
          },
          {
            onConflictFields: ['storageBackend', 'locator'],
            onConflictAction: 'merge',
            onConflictMergeFields: ['reason', 'assetId', 'recordedAt'],
          },
        );
      }
    };
    if (em) {
      await write(em);
      return;
    }
    await this.emFactory().fork().transactional(write);
  }

  async clear(entries: readonly CleanupKey[], em?: EntityManager): Promise<void> {
    // command-coverage-ignore: storage bookkeeping with no operator intent and
    // nothing to undo — the entry only says an object still needs deleting.
    const target = em ?? this.emFactory().fork();
    for (const entry of entries) {
      await target.nativeDelete(AssetObjectCleanup, {
        storageBackend: entry.storageBackend,
        locator: entry.locator,
      });
    }
  }

  /**
   * The cleanup pass of the retention sweep (contracts/storage-and-retention.md
   * §4 pass 4): entries at least `graceMs` old, oldest first, at most `limit`.
   * An entry whose locator a row still names is skipped and its object kept;
   * otherwise the object is deleted — one already gone counts as deleted — and
   * the entry removed. A failure counts an attempt and keeps the entry.
   */
  async sweepDue(
    now: Date,
    graceMs: number,
    limit: number,
    adapterFor: (backend: CleanupKey['storageBackend']) => Promise<Pick<StorageAdapter, 'delete'>>,
  ): Promise<{ cleanupsDone: number }> {
    // command-coverage-ignore: storage bookkeeping with no operator intent and
    // nothing to undo — each entry only says an object still needs deleting.
    const em = this.emFactory().fork();
    // The ids through the pass's row source — the one the tick's probe asks
    // about (issue #909) — then the entries through the ORM.
    const source = cleanupEntriesDue(new Date(now.getTime() - graceMs));
    const ids = await em.execute<Array<{ id: string }>>(
      `select "id" ${source.from} order by "recorded_at" asc limit ?`,
      [...source.params, limit],
    );
    const entries =
      ids.length === 0
        ? []
        : await em.find(AssetObjectCleanup, { id: { $in: ids.map((row) => row.id) } }, { orderBy: { recordedAt: 'asc' } });
    let cleanupsDone = 0;
    for (const entry of entries) {
      const referenced = await em.count(Asset, {
        storageBackend: entry.storageBackend,
        $or: [{ storageLocator: entry.locator }, { previousStorageLocator: entry.locator }],
      });
      if (referenced > 0) continue;
      try {
        const adapter = await adapterFor(entry.storageBackend);
        await adapter.delete({ locator: entry.locator });
      } catch (err) {
        if (!isObjectNotFound(err)) {
          entry.attempts += 1;
          entry.lastError = err instanceof Error ? err.message : String(err);
          await em.flush();
          continue;
        }
      }
      await em.nativeDelete(AssetObjectCleanup, { id: entry.id });
      cleanupsDone += 1;
    }
    return { cleanupsDone };
  }
}
