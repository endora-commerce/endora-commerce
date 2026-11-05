// AssetsLibraryService — public facade. US1 fills upload / get / list /
// patch / setVisibility / resolveUrl. US2 will fill softDelete / restore /
// move. US3 brings cloud adapters online.

import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  validateAssetPermalink,
  type AdminUserReadPort,
  type AssetDetail,
  type AssetPreviousVersion,
  type AssetSummary,
  isUuidShape,
} from '@endora-commerce/contracts';
import { Asset } from '../entities/asset.entity.js';
import {
  AssetPermalinkRelease,
  type AssetPermalinkReleaseReason,
} from '../entities/asset-permalink-release.entity.js';
import { HttpError } from '@endora-commerce/platform/http';
import { assetNotFound, type AssetVisibility } from './asset-visibility.js';
import { assetIdsAmong, idNotAmong } from './asset-id-sets.js';
import type { AdapterRegistry } from './storage/adapter-registry.js';
import type { AssetReferenceRegistry } from './reference-registry.js';
import { UploadPipeline, type UploadInput, type UploadPolicy } from './upload-pipeline.js';
import { LegacyAssetCannotHardenError } from './storage/errors.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import { permalinkUrl, versionedAssetUrl } from './asset-urls.js';
import {
  isReplaceableInPlace,
  replaceAssetFile,
  restorePreviousVersion,
  type AssetReplaceDeps,
  type AssetReplaceInput,
  type RestorePreviousVersionInput,
} from './asset-replace.js';
import { ObjectCleanupLedger } from './object-cleanup-ledger.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';

export class NotImplementedYet extends Error {
  override readonly name = 'NotImplementedYet';
  constructor(method: string) {
    super(
      `AssetsLibraryService.${method} is not implemented in this build (later phase / user story).`,
    );
  }
}

export interface AssetsLibraryServiceDeps {
  emFactory: () => EntityManager;
  adapters: AdapterRegistry;
  referenceRegistry: AssetReferenceRegistry;
  /**
   * Which assets the ambient caller may see (`specs/166-asset-reference-visibility/`
   * R-5, R-9, R-11): the list leaves hidden assets out, move-many skips them
   * and a permalink conflict does not name them. An unrestricted caller (the
   * system, the platform wildcard) is answered without a read. Every detail
   * names only the references the caller may see (FR-007, R-8).
   */
  visibility: Pick<AssetVisibility, 'exclusionFor' | 'hiddenAmong' | 'visibleReferences'>;
  /** Upload-policy provider — reads `assets.allowed_file_types` + max-size. */
  loadUploadPolicy: () => Promise<UploadPolicy>;
  /** Live retention setting; omitted by standalone consumers to keep the 30-day default. */
  loadRetentionDays?: () => Promise<number>;
  /** Feature 054 — audits asset writes co-transactionally when provided. */
  auditLog?: AuditPort;
  /**
   * Runs the Commands of feature 156 (`asset.replace`). Optional so a
   * composition that never replaces a file needs none; `replace` refuses
   * without it.
   */
  commandBus?: AssetReplaceDeps['commandBus'];
  /** Where a failed replace compensation is reported. */
  logError?: (message: string, context: Record<string, unknown>) => void;
  /**
   * Names who replaced the previous version. Optional: without it the detail
   * answers `replacedBy: null` (specs/156-asset-stable-url/ research R-14).
   */
  adminUsers?: Pick<AdminUserReadPort, 'findById'>;
}

