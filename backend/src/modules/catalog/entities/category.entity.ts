import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Category — hierarchical node in the catalog tree.
 * `parentCategoryId` is null for roots. `slug` is kebab-case; uniqueness is
 * enforced per-parent at the migration level.
 */
@GlobalEntity()
@Entity({ tableName: 'categories' })
export class Category {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'parentCategoryId'
    | 'sortOrder'
    | 'metaTitleOverride'
    | 'metaDescriptionOverride'
    | 'deletedAt'
    | 'inventoryThresholdHigh'
    | 'inventoryThresholdMedium'
    | 'inventoryThresholdLow'
    | 'mainImageAssetId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  parentCategoryId?: string | null;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'string', length: 160 })
  @Index()
  slug!: string;

  @Property({ type: 'integer' })
  sortOrder: number = 0;

  @Property({ type: 'json', nullable: true })
  metaTitleOverride?: Record<string, string> | null;

  @Property({ type: 'json', nullable: true })
  metaDescriptionOverride?: Record<string, string> | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  // Inventory module (feature 010) — display-band thresholds at the
  // category level. The threshold-resolver consults these BEFORE
  // falling back to the global `inventory_thresholds` row (FR-017).
  @Property({ type: 'integer', nullable: true })
  inventoryThresholdHigh?: number | null;

  @Property({ type: 'integer', nullable: true })
  inventoryThresholdMedium?: number | null;

  @Property({ type: 'integer', nullable: true })
  inventoryThresholdLow?: number | null;

  // Assets Library (feature 013 / US5) — Main Image asset reference
  // rendered on the storefront category landing page.
  @Property({ type: 'uuid', nullable: true })
  @Index()
  mainImageAssetId?: string | null;
}
