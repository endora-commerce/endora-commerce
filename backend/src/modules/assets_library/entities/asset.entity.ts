import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Asset — file managed by the Assets Library (feature 013). Replaces the
 * pre-013 `assets` module entity. Existing FK references from Catalog
 * (gallery_items.asset_id, product_attachments.asset_id, products.download_asset_id)
 * and the new categories.main_image_asset_id continue to point here.
 *
 * Visibility, storage backend, and folder are introduced in feature 013;
 * `storageUrl` is retained for one release as a read-only legacy escape hatch
 * and is no longer written by new code (research R11 / FR-034).
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
    | 'mimeTypeOverridden';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 16 })
  @Index()
  kind!: 'image' | 'video' | 'pdf' | 'certificate' | 'other';

  @Property({ type: 'string', length: 255 })
  filename!: string;

  @Property({ type: 'string', length: 127 })
  mimeType!: string;

  @Property({ type: 'bigint' })
  sizeBytes!: string;

  /**
   * @deprecated Use `storageLocator` + `storageBackend` instead. Retained
   * for one release for the legacy-decomp escape hatch (research R11);
   * removed in a follow-up cleanup PR.
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
}
