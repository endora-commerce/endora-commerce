import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import { newContentVersion } from '../services/content-version.js';

export type AssetKind = 'image' | 'video' | 'pdf' | 'certificate' | 'other';

/**
 * Asset — file managed by the Assets Library (feature 013). Replaces the
 * pre-013 `assets` module entity. Existing FK references from Catalog
 * (gallery_items.asset_id, product_attachments.asset_id, products.download_asset_id)
 * and the new categories.main_image_asset_id continue to point here.
 *
 * Visibility, storage backend, and folder are introduced in feature 013.
 *
 * Feature 156 (`specs/156-asset-stable-url/`) makes the file URL stable across
 * replaces: `storageLocator` is the stable key, `contentVersion` identifies the
 * bytes it currently holds, `permalink` is an operator-chosen alias, and the
 * nine `previous*` properties hold the one kept previous version — all set or
 * all null (`previousReplacedBy` may be null alone, for a system actor), see
 * {@link hasPreviousVersion} and {@link clearPreviousVersion}.
 */
@GlobalEntity()
@Entity({ tableName: 'assets' })
export class Asset {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'altText'
    | 'deletedAt'
    | 'folderId'
    | 'visibility'
    | 'label'
    | 'storageBackend'
    | 'storageLocator'
    | 'pendingCleanup'
    | 'purgeAfterAt'
    | 'mimeTypeOverridden'
    | 'contentVersion'
    | 'permalink'
    | 'previousStorageLocator'
    | 'previousFilename'
    | 'previousMimeType'
    | 'previousMimeTypeOverridden'
    | 'previousKind'
    | 'previousSizeBytes'
    | 'previousContentVersion'
    | 'previousReplacedAt'
    | 'previousReplacedBy';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /**
   * The kind of the file the asset currently holds — what the replace guard
   * compares a replacement against. An admin MIME override never changes it;
   * a replace or a restore does.
   */
  @Property({ type: 'string', length: 16 })
  @Index()
  kind!: AssetKind;

  @Property({ type: 'string', length: 255 })
  filename!: string;

  @Property({ type: 'string', length: 127 })
  mimeType!: string;

  @Property({ type: 'bigint' })
  sizeBytes!: string;

  /**
   * Written once at upload and never rewritten — a replace does not touch it.
   * `AssetRecord.storageUrl` is derived from it at read time; read
   * `storageLocator` + `storageBackend` for where the bytes are.
   *
   * @deprecated Use `storageLocator` + `storageBackend` instead. Retained
   * for the legacy-decomp escape hatch (research R11).
   */
  @Property({ type: 'string', length: 2048 })
  storageUrl!: string;

  @Property({ type: 'json', nullable: true })
  altText?: Record<string, string> | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  folderId?: string | null;

  @Property({ type: 'string', length: 7 })
  visibility: 'public' | 'private' = 'public';

  @Property({ type: 'text', nullable: true })
  label?: string | null;

  @Property({ type: 'string', length: 8 })
  storageBackend: 'local' | 's3' | 'gcs' | 'legacy' = 'local';

  /**
   * The stable key: fixed at upload, never rewritten, and always holding the
   * current bytes. A replace copies the new file over it.
   */
  @Property({ type: 'string', length: 2048 })
  storageLocator: string = '';

  @Property({ type: 'boolean' })
  pendingCleanup: boolean = false;

  @Property({ type: 'datetime', nullable: true })
  purgeAfterAt?: Date | null;

  @Property({ type: 'boolean' })
  mimeTypeOverridden: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  /** Identity of the bytes the asset currently holds — the `v` marker and the ETag tail. */
  @Property({ type: 'string', length: 32 })
  contentVersion: string = newContentVersion();

  /** Operator-chosen path served at `<base>/assets/file/<permalink>`; unique case-insensitively. */
  @Property({ type: 'string', length: 200, nullable: true })
  permalink?: string | null;

  /** Random sibling key of the kept previous version; never in a URL. */
  @Property({ type: 'string', length: 2048, nullable: true })
  previousStorageLocator?: string | null;

  @Property({ type: 'string', length: 255, nullable: true })
  previousFilename?: string | null;

  @Property({ type: 'string', length: 127, nullable: true })
  previousMimeType?: string | null;

  @Property({ type: 'boolean', nullable: true })
  previousMimeTypeOverridden?: boolean | null;

  @Property({ type: 'string', length: 16, nullable: true })
  previousKind?: AssetKind | null;

  @Property({ type: 'bigint', nullable: true })
  previousSizeBytes?: string | null;

  @Property({ type: 'string', length: 32, nullable: true })
  previousContentVersion?: string | null;

  /** When the previous version stopped being current; its retention counts from here. */
  @Property({ type: 'datetime', nullable: true })
  previousReplacedAt?: Date | null;

  /** Admin user id of whoever replaced it; null for a system actor. */
  @Property({ type: 'uuid', nullable: true })
  previousReplacedBy?: string | null;
}

/** True when the asset keeps a previous version. */
export function hasPreviousVersion(asset: Asset): boolean {
  return asset.previousStorageLocator != null;
}

/** Forgets the kept previous version — nulls all nine `previous*` properties together. */
export function clearPreviousVersion(asset: Asset): void {
  asset.previousStorageLocator = null;
  asset.previousFilename = null;
  asset.previousMimeType = null;
  asset.previousMimeTypeOverridden = null;
  asset.previousKind = null;
  asset.previousSizeBytes = null;
  asset.previousContentVersion = null;
  asset.previousReplacedAt = null;
  asset.previousReplacedBy = null;
}