export interface ListAssetsQuery {
  folderId?: string | null | undefined;
  q?: string | undefined;
  mime?: string | undefined;
  visibility?: 'public' | 'private' | undefined;
  includeDeleted?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export class AssetsLibraryService {
  private readonly pipeline: UploadPipeline;

  constructor(private readonly deps: AssetsLibraryServiceDeps) {
    this.pipeline = new UploadPipeline({
      emFactory: deps.emFactory,
      adapters: deps.adapters,
      loadPolicy: deps.loadUploadPolicy,
      ...(deps.auditLog ? { auditLog: deps.auditLog } : {}),
    });
  }

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action,
        objectType: 'asset',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  /**
   * Replace the asset's file in place — same id, same storage key, same URLs
   * (specs/156-asset-stable-url/ FR-001 – FR-010). Runs Command `asset.replace`.
   */
  async replace(input: AssetReplaceInput): Promise<AssetDetail> {
    const row = await replaceAssetFile(this.#swapDeps('replace'), input);
    return this.detail(row);
  }

  /**
   * Bring back the kept previous version — a swap with the current file
   * (FR-023). Runs Command `asset.restore_previous_version`.
   */
  async restorePreviousVersion(input: RestorePreviousVersionInput): Promise<AssetDetail> {
    const row = await restorePreviousVersion(this.#swapDeps('restorePreviousVersion'), input);
    return this.detail(row);
  }

  /**
   * Set the asset's permalink (specs/156-asset-stable-url/ FR-014 – FR-019,
   * research R-22). Runs Command `asset.permalink_set`; the same value again is
   * a no-op without an audit row. A name another asset holds is refused; a name
   * a **different** asset held last needs `confirmReuse`, and the audit row
   * records which asset that was.
   */
  async setPermalink(
    assetId: string,
    input: { permalink: string; confirmReuse?: boolean },
  ): Promise<AssetDetail> {
    const verdict = validateAssetPermalink(input.permalink);
    if (!verdict.ok) {
      throw new HttpError(400, ERROR_CODES.ASSET_PERMALINK_INVALID, 'The permalink is not valid.', {
        code: verdict.reason,
      });
    }
    const permalink = input.permalink;
    const lower = permalink.toLowerCase();
    const commandBus = this.#commandBus('setPermalink');
    let row: Asset;
    try {
      row = await commandBus.run<Asset>({
        action: 'asset.permalink_set',
        objectType: 'asset',
        objectId: assetId,
        run: async ({ em }) => {
          if (!isUuidShape(assetId)) throw assetNotFound(assetId);
          const a = await em.findOne(Asset, { id: assetId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
          if (!a) throw assetNotFound(assetId);
          refuseSoftDeleted(a);
          const old = a.permalink ?? null;
          if (old === permalink) {
            return { result: a, before: null, after: null, skipAudit: true };
          }
          await this.#refuseTaken(em, assetId, permalink, lower);

          const release = await em.findOne(AssetPermalinkRelease, { permalinkLower: lower });
          let reusedPermalink:
            | { previousAssetId: string; releasedAt: string; reason: AssetPermalinkReleaseReason }
            | null = null;
          if (release && release.assetId !== assetId) {
            if (!input.confirmReuse) {
              throw new HttpError(
                409,
                ERROR_CODES.ASSET_PERMALINK_PREVIOUSLY_USED,
                `The permalink "${permalink}" was used by another file before.`,
                { permalink, releasedAt: release.releasedAt.toISOString() },
              );
            }
            reusedPermalink = {
              previousAssetId: release.assetId,
              releasedAt: release.releasedAt.toISOString(),
              reason: release.reason,
            };
          }
          // The name is held again: it is no longer a previously used one.
          if (release) em.remove(release);
          if (old !== null && old.toLowerCase() !== lower) {
            await this.#release(em, old, assetId, 'changed');
          }
          a.permalink = permalink;
          await em.flush();
          return {
            result: a,
            before: { permalink: old },
            after: { permalink, ...(reusedPermalink ? { reusedPermalink } : {}) },
          };
        },
      });
    } catch (err) {
      // Two requests passed the pre-check together: the unique index decides.
      if (err instanceof UniqueConstraintViolationException) {
        const holders = await this.deps.emFactory().fork().execute<Array<{ id: string }>>(
          'select id::text as id from assets where lower(permalink) = ? and id <> ? limit 1',
          [lower, assetId],
        );
        throw new HttpError(
          409,
          ERROR_CODES.ASSET_PERMALINK_TAKEN,
          `The permalink "${permalink}" is already used by another asset.`,
          { permalink, assetId: await this.#nameableHolder(holders[0]?.id ?? null) },
        );
      }
      throw err;
    }
    return this.detail(row);
  }

  /** Remove the asset's permalink — Command `asset.permalink_remove`; none set is a no-op. */
  async removePermalink(assetId: string): Promise<AssetDetail> {
    const commandBus = this.#commandBus('removePermalink');
    const row = await commandBus.run<Asset>({
      action: 'asset.permalink_remove',
      objectType: 'asset',
      objectId: assetId,
      run: async ({ em }) => {
        if (!isUuidShape(assetId)) throw assetNotFound(assetId);
        const a = await em.findOne(Asset, { id: assetId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!a) throw assetNotFound(assetId);
        refuseSoftDeleted(a);
        const old = a.permalink ?? null;
        if (old === null) return { result: a, before: null, after: null, skipAudit: true };
        await this.#release(em, old, assetId, 'removed');
        a.permalink = null;
        await em.flush();
        return { result: a, before: { permalink: old }, after: { permalink: null } };
      },
    });
    return this.detail(row);
  }

  /** Refuses a name another asset holds, compared case-insensitively. */
  async #refuseTaken(em: EntityManager, assetId: string, permalink: string, lower: string): Promise<void> {
    const rows = await em.execute<Array<{ id: string }>>(
      'select id::text as id from assets where lower(permalink) = ? and id <> ? limit 1',
      [lower, assetId],
    );
    const holder = rows[0];
    if (holder) {
      throw new HttpError(
        409,
        ERROR_CODES.ASSET_PERMALINK_TAKEN,
        `The permalink "${permalink}" is already used by another asset.`,
        { permalink, assetId: await this.#nameableHolder(holder.id) },
      );
    }
  }

  /**
   * The asset holding a permalink, as the conflict may name it: `null` when the
   * caller may not see it (`specs/166-asset-reference-visibility/` R-11). The
   * name lives in one shared namespace, so *taken* cannot be hidden without
   * letting two assets share it — *by which asset* can.
   */
  async #nameableHolder(holderId: string | null): Promise<string | null> {
    if (holderId === null) return null;
    return (await this.deps.visibility.hiddenAmong([holderId])).has(holderId) ? null : holderId;
  }

  /** Records a name that stopped being held, naming its last holder (research R-22). */
  async #release(
    em: EntityManager,
    permalink: string,
    assetId: string,
    reason: AssetPermalinkReleaseReason,
  ): Promise<void> {
    await em.upsert(AssetPermalinkRelease, {
      permalinkLower: permalink.toLowerCase(),
      permalink,
      assetId,
      releasedAt: new Date(),
      reason,
    });
  }

  #commandBus(method: string): NonNullable<AssetsLibraryServiceDeps['commandBus']> {
    const commandBus = this.deps.commandBus;
    if (!commandBus) {
      throw new Error(`AssetsLibraryService.${method}: no command bus is wired into this composition.`);
    }
    return commandBus;
  }

  #swapDeps(method: string): AssetReplaceDeps {
    const commandBus = this.deps.commandBus;
    if (!commandBus) {
      throw new Error(`AssetsLibraryService.${method}: no command bus is wired into this composition.`);
    }
    return {
      emFactory: this.deps.emFactory,
      adapters: this.deps.adapters,
      stage: (stageInput) => this.pipeline.stage(stageInput),
      ledger: new ObjectCleanupLedger(this.deps.emFactory),
      commandBus,
      ...(this.deps.logError ? { logError: this.deps.logError } : {}),
      ...(this.deps.loadRetentionDays ? { loadRetentionDays: this.deps.loadRetentionDays } : {}),
    };
  }

  /** Upload entry point — runs the atomic put + insert + compensating-delete pipeline. */
  async upload(input: UploadInput): Promise<AssetDetail> {
    const asset = await this.pipeline.run(input);
    return this.detail(asset);
  }

  /** Resolve the serving URL for an asset by id (public or private). */
  /**
   * The embed form of an asset's URL — the stable URL plus `?v=<contentVersion>`
   * for a public asset, the signed URL for a private one (specs/156-asset-stable-url/
   * research R-8). What anything that *embeds* the asset should use; `resolveUrl`
   * stays the stable form.
   */
  async resolveEmbedUrl(assetId: string): Promise<string> {
    const em = this.deps.emFactory();
    if (!isUuidShape(assetId)) throw assetNotFound(assetId);
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw assetNotFound(assetId);
    const resolved = await this.resolveUrl(assetId);
    return versionedAssetUrl(resolved.url, a.contentVersion, a.storageBackend);
  }

  async resolveUrl(
    assetId: string,
    opts: { ttlSec?: number } = {},
  ): Promise<{ url: string; expiresAt: Date | null }> {
    const em = this.deps.emFactory();
    if (!isUuidShape(assetId)) throw assetNotFound(assetId);
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw assetNotFound(assetId);
    const adapter = await this.deps.adapters.getForBackend(
      a.storageBackend as 'local' | 's3' | 'gcs' | 'legacy',
    );
    return adapter.resolveUrl({
      locator: a.storageLocator || a.storageUrl,
      visibility: a.visibility,
      ...(opts.ttlSec !== undefined ? { ttlSec: opts.ttlSec } : {}),
    });
  }

  async getAsset(assetId: string): Promise<AssetDetail> {
    const em = this.deps.emFactory();
    if (!isUuidShape(assetId)) throw assetNotFound(assetId);
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw assetNotFound(assetId);
    return this.detail(a);
  }

  async listAssets(query: ListAssetsQuery): Promise<{ data: AssetSummary[]; nextCursor: string | null }> {
    const em = this.deps.emFactory();
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    // Build the predicate as an $and of independent clauses so the search OR
    // (filename/label) does not collide with any other clause on a single
    // top-level `$or` key.
    const clauses: Record<string, unknown>[] = [];
    if (query.folderId !== undefined) clauses.push({ folderId: query.folderId });
    if (query.visibility) clauses.push({ visibility: query.visibility });
    if (query.mime) clauses.push({ mimeType: { $like: `${query.mime}%` } });
    if (query.q) {
      clauses.push({
        $or: [
          { filename: { $ilike: `%${query.q}%` } },
          { label: { $ilike: `%${query.q}%` } },
          { permalink: { $ilike: `%${query.q}%` } },
        ],
      });
    }
    if (!query.includeDeleted) clauses.push({ deletedAt: null });

    // Assets the caller may not see are left out in SQL, before paging
    // (`specs/166-asset-reference-visibility/` R-5), so every page is full and
    // the cursor never lands on a hidden row. The candidates are scoped by this
    // list's own clauses first: only rows this list could return are evaluated.
    // An unrestricted caller gets an empty set without a read.
    // Both sets travel as one uuid-array parameter each (T049).
    const hidden = await this.deps.visibility.exclusionFor((candidates) =>
      assetIdsAmong(em.fork(), clauses.length > 0 ? { $and: clauses } : {}, candidates),
    );
    if (hidden.length > 0) clauses.push(idNotAmong(hidden));

    const where: Record<string, unknown> = clauses.length > 0 ? { $and: clauses } : {};

    // Offset-based pagination. The opaque cursor carries the next offset.
    // Keyset pagination is not usable here: `createdAt` is stored with
    // microsecond precision but a JS Date (and the ISO cursor) only carries
    // milliseconds, so a keyset boundary on (createdAt, id) silently drops the
    // rows that share a truncated instant. Offset over a total order
    // (createdAt DESC, id DESC) is precision-independent and correct.
    const offset = query.cursor ? (decodeCursor(query.cursor) ?? 0) : 0;

    const rows = await em.find(Asset, where, {
      orderBy: { createdAt: 'desc', id: 'desc' },
      offset,
      limit: limit + 1,
    });
    const overflow = rows.length > limit;
    const page = overflow ? rows.slice(0, limit) : rows;
    const nextCursor = overflow ? encodeCursor(offset + limit) : null;
    // The permalink base is two settings reads: once per call, not once per row.
    const permalinkBase = this.#permalinkBase();
    const summaries = await Promise.all(page.map((a) => this.summary(a, permalinkBase)));
    return { data: summaries, nextCursor };
  }

  async patchAsset(
    assetId: string,
    patch: {
      filename?: string;
      label?: string | null;
      mimeType?: string;
      visibility?: 'public' | 'private';
      folderId?: string | null;
      /**
       * Per-language alternate text. `AssetDetail` has always reported it and
       * nothing could write it; feature 068 needs it, because an imported image
       * must keep the alternate text the source supplied, per language
       * (FR-047). Not on `patchAssetRequestSchema`, so the HTTP surface is
       * unchanged — this is a service-level field for module callers.
       */
      altText?: Record<string, string> | null;
    },
  ): Promise<AssetDetail> {
    const em = this.deps.emFactory();
    // A visibility change takes the row lock a replace takes, so the ACL a
    // replace copies with is never stale (specs/156-asset-stable-url/ R-18).
    // A pessimistic lock needs a transaction; the other edits do not.
    const locking = patch.visibility !== undefined;
    const apply = async (tx: EntityManager): Promise<Asset> => {
      const a = await tx.findOne(
        Asset,
        { id: assetId },
        locking ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {},
      );
      if (!a) throw assetNotFound(assetId);

      if (patch.filename !== undefined) a.filename = patch.filename;
      if (patch.label !== undefined) a.label = patch.label;
      if (patch.altText !== undefined) a.altText = patch.altText;
      if (patch.mimeType !== undefined) {
        a.mimeType = patch.mimeType;
        a.mimeTypeOverridden = true;
      }
      if (patch.folderId !== undefined) a.folderId = patch.folderId;

      if (patch.visibility !== undefined && patch.visibility !== a.visibility) {
        // Refuse to flip a `legacy` asset to private — we cannot sign URLs we
        // didn't issue.
        if (a.storageBackend === 'legacy' && patch.visibility === 'private') {
          throw new HttpError(
            409,
            ERROR_CODES.ASSET_LEGACY_LOCATOR_CANNOT_HARDEN,
            'Cannot mark a `legacy` asset as private — re-upload it through the active adapter first.',
          );
        }
        const adapter = await this.deps.adapters.getForBackend(
          a.storageBackend as 'local' | 's3' | 'gcs' | 'legacy',
        );
        // Cloud adapters update object ACLs; local FS no-ops (visibility is
        // enforced by routes.public.ts on every request).
        if ('setVisibility' in adapter && typeof adapter.setVisibility === 'function') {
          try {
            await adapter.setVisibility({ locator: a.storageLocator || a.storageUrl, visibility: patch.visibility });
          } catch (err) {
            if (err instanceof LegacyAssetCannotHardenError) {
              throw new HttpError(409, ERROR_CODES.ASSET_LEGACY_LOCATOR_CANNOT_HARDEN, err.message);
            }
            throw err;
          }
        }
        a.visibility = patch.visibility;
      }

      this.#audit(tx, 'asset.update', a.id, null, { filename: a.filename, visibility: a.visibility });
      await tx.flush();
      return a;
    };
    const a = locking ? await em.transactional((tx) => apply(tx)) : await apply(em);
    return this.detail(a);
  }

  async setVisibility(assetId: string, visibility: 'public' | 'private'): Promise<AssetDetail> {
    return this.patchAsset(assetId, { visibility });
  }

  // — US2 — soft-delete / restore / move ------------------------------------

  async softDelete(assetId: string): Promise<{ deletedAt: Date; purgeAfterAt: Date }> {
    const em = this.deps.emFactory();
    if (!isUuidShape(assetId)) throw assetNotFound(assetId);
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw assetNotFound(assetId);
    const retentionDays = this.deps.loadRetentionDays ? await this.deps.loadRetentionDays() : 30;
    const purgeAfter = (deletedAt: Date) =>
      new Date(deletedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    if (a.deletedAt) {
      // Idempotent. The date reported follows the setting as read now — what
      // the retention sweep uses (specs/156-asset-stable-url/ owner ruling P1);
      // the stored `purgeAfterAt` keeps the first value as a rollback snapshot.
      return { deletedAt: a.deletedAt, purgeAfterAt: purgeAfter(a.deletedAt) };
    }
    // Reference protection (FR-030): every reference counts, whoever asks and
    // whatever they may see (`specs/166-asset-reference-visibility/` FR-008).
    // The refusal names only the references the caller may see (R-8); the
    // asset is visible to them (the by-id guard ran), so by invariant I-1 at
    // least one is named — a hidden record is neither named nor counted.
    const refs = await this.deps.referenceRegistry.findReferences(assetId);
    if (refs.length > 0) {
      const visible = await this.deps.visibility.visibleReferences(assetId);
      throw new HttpError(
        409,
        ERROR_CODES.ASSET_REFERENCED,
        `Asset is in use by ${visible.length} record(s); detach those first.`,
        visible.slice(0, 20).map((r) => ({
          path: r.kind,
          issue: r.label,
        })),
      );
    }
    const now = new Date();
    a.deletedAt = now;
    // Written at deletion for a rollback; no longer read (research R-13).
    a.purgeAfterAt = purgeAfter(now);
    this.#audit(em, 'asset.soft_delete', a.id, { filename: a.filename }, null);
    await em.flush();
    return { deletedAt: a.deletedAt, purgeAfterAt: a.purgeAfterAt };
  }

  async restore(assetId: string): Promise<AssetDetail> {
    const em = this.deps.emFactory();
    if (!isUuidShape(assetId)) throw assetNotFound(assetId);
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw assetNotFound(assetId);
    a.deletedAt = null;
    a.purgeAfterAt = null;
    a.pendingCleanup = false;
    this.#audit(em, 'asset.restore', a.id, null, { filename: a.filename });
    await em.flush();
    return this.detail(a);
  }

  async move(assetId: string, folderId: string | null): Promise<AssetDetail> {
    const em = this.deps.emFactory();
    if (!isUuidShape(assetId)) throw assetNotFound(assetId);
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw assetNotFound(assetId);
    a.folderId = folderId;
    this.#audit(em, 'asset.move', a.id, null, { folderId });
    await em.flush();
    return this.detail(a);
  }

  /**
   * Move what exists and the caller may see. An id the caller may not see is
   * skipped exactly as a missing one is — not moved, not counted, not in the
   * audit row (`specs/166-asset-reference-visibility/` R-9).
   */
  async moveMany(assetIds: string[], folderId: string | null): Promise<{ movedCount: number }> {
    const em = this.deps.emFactory();
    const found = await em.find(Asset, { id: { $in: assetIds } });
    const hidden = await this.deps.visibility.hiddenAmong(found.map((a) => a.id));
    const assets = found.filter((a) => !hidden.has(a.id));
    for (const a of assets) a.folderId = folderId;
    if (assets.length > 0) {
      this.#audit(em, 'asset.move_many', folderId ?? 'root', null, {
        folderId,
        assetIds: assets.map((a) => a.id),
      });
    }
    await em.flush();
    return { movedCount: assets.length };
  }

  // — Serialization helpers --------------------------------------------------

  /** The base permalink URLs are built on — read lazily, at most once. */
  #permalinkBase(): () => Promise<string> {
    let base: Promise<string> | undefined;
    return () => {
      base ??= this.deps.adapters.localPublicBase();
      return base;
    };
  }

  private async summary(a: Asset, permalinkBase = this.#permalinkBase()): Promise<AssetSummary> {
    const url = await this.resolveUrl(a.id);
    const adapter = await this.deps.adapters.getForBackend(a.storageBackend);
    // The stable form: the unsigned URL of the stable key, whatever the visibility.
    const fileUrl = await adapter.resolveUrl({
      locator: a.storageLocator || a.storageUrl,
      visibility: 'public',
    });
    const permalink = a.permalink ?? null;
    return {
      id: a.id,
      folderId: a.folderId ?? null,
      filename: a.filename,
      label: a.label ?? null,
      mimeType: a.mimeType,
      sizeBytes: Number(a.sizeBytes),
      visibility: a.visibility,
      storageBackend: a.storageBackend,
      // The embed form: a public URL carries the content version (R-8).
      url: versionedAssetUrl(url.url, a.contentVersion, a.storageBackend),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
      pendingCleanup: a.pendingCleanup,
      fileUrl: fileUrl.url,
      permalink,
      permalinkUrl:
        permalink === null
          ? null
          : permalinkUrl(await permalinkBase(), permalink),
      contentVersion: a.contentVersion,
    };
  }

  private async detail(a: Asset): Promise<AssetDetail> {
    const summary = await this.summary(a);
    // The caller's "used by" list, never the registry's full one: a record the
    // caller may not see is neither named nor counted, and `assetId` stays in
    // the library (`specs/166-asset-reference-visibility/` FR-007, R-8). Every
    // route that answers a detail — read, edit, move, replace, restore,
    // permalink — answers through here.
    const references = await this.deps.visibility.visibleReferences(a.id);
    // Read once: it dates the previous version and is named by the replace
    // confirmation. Whole days, at least one, as the contract declares.
    const retentionDays = this.deps.loadRetentionDays ? await this.deps.loadRetentionDays() : 30;
    return {
      ...summary,
      altText: a.altText ?? null,
      references,
      previousVersion: await this.previousVersion(a, retentionDays),
      retentionDays: Math.max(1, Math.floor(retentionDays)),
      replaceable: isReplaceableInPlace(a),
    };
  }

  /** The kept previous version as the detail panel shows it (FR-022, FR-023). */
  private async previousVersion(a: Asset, retentionDays: number): Promise<AssetPreviousVersion | null> {
    if (
      !a.previousStorageLocator ||
      !a.previousFilename ||
      !a.previousMimeType ||
      !a.previousContentVersion ||
      !a.previousReplacedAt ||
      a.previousSizeBytes == null
    ) {
      return null;
    }
    let replacedBy: AssetPreviousVersion['replacedBy'] = null;
    if (a.previousReplacedBy && this.deps.adminUsers) {
      const admin = await this.deps.adminUsers.findById(a.previousReplacedBy);
      if (admin) {
        replacedBy = {
          id: admin.id,
          displayName: `${admin.firstName} ${admin.lastName}`.trim() || admin.email,
        };
      }
    }
    return {
      filename: a.previousFilename,
      mimeType: a.previousMimeType,
      sizeBytes: Number(a.previousSizeBytes),
      contentVersion: a.previousContentVersion,
      replacedAt: a.previousReplacedAt.toISOString(),
      replacedBy,
      restorableUntil: new Date(
        a.previousReplacedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };
  }
}

/**
 * A soft-deleted asset's permalink is not changed: it is refused like a replace
 * or a restore of its file, and the asset keeps the permalink it had.
 */
function refuseSoftDeleted(a: Asset): void {
  if (a.deletedAt) {
    throw new HttpError(410, ERROR_CODES.ASSET_GONE, 'Restore the asset before changing its permalink.');
  }
}

/** Encode a pagination offset as an opaque base64url cursor. */
function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

/** Decode an opaque cursor back into a non-negative offset, or null if invalid. */
function decodeCursor(c: string): number | null {
  try {
    const raw = Buffer.from(c, 'base64url').toString('utf8');
    const m = raw.match(/^o:(\d+)$/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
