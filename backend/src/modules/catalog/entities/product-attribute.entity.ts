import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * ProductAttribute — definition of a per-product property.
 *
 * `key` is snake_case; `label` is multilingual; `valueType` drives
 * validation of `Product.attributeValues[key]` and of
 * `ProductVariant.variantAttributeValues[key]` when isVariantAxis=true.
 *
 * **Feature 012 extensions** (this iteration):
 *   - `labelDefault` string: fallback used when the active locale is
 *     missing from the per-locale `label` JSONB.
 *   - `valueType` gains `'select'` (single-value rich option list, paired
 *     with the new `attribute_options` table). `'enum'` and `'select'`
 *     share storage; `'enum'` renders as a compact pill / segmented
 *     control, `'select'` as a full dropdown (research.md R-2).
 *   - `isRequired`: enforced at product save time when the attribute is
 *     in the product's currently-assigned Attribute Set.
 *   - `isPromoRule`: surfaces the attribute in the Promotion Rule
 *     criterion picker.
 *   - `filterPosition`: ascending sort order on the storefront filter
 *     sidebar; ties broken by resolved label.
 *   - `isVisibleOnProductPage`: gates inclusion in the storefront PDP
 *     "Parametry produktu" tab.
 *
 * The legacy `enumValues: string[]` JSONB column was dropped by
 * migration 032; option metadata for `'select'` / `'enum'` /
 * `'multiselect'` types lives on the new `attribute_options` table
 * (rich per-option metadata: value + per-locale label + isDefault +
 * sortOrder).
 *
 * Runtime toggles: isSearchable / isFilterable / isVariantAxis are mutable
 * by Admin Panel operators and trigger a search re-index. isComparable,
 * isPromoRule, and isVisibleOnProductPage are also mutable but do not
 * trigger any reindex.
 */
@Entity({ tableName: 'product_attributes' })
export class ProductAttribute {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'isSearchable'
    | 'isFilterable'
    | 'isVariantAxis'
    | 'displayAsSlider'
    | 'isComparable'
    | 'isRequired'
    | 'isPromoRule'
    | 'filterPosition'
    | 'isVisibleOnProductPage';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  key!: string;

  @Property({ type: 'json' })
  label!: Record<string, string>;

  /** Default fallback label used when the active locale is missing from `label`. */
  @Property({ type: 'string', length: 200 })
  labelDefault!: string;

  @Property({ type: 'string', length: 16 })
  valueType!:
    | 'string'
    | 'number'
    | 'boolean'
    | 'enum'
    | 'date'
    | 'multiselect'
    | 'price'
    | 'select';

  @Property({ type: 'boolean' })
  isSearchable: boolean = false;

  @Property({ type: 'boolean' })
  isFilterable: boolean = false;

  @Property({ type: 'boolean' })
  isVariantAxis: boolean = false;

  /** Honored only when `valueType ∈ ('number','price')`. */
  @Property({ type: 'boolean' })
  displayAsSlider: boolean = false;

  @Property({ type: 'boolean' })
  isComparable: boolean = false;

  /** FR-013 — enforced at product save time when the attribute is in the assigned set. */
  @Property({ type: 'boolean' })
  isRequired: boolean = false;

  /** FR-038 — surfaces the attribute in the Promotion Rule criterion picker. */
  @Property({ type: 'boolean' })
  isPromoRule: boolean = false;

  /** FR-027 — ascending sort order on the storefront filter sidebar. */
  @Property({ type: 'integer' })
  filterPosition: number = 0;

  /** FR-030 — gates inclusion in the storefront PDP "Parametry produktu" tab. */
  @Property({ type: 'boolean' })
  isVisibleOnProductPage: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
