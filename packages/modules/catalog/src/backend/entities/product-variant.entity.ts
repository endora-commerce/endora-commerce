import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Concrete variant of a `type=variant` Product.
 * `variantAttributeValues` contains only keys where the parent's ProductAttribute
 * has isVariantAxis=true.
 *
 * Issue #693 — `deletedAt` is set by the parent's `product.delete` Command, in the same
 * transaction, and never by anything else: a variant is soft-deleted with its product and hard-
 * deleted on its own. `sku` is unique among rows whose `deletedAt` is null — a partial unique
 * index (`product_variants_sku_live_unique`) in raw SQL in the migration, so no `@Unique()`
 * here — which is what frees a deleted product's variant SKUs for reuse.
 */
@GlobalEntity()
@Entity({ tableName: 'product_variants' })
export class ProductVariant {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'stockLevel' | 'deletedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  parentProductId!: string;

  @Property({ type: 'string', length: 255 })
  @Index()
  sku!: string;

  @Property({ type: 'json' })
  variantAttributeValues: Record<string, unknown> = {};

  @Property({ type: 'integer', nullable: true })
  stockLevel?: number | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;
}
