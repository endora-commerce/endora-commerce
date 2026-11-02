// Replace an asset's file in place — specs/156-asset-stable-url/
// contracts/storage-and-retention.md §2, research R-1, R-4, R-5, R-6, R-18, R-21.
//
// The asset keeps its id and its storage key. The new file is staged beside the
// key outside any lock; then one Command locks the row, copies the current
// bytes to a random previous key and the staged bytes onto the stable key, and
// updates the row. Every object created or released on the way goes through the
// cleanup ledger first, so a failure at any point leaves either a referenced
// object or an entry the retention sweep retries.

import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assetNotFound } from './asset-visibility.js';
import type { Command } from '@endora-commerce/platform/commands';

import { Asset, hasPreviousVersion, type AssetKind } from '../entities/asset.entity.js';
import { cloudContentDisposition } from './asset-urls.js';
import { newContentVersion } from './content-version.js';
import type { CleanupKey, CleanupLedgerPort } from './object-cleanup-ledger.js';
import { mimeToKind, storageUnavailable, type StageInput, type StageResult } from './upload-pipeline.js';
import { siblingLocator } from './storage/locator.js';
import { BackendUnavailableError, ConfigurationError, isObjectNotFound } from './storage/errors.js';
import type { StorageAdapter, StorageCopyInput } from './storage/storage-adapter.js';
import { SVG_MIME } from './content-policy.js';

/** S3 accepts at most 5 GiB in one `PutObject` or `CopyObject` (research R-1). */
export const S3_SINGLE_REQUEST_MAX_BYTES = 5 * 1024 * 1024 * 1024;

type ObjectBackend = 'local' | 's3' | 'gcs';

export interface AssetReplaceDeps {
  emFactory: () => EntityManager;
  adapters: {
    getForBackend(backend: ObjectBackend): Promise<Pick<StorageAdapter, 'copy' | 'delete'>>;
  };
  /** `UploadPipeline.stage` — the policy, the sniff and the counting write. */
  stage: (input: StageInput) => Promise<StageResult>;
  ledger: CleanupLedgerPort;
  commandBus: { run<T>(command: Command<T>): Promise<T> };
  /** Random part of the sibling keys; the default draws 128 random bits. */
  random?: () => string;
  /** Where a failed compensation is reported; the cleanup entries stay for the sweep. */
  logError?: (message: string, context: Record<string, unknown>) => void;
  /**
   * `assets.soft_delete_retention_days` as read now. A previous version is
   * restorable until `replacedAt` + this (FR-022); without it, no expiry check.
   */
  loadRetentionDays?: () => Promise<number>;
}

export interface AssetReplaceInput {
  assetId: string;
  filename: string;
  declaredMime: string;
  stream: NodeJS.ReadableStream;
  declaredSize: number;
  /** The content version the admin saw; the row's current one when absent. */
  expectedContentVersion?: string;
  /**
   * Runs once the new bytes are staged and before anything is committed; a
   * throw refuses the replace and cleans up like any other refusal. The route
   * reads the rest of the request here, so a guard field sent after the file is
   * refused rather than skipped.
   */
  afterStaged?: () => Promise<void>;
}

/**
 * Whether the file can be swapped in place: it has a storage key this platform
 * wrote. A legacy row (a URL the platform did not issue) has none it can write
 * to, and neither has a row inserted without one — the demo seed's `data:`
 * images (owner ruling S3, specs/156-asset-stable-url/). Both are refused the
 * same way, and the detail answers this as `replaceable`.
 */
export function isReplaceableInPlace<T extends Pick<Asset, 'storageBackend' | 'storageLocator'>>(
  a: T,
): a is T & { storageBackend: ObjectBackend } {
  return a.storageBackend !== 'legacy' && (a.storageLocator ?? '') !== '';
}

function cannotReplaceInPlace(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ASSET_LEGACY_CANNOT_REPLACE,
    'This file is stored at an address the platform did not issue, so it cannot be replaced in place.',
  );
}

/** `certificate` is a PDF for the comparison and is kept on the row. */
function comparableKind(kind: AssetKind): AssetKind {
  return kind === 'certificate' ? 'pdf' : kind;
}

