import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * ProductAttribute — definition of a per-product property (FR-004).
 * `key` is snake_case; `label` is multilingual; `valueType` drives validation of
 * `Product.attributeValues[key]` and of `ProductVariant.variantAttributeValues[key]`
 * when isVariantAxis=true.
 *
 * Runtime toggles: isSearchable / isFilterable / isVariantAxis are mutable by
 * Admin Panel operators and trigger a search re-index (SC-006).
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
    | 'isVariantAxis';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  key!: string;

  @Property({ type: 'json' })
  label!: Record<string, string>;

  @Property({ type: 'string', length: 16 })
  valueType!: 'string' | 'number' | 'boolean' | 'enum' | 'date';

  @Property({ type: 'json', nullable: true })
  enumValues?: string[] | null;

  @Property({ type: 'boolean' })
  isSearchable: boolean = false;

  @Property({ type: 'boolean' })
  isFilterable: boolean = false;

  @Property({ type: 'boolean' })
  isVariantAxis: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
