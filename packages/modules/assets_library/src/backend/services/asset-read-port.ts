import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetReadPort, AssetRecord } from '@endora-commerce/contracts';
import { Asset } from '../entities/asset.entity.js';

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
  constructor(private readonly emFactory: () => EntityManager) {}

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
