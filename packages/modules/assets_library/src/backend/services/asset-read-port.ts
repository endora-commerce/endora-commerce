import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetBytes,
  AssetByteStream,
  AssetReadPort,
  AssetRecord,
  ObjectStorageBackendCode,
  StorageBackendCode,
} from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { Asset } from '../entities/asset.entity.js';
import type { StorageResolveUrlInput, StorageResolveUrlOutput } from './storage/storage-adapter.js';

/**
 * The narrow slice of the adapter registry {@link AssetReadService} needs — the
 * URL builder of whichever backend owns an object's bytes, and, for a backend
 * that is a real object store, the reader that opens them.
 *
 * Declared here rather than taking `AdapterRegistry` so that the read model can
 * be unit-tested over a stub, and so that the two capabilities it has over the
 * `assets` table are visible in its constructor.
 *
 * **Two overloads, narrowest first**, because `AdapterRegistry` has exactly
 * this shape and for the reason it has it: `legacy` is not a store — it
 * resolves the URL of a pre-013 row this platform did not issue and can open
 * nothing — so `open` exists only on the arm a `legacy` code cannot reach
 * (`ObjectStoragePort`'s doc block, point 3). Widest-first would hand every
 * call the arm without `open` and put the probe back at the call site, which is
 * the thing the port removes.
 */
export interface AssetStorageRegistry {
  getForBackend(backend: ObjectStorageBackendCode): Promise<{
    resolveUrl(input: StorageResolveUrlInput): StorageResolveUrlOutput | Promise<StorageResolveUrlOutput>;
    open(input: { locator: string }): Promise<AssetByteStream>;
  }>;
  getForBackend(
    backend: StorageBackendCode,
  ): Promise<{ resolveUrl(input: StorageResolveUrlInput): StorageResolveUrlOutput | Promise<StorageResolveUrlOutput> }>;
}

/**
 * The row-level read model `assets_library` publishes (feature 075, Phase P).
 *
 * Five inbound sites read the `Asset` entity, and all five ask the same thing
 * before attaching an id an admin supplied: does this asset exist, and is it
 * the right kind? `catalog`'s gallery, attachments and product links do it
 * three times over, `orders` once for invoice branding.
 *
 * `sizeBytes` stays a string: the column is `bigint`, and a `number` cannot
 * hold one past 2^53.
 */
