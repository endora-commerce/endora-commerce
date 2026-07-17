import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Concrete variant of a `type=variant` Product.
 * `variantAttributeValues` contains only keys where the parent's ProductAttribute
 * has isVariantAxis=true.
 */
@GlobalEntity()
@Entity({ tableName: 'product_variants' })
export class ProductVariant {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'priceOverride' | 'stockLevel';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  parentProductId!: string;

  @Property({ type: 'string', length: 64 })
  @Unique()
  sku!: string;

  @Property({ type: 'json' })
  variantAttributeValues: Record<string, unknown> = {};

  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  priceOverride?: string | null;

  @Property({ type: 'integer', nullable: true })
  stockLevel?: number | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
