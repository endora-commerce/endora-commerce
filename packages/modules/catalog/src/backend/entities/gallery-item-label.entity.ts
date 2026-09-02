import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

export type GalleryLabel = 'base_image' | 'small_image' | 'thumbnail';

/**
 * GalleryItemLabel — composite-PK bridge that holds the label assignments
 * for a Gallery Item (feature 002 US3, data-model.md §2.4).
 *
 * The DB enforces:
 *   - composite PK (gallery_item_id, label): one row per (item, label) pair.
 *   - UNIQUE (product_id, label): only ONE Element of each label kind
 *     per Product. This is the load-bearing constraint that makes the
 *     atomic-swap operation in `gallery.service.ts` safe (research.md R-2).
 *   - CHECK label IN ('base_image', 'small_image', 'thumbnail').
 *
 * `productId` is duplicated on this bridge purely so PG can enforce the
 * UNIQUE constraint without a sub-query — the canonical owner of the
 * (item, product) link is `gallery_items.product_id`.
 */
@GlobalEntity()
@Entity({ tableName: 'gallery_item_labels' })
export class GalleryItemLabel {
  @PrimaryKey({ type: 'uuid' })
  galleryItemId!: string;

  @PrimaryKey({ type: 'string', length: 16 })
  label!: GalleryLabel;

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;
}