/**
 * The kind a replacement may have (research R-5): the stored kind of the
 * current file against what the new bytes were recognised as — an SVG counting
 * as an image, anything unrecognised as `other`. A declared type alone never
 * makes a file an image or a PDF, and an admin's MIME override plays no part.
 * Answers the kind to store; refuses a mismatch with 415.
 */
export function replacementKind(
  storedKind: AssetKind,
  detectedMime: string | undefined,
  storedMime: string,
): AssetKind {
  const currentKind = comparableKind(storedKind);
  const newKind: AssetKind =
    detectedMime !== undefined ? mimeToKind(detectedMime) : storedMime === SVG_MIME ? 'image' : 'other';
  if (currentKind !== newKind) {
    throw new HttpError(
      415,
      ERROR_CODES.ASSET_REPLACE_KIND_MISMATCH,
      `This asset holds a ${currentKind} file and can only be replaced with another ${currentKind} file; the file you chose is ${newKind}.`,
      { currentKind, newKind },
    );
  }
  return storedKind === 'certificate' ? 'certificate' : newKind;
}

function isStorageFailure(err: unknown): boolean {
  return err instanceof BackendUnavailableError || err instanceof ConfigurationError;
}

/** A storage write; any failure of the adapter is the storage being unavailable. */
async function storageCopy(
  adapter: Pick<StorageAdapter, 'copy'>,
  input: StorageCopyInput,
): Promise<void> {
  try {
    await adapter.copy(input);
  } catch (err) {
    throw err instanceof HttpError ? err : storageUnavailable(err);
  }
}

/** Deletes an object and clears its entry; a failed delete keeps the entry for the sweep. */
async function deleteAndClear(
  adapter: Pick<StorageAdapter, 'delete'>,
  ledger: CleanupLedgerPort,
  key: CleanupKey,
): Promise<boolean> {
  try {
    await adapter.delete({ locator: key.locator });
  } catch (err) {
    if (!isObjectNotFound(err)) return false;
  }
  try {
    await ledger.clear([key]);
  } catch {
    return false;
  }
  return true;
}

/** What a swap tracks across its transaction, for the compensation and the cleanup after it. */
interface SwapState {
  /** The copy onto the stable key succeeded: a rollback must put the old bytes back. */
  stableWritten: boolean;
  committed: boolean;
  /** The compensation copy, captured from the locked row before it changes. */
  restoreTo: StorageCopyInput | null;
  /** The previous key the swap stopped referencing, deleted after commit. */
  superseded: string | null;
}

function newSwapState(): SwapState {
  return { stableWritten: false, committed: false, restoreTo: null, superseded: null };
}

/**
 * Runs one replace. Answers the locked row as committed; throws the refusal or
 * the failure otherwise, with the stable object holding the bytes the row
 * describes in every case.
 */
