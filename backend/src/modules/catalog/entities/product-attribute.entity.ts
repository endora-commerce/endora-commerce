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
 * Runtime toggles: isSearchable / isFilterable / isVariantAxis are mutable
 * by Admin Panel operators and trigger a search re-index (SC-006).
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
    | 'displayAsSlider';

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

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