export class AssetReadService implements AssetReadPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Required, and a provider rather than the registry itself: the registry is
     * built from settings and rebuilt when they change, so a captured one goes
     * stale after an operator switches the active backend. Not optional — an
     * argument whose omission is silent is how this module once shipped a
     * permission gate that defaulted to permissive.
     */
    private readonly adapters: () => AssetStorageRegistry,
  ) {}

  async findById(id: string, options?: { liveOnly?: boolean }): Promise<AssetRecord | null> {
    const asset = await this.emFactory().findOne(Asset, {
      id,
      ...(options?.liveOnly ? { deletedAt: null } : {}),
    });
    return asset ? toAssetRecord(asset) : null;
  }

  async findByIds(
    ids: readonly string[],
    options?: { liveOnly?: boolean },
  ): Promise<AssetRecord[]> {
    if (ids.length === 0) return [];
    const assets = await this.emFactory().find(Asset, {
      id: { $in: [...ids] },
      ...(options?.liveOnly ? { deletedAt: null } : {}),
    });
    return assets.map(toAssetRecord);
  }

  /**
   * FR-043's rule, answered where the information is.
   *
   * Only a live, `public` asset can have a stable URL, and only this module can
   * say so: a consumer holding an asset id cannot tell a signed link from a
   * permanent one. So the filter is here and the absence is the answer — see
   * the port's contract.
   *
   * One query for the rows and a URL build per row. The adapters are cached by
   * the registry and a *public* resolution is a string join in all four of
   * them, so this issues no I/O beyond the read.
   */
  async resolvePublicUrls(assetIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (assetIds.length === 0) return out;
    const registry = this.adapters();

    const assets = await this.emFactory().find(Asset, {
      id: { $in: [...assetIds] },
      deletedAt: null,
      visibility: 'public',
    });

    for (const asset of assets) {
      const adapter = await registry.getForBackend(asset.storageBackend);
      const resolved = await adapter.resolveUrl({
        locator: asset.storageLocator || asset.storageUrl,
        visibility: asset.visibility,
      });
      // The rule the port states, kept where the answer is rather than inferred
      // from the filter above. **Measured**: with that filter in place this
      // branch is unreachable — all four resolvers answer a `public` visibility
      // with `expiresAt: null` as their first statement — and with it removed
      // this branch is what still refuses a private asset. Two spellings of one
      // rule is deliberate here and only here: a fifth backend, or a fifth
      // visibility, changes which of the two is doing the work, and a feed that
      // published an expiring link would not fail anywhere near this line.
      if (resolved.expiresAt !== null) continue;
      out.set(asset.id, resolved.url);
    }
    return out;
  }

  /**
   * The bytes of one live asset — the port's rule, answered where the storage
   * layout is (`specs/110-instance-repository/` T118c).
   *
   * Three facts left a composition root to arrive here, and each of them is one
   * line below. `legacy` is not a store, so a row on it has no bytes to open
   * and answers `null` rather than being probed for an `open` method at the
   * call site. The locator falls back to `storageUrl` for rows written before
   * the column existed. And an adapter answers a stream, which the caller
   * wanted whole.
   *
   * **The `catch` is the degrade, and it belongs here** (composition checklist
   * item 7): a configured backend that will not stream is a document rendered
   * without its decoration, and the caller — holding an asset id and nothing
   * else — cannot tell that state from an asset that is not there. It is
   * narrow on purpose: it covers the open and the drain, never the row read,
   * which is this module's own `EntityManager` and whose failure is a real one.
   */
  async openAssetBytes(assetId: string): Promise<AssetBytes | null> {
    const asset = await this.emFactory().findOne(Asset, { id: assetId, deletedAt: null });
    if (!asset) return null;
    // Narrowed here rather than probed at the caller: the overload's `open` arm
    // is unreachable for `legacy` by construction.
    if (asset.storageBackend === 'legacy') return null;

    try {
      const store = await this.adapters().getForBackend(asset.storageBackend);
      const stream = await store.open({ locator: asset.storageLocator || asset.storageUrl });
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of stream) {
        const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
        chunks.push(bytes);
        length += bytes.byteLength;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes, mimeType: asset.mimeType };
    } catch (error) {
      // Narrow tolerance, and `rethrowIfModuleDisabled` is its first line by
      // decision rather than by habit. The registry this reaches is this
      // module's own and crosses no gate today, so the re-throw is unreachable;
      // what it buys is that it stays unreachable *by construction* — a future
      // adapter that resolved a port would otherwise have its "this capability
      // is off" answer absorbed into "this asset has no bytes", which is the
      // fail-open composition checklist item 7 refuses. A status-code test
      // would not do: `ModuleDisabledError` is an `HttpError`.
      rethrowIfModuleDisabled(error);
      return null;
    }
  }
}

export function toAssetRecord(asset: Asset): AssetRecord {
  return {
    id: asset.id,
    kind: asset.kind,
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    storageUrl: asset.storageUrl,
    altText: asset.altText ?? null,
    folderId: asset.folderId ?? null,
    visibility: asset.visibility,
    label: asset.label ?? null,
    storageBackend: asset.storageBackend,
    storageLocator: asset.storageLocator,
    pendingCleanup: asset.pendingCleanup,
    purgeAfterAt: asset.purgeAfterAt ?? null,
    mimeTypeOverridden: asset.mimeTypeOverridden,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    deletedAt: asset.deletedAt ?? null,
  };
}