export async function replaceAssetFile(
  deps: AssetReplaceDeps,
  input: AssetReplaceInput,
): Promise<Asset> {
  const current = await deps.emFactory().findOne(Asset, { id: input.assetId });
  if (!current) {
    throw assetNotFound(input.assetId);
  }
  if (current.deletedAt) {
    throw new HttpError(410, ERROR_CODES.ASSET_GONE, 'Restore the asset before replacing its file.');
  }
  if (!isReplaceableInPlace(current)) throw cannotReplaceInPlace();
  const backend: ObjectBackend = current.storageBackend;
  const expectedVersion = input.expectedContentVersion ?? current.contentVersion;

  // The asset's own backend, never the active one (research R-1).
  let adapter: Pick<StorageAdapter, 'copy' | 'delete'>;
  try {
    adapter = await deps.adapters.getForBackend(backend);
  } catch (err) {
    throw storageUnavailable(err);
  }

  const random = deps.random;
  const stageKey: CleanupKey = {
    storageBackend: backend,
    locator: siblingLocator(current.storageLocator, 'stage', input.filename, random),
  };
  const prevKey: CleanupKey = {
    storageBackend: backend,
    locator: siblingLocator(current.storageLocator, 'prev', current.filename, random),
  };
  await deps.ledger.record([
    { ...stageKey, reason: 'staging', assetId: current.id },
    { ...prevKey, reason: 'previous', assetId: current.id },
  ]);

  const state = newSwapState();
  let result: Asset;

  try {
    const staged = await deps.stage({
      adapter: adapter as StorageAdapter,
      locator: stageKey.locator,
      filename: input.filename,
      declaredMime: input.declaredMime,
      stream: input.stream,
      declaredSize: input.declaredSize,
      visibility: 'private',
      ...(backend === 's3' ? { sizeCapBytes: S3_SINGLE_REQUEST_MAX_BYTES } : {}),
    });
    const kind = replacementKind(current.kind, staged.detectedMime, staged.storedMime);
    if (input.afterStaged) await input.afterStaged();

    result = await deps.commandBus.run<Asset>({
      action: 'asset.replace',
      objectType: 'asset',
      objectId: current.id,
      run: async ({ em, actor }) => {
        const row = await em.findOne(
          Asset,
          { id: current.id },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (!row) {
          throw assetNotFound(current.id);
        }
        if (row.deletedAt) {
          throw new HttpError(410, ERROR_CODES.ASSET_GONE, 'Restore the asset before replacing its file.');
        }
        if (row.contentVersion !== expectedVersion) {
          throw new HttpError(
            409,
            ERROR_CODES.ASSET_REPLACE_CONFLICT,
            "Someone else changed this asset's file while you were uploading.",
          );
        }

        const oldDisposition = cloudContentDisposition(row.mimeType, row.filename);
        state.restoreTo = {
          from: prevKey.locator,
          to: row.storageLocator,
          visibility: row.visibility,
          mimeType: row.mimeType,
          cacheControl: 'no-cache',
          contentDisposition: oldDisposition,
        };
        await storageCopy(adapter, {
          from: row.storageLocator,
          to: prevKey.locator,
          visibility: 'private',
          mimeType: row.mimeType,
          cacheControl: 'no-cache',
          contentDisposition: oldDisposition,
        });
        // Atomic at the destination: until this copy succeeds the stable key
        // still holds the old bytes, and nothing needs putting back.
        await storageCopy(adapter, {
          from: stageKey.locator,
          to: row.storageLocator,
          visibility: row.visibility,
          mimeType: staged.storedMime,
          cacheControl: 'no-cache',
          contentDisposition: cloudContentDisposition(staged.storedMime, input.filename),
        });
        state.stableWritten = true;

        const before = {
          filename: row.filename,
          mimeType: row.mimeType,
          sizeBytes: Number(row.sizeBytes),
          contentVersion: row.contentVersion,
        };
        state.superseded = row.previousStorageLocator ?? null;

        row.previousStorageLocator = prevKey.locator;
        row.previousFilename = row.filename;
        row.previousMimeType = row.mimeType;
        row.previousMimeTypeOverridden = row.mimeTypeOverridden;
        row.previousKind = row.kind;
        row.previousSizeBytes = row.sizeBytes;
        row.previousContentVersion = row.contentVersion;
        row.previousReplacedAt = new Date();
        row.previousReplacedBy = actor.actorAdminUserId;

        row.filename = input.filename;
        row.mimeType = staged.storedMime;
        row.mimeTypeOverridden = false;
        row.kind = kind;
        row.sizeBytes = String(staged.sizeBytes);
        row.contentVersion = newContentVersion();

        // The row references the new previous key now; the old one is released.
        await deps.ledger.clear([prevKey], em);
        if (state.superseded !== null) {
          await deps.ledger.record(
            [{ storageBackend: backend, locator: state.superseded, reason: 'superseded', assetId: row.id }],
            em,
          );
        }

        return {
          result: row,
          before,
          after: {
            filename: row.filename,
            mimeType: row.mimeType,
            sizeBytes: staged.sizeBytes,
            contentVersion: row.contentVersion,
          },
        };
      },
    });
    state.committed = true;
  } catch (err) {
    if (state.stableWritten && state.restoreTo !== null) {
      // The transaction did not commit; put the old bytes back on the stable
      // key, with the locked row's visibility as an explicit ACL.
      try {
        await adapter.copy(state.restoreTo);
        await deleteAndClear(adapter, deps.ledger, prevKey);
      } catch (compensationErr) {
        deps.logError?.('assets_library: replace compensation failed', {
          assetId: current.id,
          stable: current.storageLocator,
          previous: prevKey.locator,
          error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr),
        });
      }
    } else if (!state.committed) {
      await deleteAndClear(adapter, deps.ledger, prevKey);
    }
    throw isStorageFailure(err) ? storageUnavailable(err) : err;
  } finally {
    await deleteAndClear(adapter, deps.ledger, stageKey);
  }

  const superseded = state.superseded;
  if (superseded !== null) {
    await deleteAndClear(adapter, deps.ledger, { storageBackend: backend, locator: superseded });
  }
  return result;
}

