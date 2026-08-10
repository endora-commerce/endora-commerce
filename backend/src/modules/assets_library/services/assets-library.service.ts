// AssetsLibraryService — public facade. US1 fills upload / get / list /
// patch / setVisibility / resolveUrl. US2 will fill softDelete / restore /
// move. US3 brings cloud adapters online.

import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type AssetSummary, type AssetDetail } from '@b2b/contracts';
import { Asset } from '../entities/asset.entity.js';
import { HttpError } from '../../../http/error-envelope.js';
import type { AdapterRegistry } from './storage/adapter-registry.js';
import type { AssetReferenceRegistry } from './reference-registry.js';
import { UploadPipeline, type UploadInput, type UploadPolicy } from './upload-pipeline.js';
import { LegacyAssetCannotHardenError } from './storage/errors.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

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
  /** Upload-policy provider — reads `assets.allowed_file_types` + max-size. */
  loadUploadPolicy: () => Promise<UploadPolicy>;
  /** Feature 054 — audits asset writes co-transactionally when provided. */
  auditLog?: AuditLogService;
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

  /** Upload entry point — runs the atomic put + insert + compensating-delete pipeline. */
  async upload(input: UploadInput): Promise<AssetDetail> {
    const asset = await this.pipeline.run(input);
    return this.detail(asset);
  }

  /** Resolve the serving URL for an asset by id (public or private). */
  async resolveUrl(
    assetId: string,
    opts: { ttlSec?: number } = {},
  ): Promise<{ url: string; expiresAt: Date | null }> {
    const em = this.deps.emFactory();
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`);
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
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`);
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
        ],
      });
    }
    if (!query.includeDeleted) clauses.push({ deletedAt: null });

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
    const summaries = await Promise.all(page.map((a) => this.summary(a)));
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
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`);

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

    this.#audit(em, 'asset.update', a.id, null, { filename: a.filename, visibility: a.visibility });
    await em.flush();
    return this.detail(a);
  }

  async setVisibility(assetId: string, visibility: 'public' | 'private'): Promise<AssetDetail> {
    return this.patchAsset(assetId, { visibility });
  }

  // — US2 — soft-delete / restore / move ------------------------------------

  async softDelete(assetId: string): Promise<{ deletedAt: Date; purgeAfterAt: Date }> {
    const em = this.deps.emFactory();
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`);
    if (a.deletedAt) {
      // Idempotent — return current state.
      return { deletedAt: a.deletedAt, purgeAfterAt: a.purgeAfterAt as Date };
    }
    // Reference protection (FR-030).
    const refs = await this.deps.referenceRegistry.findReferences(assetId);
    if (refs.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.ASSET_REFERENCED,
        `Asset is in use by ${refs.length} record(s); detach those first.`,
        refs.slice(0, 20).map((r) => ({
          path: r.kind,
          issue: r.label,
        })),
      );
    }
    const retentionDays = 30; // assets.soft_delete_retention_days; reads inline in US2.
    const now = new Date();
    a.deletedAt = now;
    a.purgeAfterAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    this.#audit(em, 'asset.soft_delete', a.id, { filename: a.filename }, null);
    await em.flush();
    return { deletedAt: a.deletedAt, purgeAfterAt: a.purgeAfterAt };
  }

  async restore(assetId: string): Promise<AssetDetail> {
    const em = this.deps.emFactory();
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`);
    a.deletedAt = null;
    a.purgeAfterAt = null;
    a.pendingCleanup = false;
    this.#audit(em, 'asset.restore', a.id, null, { filename: a.filename });
    await em.flush();
    return this.detail(a);
  }

  async move(assetId: string, folderId: string | null): Promise<AssetDetail> {
    const em = this.deps.emFactory();
    const a = await em.findOne(Asset, { id: assetId });
    if (!a) throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${assetId} not found.`);
    a.folderId = folderId;
    this.#audit(em, 'asset.move', a.id, null, { folderId });
    await em.flush();
    return this.detail(a);
  }

  async moveMany(assetIds: string[], folderId: string | null): Promise<{ movedCount: number }> {
    const em = this.deps.emFactory();
    const assets = await em.find(Asset, { id: { $in: assetIds } });
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

  private async summary(a: Asset): Promise<AssetSummary> {
    const url = await this.resolveUrl(a.id);
    return {
      id: a.id,
      folderId: a.folderId ?? null,
      filename: a.filename,
      label: a.label ?? null,
      mimeType: a.mimeType,
      sizeBytes: Number(a.sizeBytes),
      visibility: a.visibility,
      storageBackend: a.storageBackend,
      url: url.url,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
      pendingCleanup: a.pendingCleanup,
    };
  }

  private async detail(a: Asset): Promise<AssetDetail> {
    const summary = await this.summary(a);
    const references = await this.deps.referenceRegistry.findReferences(a.id);
    return {
      ...summary,
      altText: a.altText ?? null,
      references,
    };
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
