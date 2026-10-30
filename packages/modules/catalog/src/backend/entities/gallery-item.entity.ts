import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * GalleryItem — Asset reference attached to a Product (feature 002 US3,
 * data-model.md §2.3). Labels (Base / Small / Thumbnail) live in the
 * sibling `GalleryItemLabel` bridge so the per-product UNIQUE constraint
 * can be enforced at the DB level (research.md R-2).
 */
@GlobalEntity()
@Entity({ tableName: 'gallery_items' })
export class GalleryItem {
  [OptionalProps]?: 'id' | 'position' | 'altText' | 'hidden' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'uuid' })
  assetId!: string;

  @Property({ type: 'integer' })
  position: number = 0;

  /**
   * Feature 168 (data-model §6) — the Global alt text; `null` = none (the asset's own alt text is
   * the derived fallback). Channel and Channel × language values live in
   * `gallery_item_scope_overrides`.
   */
  @Property({ type: 'text', nullable: true })
  altText: string | null = null;

  /** Feature 168 — hidden at Global. */
  @Property({ type: 'boolean' })
  hidden: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
