import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
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
    | 'customFieldValues'
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'parentCategoryId'
    | 'sortOrder'
    | 'metaTitleOverride'
    | 'metaDescriptionOverride'
    | 'deletedAt'
    | 'isActive'
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

  // Feature 055 — Custom Fields Layer value bag (inherits host tenant scope).
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  // Feature 068 — activation switch. `false` hides the category from every
  // customer-facing read (tree, PLP narrowing, PDP projection, megamenu,
  // search index, sitemap, meta tags) while leaving it in the admin tree.
  // Orthogonal to `deletedAt` (removed) and to sales-channel membership.
  @Property({ type: 'boolean' })
  isActive: boolean = true;

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
