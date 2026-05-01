import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * ProductAttribute — definition of a per-product property (FR-004 +
 * feature 002 extensions per data-model.md §1.2).
 *
 * `key` is snake_case; `label` is multilingual; `valueType` drives
 * validation of `Product.attributeValues[key]` and of
 * `ProductVariant.variantAttributeValues[key]` when isVariantAxis=true.
 *
 * **Feature 002 extensions**:
 *   - `valueType` enum gains `'multiselect'` and `'price'`. Foundation
 *     001 stored only `'string' | 'number' | 'boolean' | 'enum' | 'date'`;
 *     the API surface in `packages/contracts/catalog.ts` exposes
 *     `'multiselect'` and `'price'` as first-class types now.
 *   - `displayAsSlider` boolean: presentation hint. Honored only when
 *     `valueType ∈ ('number','price')`; the service/Zod layers reject
 *     `displayAsSlider=true` on any other type with
 *     `INVALID_DISPLAY_AS_SLIDER` (research.md R-4).
 *
 * **Feature 007 extension**:
 *   - `isComparable` boolean (default false): selects which attributes
 *     appear as body rows on the Compare module's comparison page.
 *     Owned by catalog (research.md R-5 of feature 007); read by the
 *     comparisons module via `CatalogQueryService.comparableAttributeKeys()`.
 *     Toggling has NO side effect — unlike `isSearchable`, no event is
 *     emitted because comparability is read at render time.
 *
 * Runtime toggles: isSearchable / isFilterable / isVariantAxis are mutable
 * by Admin Panel operators and trigger a search re-index (SC-006).
 * isComparable is also mutable but does not trigger any reindex.
 */
@Entity({ tableName: 'product_attributes' })
export class ProductAttribute {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'enumValues'
    | 'isSearchable'
    | 'isFilterable'
    | 'isVariantAxis'
    | 'displayAsSlider'
    | 'isComparable';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  key!: string;

  @Property({ type: 'json' })
  label!: Record<string, string>;

  @Property({ type: 'string', length: 16 })
  valueType!:
    | 'string'
    | 'number'
    | 'boolean'
    | 'enum'
    | 'date'
    | 'multiselect'
    | 'price';

  @Property({ type: 'json', nullable: true })
  enumValues?: string[] | null;

  @Property({ type: 'boolean' })
  isSearchable: boolean = false;

  @Property({ type: 'boolean' })
  isFilterable: boolean = false;

  @Property({ type: 'boolean' })
  isVariantAxis: boolean = false;

  /**
   * Honored only when `valueType ∈ ('number','price')`. See research.md R-4.
   */
  @Property({ type: 'boolean' })
  displayAsSlider: boolean = false;

  /**
   * Feature 007 — selects which attributes appear as body rows on the
   * Compare module's comparison page. Independent of isSearchable /
   * isFilterable. No side effects on flip; consumed via
   * `CatalogQueryService.comparableAttributeKeys()`.
   */
  @Property({ type: 'boolean' })
  isComparable: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
