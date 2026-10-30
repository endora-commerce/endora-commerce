import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { GalleryLabel } from './gallery-item-label.entity.js';

/**
 * GalleryRoleScopeOverride — feature 168 (`specs/168-product-editor-scope-switcher/data-model.md`
 * §6b). Which gallery item holds a role (`base_image`, `small_image`, `thumbnail`) at a Channel
 * (`languageCode` `null`) or Channel × language scope. The Global holders stay in
 * `gallery_item_labels`.
 *
 * `galleryItemId` `null` is the **empty override**: no image holds the role at this scope. No row
 * = inherit. The holder FK is composite and nullable — `(gallery_item_id, product_id)` →
 * `gallery_items (id, product_id)`, `match simple`, **on delete cascade** (not `set null`: a
 * removed holder makes the role inherit again rather than silently become "no image"). Partial
 * uniques are raw SQL in the migration.
 */
@GlobalEntity()
@Entity({ tableName: 'gallery_role_scope_overrides' })
export class GalleryRoleScopeOverride {
  [OptionalProps]?: 'id' | 'languageCode' | 'galleryItemId' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  /** `null` = the Channel scope; else Channel × language, in the channel's spelling. */
  @Property({ type: 'string', length: 16, nullable: true })
  languageCode: string | null = null;

  @Property({ type: 'string', length: 16 })
  label!: GalleryLabel;

  /** `null` = no image holds the role at this scope (empty override). */
  @Property({ type: 'uuid', nullable: true })
  galleryItemId: string | null = null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
