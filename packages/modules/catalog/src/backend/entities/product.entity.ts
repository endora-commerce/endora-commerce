import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Product — the central catalog object. Supports four `type`s (FR-002).
 * Soft-deleted via `deletedAt` (data-model.md cross-cutting section); inactive
 * products still resolve from historical Orders, Invoices, RFQs, Shopping Lists
 * but are excluded from search/filters.
 *
 * Multilingual fields (`name`, `description`) are stored as JSONB per
 * data-model.md; `attributeValues` is a JSONB keyed by ProductAttribute.key.
 */
@GlobalEntity()
@Entity({ tableName: 'products' })
export class Product {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'stockMode'
    | 'deletedAt'
    | 'archivedAt'
    | 'allowedOrganizationIds'
    | 'attributeSetId'
    | 'downloadAssetId'
    | 'downloadUrl'
    | 'manageStock'
    | 'backorderEnabled'
    | 'lowStockThreshold'
    | 'lowStockThresholdMode'
    | 'fulfilmentStrategy'
    | 'fulfilmentStrategyWarehouseOrder';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 255 })
  @Unique()
  sku!: string;

  @Property({ type: 'string', length: 160 })
  @Index()
  @Unique()
  slug!: string;

  @Property({ type: 'string', length: 16 })
  type!: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'draft' | 'active' | 'inactive' = 'draft';

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'json' })
  description!: Record<string, string>;

  /** Per-product override of global stock mode (categorical/numeric/null=inherit). */
  @Property({ type: 'string', length: 16, nullable: true })
  stockMode?: 'categorical' | 'numeric' | null;

  @Property({ type: 'string', length: 32 })
  visibility: 'public' | 'logged_in_only' | 'organization_restricted' = 'public';

  /** JSONB `{ attributeKey: value }` validated against ProductAttribute definitions. */
  @Property({ type: 'json' })
  attributeValues: Record<string, unknown> = {};

  /**
   * The organisations allowed to see this product — **this column is the
   * storage**, not a cache of one. There is no bridge table: the comment that
   * stood here until issue #227 named a `product_allowed_organizations` M:N
   * source of truth that no migration has ever created and no query has ever
   * read, which is worse than stale — it invites a writer to treat this column
   * as rebuildable from a table that is not there.
   *
   * `products.allowed_organization_ids` is `jsonb not null default '[]'::jsonb`
   * (`db/migrations/20260424T165847_core_foundation_init.ts`), and a read path
   * that enforces it asks with `@>` containment over the array — the buyer's
   * organisation id has to be *in* it, rather than the array being compared to
   * anything.
   *
   * Two states an enforcing read must not conflate:
   *
   *  - **empty array** — no organisation restriction. Disclosure is then
   *    `visibility`'s alone.
   *  - **empty array with `visibility = 'organization_restricted'`** — visible
   *    to nobody. The restriction was asked for and names no organisation; the
   *    permissive reading of it would disclose the row to everybody, which is
   *    the opposite of what the operator saved.
   *
   * A non-empty array restricts whatever `visibility` says, `public` included.
   * Enforcement is per read path and not every path applies it today; the
   * `CatalogQuickSearchPort` doc block in `@endora-commerce/contracts` states the predicate
   * for the path that does.
   *
   * No foreign key holds these ids, so a deleted organisation leaves its id in
   * every product that named it. That question — whether the relationship the
   * old comment imagined should exist — is issue #227's second half and is not
   * settled here.
   */
  @Property({ type: 'json' })
  allowedOrganizationIds: string[] = [];

  /**
   * Attribute Set the Product is wired to (feature 002, data-model.md §1.1).
   * Backfilled by the attribute-sets init migration to the system Default
   * set; never null.
   * Validation of `attributeValues` is performed against this set's
   * attributes by `catalog-admin.service.ts` (T023).
   *
   * Default value matches
   * `Migration20260429T064146CatalogAttributeSetsInit.DEFAULT_ATTRIBUTE_SET_ID`
   * — the deterministic UUID of the system Default set. Inlined here as a
   * literal so the entity has zero migration-package dependencies.
   */
  @Property({ type: 'uuid' })
  attributeSetId: string = 'defa0017-0000-4000-8000-000000000000';

  /**
   * Feature 002 — virtual product download fields (data-model.md §1.1).
   * Exactly one MUST be set when type='virtual'; both MUST be null
   * otherwise. Cross-field rule enforced at the service layer (T047).
   */
  @Property({ type: 'uuid', nullable: true })
  downloadAssetId?: string | null;

  @Property({ type: 'string', length: 2048, nullable: true })
  downloadUrl?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  @Index()
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  @Index()
  archivedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  // ----------------------------------------------------------------
  // Inventory module (feature 010) — per-product stock-management flags
  // ----------------------------------------------------------------

  /** When false, the storefront always shows the product as available
   *  and the cart accepts any quantity (FR-022). */
  @Property({ type: 'boolean' })
  manageStock: boolean = true;

  /** When true, the storefront accepts zero-stock checkout and the
   *  resulting allocation is flagged `is_backorder` (FR-023). */
  @Property({ type: 'boolean' })
  backorderEnabled: boolean = false;

  /** Optional integer; when null the product is exempt from
   *  low-stock alerts (FR-013). Used in `cumulative` mode against the
   *  product's total on-hand across all warehouses. */
  @Property({ type: 'integer', nullable: true })
  lowStockThreshold?: number | null;

  /**
   * Determines how `lowStockThreshold` is interpreted:
   *  - `cumulative` (default): one threshold applied to the cumulative
   *    on-hand across every warehouse holding stock for the product.
   *  - `per_warehouse`: the per-(product, warehouse) rows in
   *    `product_warehouse_low_stock_thresholds` are consulted instead,
   *    each warehouse evaluated independently against its own threshold.
   */
  @Property({ type: 'string', length: 16 })
  lowStockThresholdMode: 'cumulative' | 'per_warehouse' = 'cumulative';

  /** Per-product override of the global fulfilment strategy (FR-030). */
  @Property({ type: 'string', length: 32, nullable: true })
  fulfilmentStrategy?:
    | 'any'
    | 'default_first'
    | 'lowest_stock_first'
    | 'highest_stock_first'
    | 'defined_order'
    | null;

  /** When `fulfilment_strategy = 'defined_order'`, the ordered list
   *  of warehouse UUIDs to walk. */
  @Property({ type: 'json', nullable: true })
  fulfilmentStrategyWarehouseOrder?: string[] | null;
}