export interface RestorePreviousVersionInput {
  assetId: string;
  /** The current file's content version the admin saw. */
  expectedContentVersion: string;
  /** The previous file's content version the admin saw — the file a restore brings back. */
  expectedPreviousContentVersion: string;
}

function noPreviousVersion(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ASSET_NO_PREVIOUS_VERSION,
    'This asset has no previous version to restore.',
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A previous version past its `restorableUntil` is refused like a missing one,
 * even before the retention sweep has purged it (FR-022). `details` names the
 * date it stopped being restorable.
 */
function refuseIfExpired(row: Asset, retentionDays: number | undefined, now: Date): void {
  if (retentionDays === undefined || !row.previousReplacedAt) return;
  const restorableUntil = new Date(row.previousReplacedAt.getTime() + retentionDays * DAY_MS);
  if (restorableUntil.getTime() <= now.getTime()) {
    throw new HttpError(
      409,
      ERROR_CODES.ASSET_NO_PREVIOUS_VERSION,
      'The previous version is past its retention and can no longer be restored.',
      // Issue #86 — the token picks the retention sentence; the base one says
      // there is no previous version, which is not what happened.
      { code: 'retention_expired', restorableUntil: restorableUntil.toISOString() },
    );
  }
}

/**
 * Restore the kept previous version — a swap through the replace's shape
 * (research R-3): the current file becomes the previous version under a new
 * random key, and the previous file is copied back onto the stable key. Both
 * versions the admin saw are checked under the lock, so the restore brings back
 * exactly the file the drawer showed. No kind check: the previous file passed
 * it when it was current.
 */
export async function restorePreviousVersion(
  deps: AssetReplaceDeps,
  input: RestorePreviousVersionInput,
): Promise<Asset> {
  const current = await deps.emFactory().findOne(Asset, { id: input.assetId });
  if (!current) {
    throw assetNotFound(input.assetId);
  }
  if (current.deletedAt) {
    throw new HttpError(410, ERROR_CODES.ASSET_GONE, 'Restore the asset before restoring its file.');
  }
  if (!isReplaceableInPlace(current)) throw cannotReplaceInPlace();
  if (!hasPreviousVersion(current)) throw noPreviousVersion();
  const retentionDays = deps.loadRetentionDays ? await deps.loadRetentionDays() : undefined;
  refuseIfExpired(current, retentionDays, new Date());
  const backend: ObjectBackend = current.storageBackend;

  let adapter: Pick<StorageAdapter, 'copy' | 'delete'>;
  try {
    adapter = await deps.adapters.getForBackend(backend);
  } catch (err) {
    throw storageUnavailable(err);
  }

  const prevKey: CleanupKey = {
    storageBackend: backend,
    locator: siblingLocator(current.storageLocator, 'prev', current.filename, deps.random),
  };
  await deps.ledger.record([{ ...prevKey, reason: 'previous', assetId: current.id }]);

  const state = newSwapState();
  let result: Asset;

  try {
    result = await deps.commandBus.run<Asset>({
      action: 'asset.restore_previous_version',
      objectType: 'asset',
      objectId: current.id,
      run: async ({ em, actor }) => {
        const row = await em.findOne(
          Asset,
          { id: current.id },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (!row) {
          throw assetNotFound(current.id);
        }
        if (row.deletedAt) {
          throw new HttpError(410, ERROR_CODES.ASSET_GONE, 'Restore the asset before restoring its file.');
        }
        if (!hasPreviousVersion(row)) throw noPreviousVersion();
        refuseIfExpired(row, retentionDays, new Date());
        if (
          row.contentVersion !== input.expectedContentVersion ||
          row.previousContentVersion !== input.expectedPreviousContentVersion
        ) {
          throw new HttpError(
            409,
            ERROR_CODES.ASSET_REPLACE_CONFLICT,
            "Someone else changed this asset's file since you opened it.",
          );
        }
        const previous = {
          locator: row.previousStorageLocator as string,
          filename: row.previousFilename as string,
          mimeType: row.previousMimeType as string,
          mimeTypeOverridden: row.previousMimeTypeOverridden ?? false,
          kind: row.previousKind as AssetKind,
          sizeBytes: row.previousSizeBytes as string,
          contentVersion: row.previousContentVersion as string,
        };

        const currentDisposition = cloudContentDisposition(row.mimeType, row.filename);
        state.restoreTo = {
          from: prevKey.locator,
          to: row.storageLocator,
          visibility: row.visibility,
          mimeType: row.mimeType,
          cacheControl: 'no-cache',
          contentDisposition: currentDisposition,
        };
        await storageCopy(adapter, {
          from: row.storageLocator,
          to: prevKey.locator,
          visibility: 'private',
          mimeType: row.mimeType,
          cacheControl: 'no-cache',
          contentDisposition: currentDisposition,
        });
        await storageCopy(adapter, {
          from: previous.locator,
          to: row.storageLocator,
          visibility: row.visibility,
          mimeType: previous.mimeType,
          cacheControl: 'no-cache',
          contentDisposition: cloudContentDisposition(previous.mimeType, previous.filename),
        });
        state.stableWritten = true;

        const before = {
          filename: row.filename,
          mimeType: row.mimeType,
          sizeBytes: Number(row.sizeBytes),
          contentVersion: row.contentVersion,
        };
        state.superseded = previous.locator;

        row.previousStorageLocator = prevKey.locator;
        row.previousFilename = row.filename;
        row.previousMimeType = row.mimeType;
        row.previousMimeTypeOverridden = row.mimeTypeOverridden;
        row.previousKind = row.kind;
        row.previousSizeBytes = row.sizeBytes;
        row.previousContentVersion = row.contentVersion;
        // A new retention period for the file this restore demotes.
        row.previousReplacedAt = new Date();
        row.previousReplacedBy = actor.actorAdminUserId;

        row.filename = previous.filename;
        row.mimeType = previous.mimeType;
        row.mimeTypeOverridden = previous.mimeTypeOverridden;
        row.kind = previous.kind;
        row.sizeBytes = previous.sizeBytes;
        // The restored file keeps its own content version (research R-7).
        row.contentVersion = previous.contentVersion;

        await deps.ledger.clear([prevKey], em);
        await deps.ledger.record(
          [{ storageBackend: backend, locator: previous.locator, reason: 'superseded', assetId: row.id }],
          em,
        );

        return {
          result: row,
          before,
          after: {
            filename: row.filename,
            mimeType: row.mimeType,
            sizeBytes: Number(row.sizeBytes),
            contentVersion: row.contentVersion,
          },
        };
      },
    });
    state.committed = true;
  } catch (err) {
    if (state.stableWritten && state.restoreTo !== null) {
      try {
        await adapter.copy(state.restoreTo);
        await deleteAndClear(adapter, deps.ledger, prevKey);
      } catch (compensationErr) {
        deps.logError?.('assets_library: restore compensation failed', {
          assetId: current.id,
          stable: current.storageLocator,
          previous: prevKey.locator,
          error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr),
        });
      }
    } else if (!state.committed) {
      await deleteAndClear(adapter, deps.ledger, prevKey);
    }
    throw isStorageFailure(err) ? storageUnavailable(err) : err;
  }

  const superseded = state.superseded;
  if (superseded !== null) {
    await deleteAndClear(adapter, deps.ledger, { storageBackend: backend, locator: superseded });
  }
  return result;
}
