import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * AttributeSetAttribute — composite-PK bridge between AttributeSet and
 * ProductAttribute (feature 002, data-model.md §2.2).
 *
 * `position` controls the order attributes are surfaced to the admin
 * Product editor. Foreign-key cascades are owned by the migration:
 *   - On AttributeSet delete → CASCADE (assignments removed with the set).
 *   - On ProductAttribute delete → RESTRICT (attribute can't be deleted
 *     while still wired to any set; admin must un-assign first).
 *
 * Modeled as a standalone entity (not auto-pivot) so services can query
 * `position` directly and so seeds can reuse the standard EM-flush path.
 */
@Entity({ tableName: 'attribute_set_attributes' })
export class AttributeSetAttribute {
  [OptionalProps]?: 'position';

  @PrimaryKey({ type: 'uuid' })
  @Index({ name: 'attribute_set_attributes_set_id_index' })
  attributeSetId!: string;

  @PrimaryKey({ type: 'uuid' })
  @Index({ name: 'attribute_set_attributes_attribute_id_index' })
  productAttributeId!: string;

  @Property({ type: 'integer' })
  position: number = 0;
}
