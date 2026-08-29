import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ProductAttribute — the catalog EXTENSION of a product-host Custom Field
 * definition (feature 061, data-model.md §1.3).
 *
 * The generic identity (key, per-locale label, labelDefault, value type,
 * required flag) lives on `custom_field_definitions` (`entity_type='product'`,
 * owned by the custom_fields module). This row carries ONLY the
 * catalog-interpreted behavior surface:
 *
 *   - the 12 catalog capability flags (search / filter / variant axis /
 *     compare / quick order / promo rule / PDP visibility / scoping / bulk
 *     edit) — typed, indexed, SQL-filterable;
 *   - two presentation refinements that specialize the generic value type
 *     bijectively (research §R7): `selectDisplay` ('pill' = legacy `enum`,
 *     'dropdown' = legacy `select`) and `numericKind` ('number' | 'price').
 *
 * Invariant (total 1:1): every `entity_type='product'` definition has exactly
 * one extension row — created/deleted together inside one catalog Command
 * (research §R4). Enforced by the UNIQUE FK (ON DELETE RESTRICT at the DB
 * level) + the single write surface.
 *
 * The row `id` is stable across the 061 migration, so the admin API keeps
 * exposing the same attribute ids. All reads compose through
 * `CatalogAttributeReadService` (contracts/catalog-attribute-view.md).
 */
@GlobalEntity()
@Entity({ tableName: 'product_attributes' })
export class ProductAttribute {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'selectDisplay'
    | 'numericKind'
    | 'isSearchable'
    | 'isFilterable'
    | 'isVariantAxis'
    | 'displayAsSlider'
    | 'isComparable'
    | 'isPromoRule'
    | 'filterPosition'
    | 'isVisibleOnProductPage'
    | 'channelScoped'
    | 'languageScoped'
    | 'massEditable'
    | 'quickSearchable';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** Backing product-host definition (custom_field_definitions.id, FK RESTRICT). */
  @Property({ type: 'uuid' })
  @Unique()
  customFieldDefinitionId!: string;

  /**
   * Presentation refinement for cf `select` definitions:
   * `'pill'` renders the legacy `enum` compact pill, `'dropdown'` the legacy
   * `select` full dropdown. NULL for non-select value types.
   */
  @Property({ type: 'string', length: 16, nullable: true })
  selectDisplay: 'pill' | 'dropdown' | null = null;

  /**
   * Refinement for cf `number` definitions: `'price'` restores the legacy
   * `price` semantics, `'number'` the plain numeric. NULL for non-numeric types.
   */
  @Property({ type: 'string', length: 8, nullable: true })
  numericKind: 'number' | 'price' | null = null;

  @Property({ type: 'boolean' })
  isSearchable: boolean = false;

  @Property({ type: 'boolean' })
  isFilterable: boolean = false;

  @Property({ type: 'boolean' })
  isVariantAxis: boolean = false;

  /** Honored only when the derived legacy value type is `number`/`price`. */
  @Property({ type: 'boolean' })
  displayAsSlider: boolean = false;

  @Property({ type: 'boolean' })
  isComparable: boolean = false;

  /** Feature 039 — values participate in Quick Order search (independent of isSearchable). */
  @Property({ type: 'boolean' })
  quickSearchable: boolean = false;

  /** FR-038 — surfaces the attribute in the Promotion Rule criterion picker. */
  @Property({ type: 'boolean' })
  isPromoRule: boolean = false;

  /** FR-027 — ascending sort order on the storefront filter sidebar. */
  @Property({ type: 'integer' })
  filterPosition: number = 0;

  /** FR-030 — gates inclusion in the storefront PDP "Parametry produktu" tab. */
  @Property({ type: 'boolean' })
  isVisibleOnProductPage: boolean = false;

  /**
   * Feature 023 — when `true`, the attribute MAY carry per-Sales-Channel
   * overrides (stored in `product_value_overrides`).
   */
  @Property({ type: 'boolean' })
  channelScoped: boolean = false;

  /**
   * Feature 023 — when `true`, the attribute's value is keyed by language at
   * every slot (`Record<lang, value>` in `products.attribute_values`).
   */
  @Property({ type: 'boolean' })
  languageScoped: boolean = false;

  /** Feature 022 — surfaces the attribute in the Products Bulk Edit dialog. */
  @Property({ type: 'boolean' })
  massEditable: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
