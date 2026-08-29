import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * AttributeSetAttribute — composite-PK bridge between AttributeSet and the
 * product-host Custom Field definitions (feature 002, re-keyed by feature 061).
 *
 * Membership is stored by `custom_field_definition_id` (data-model.md §1.4);
 * the admin API keeps accepting/returning attribute (extension) ids — the
 * AttributeSetService maps extension id ⇄ definition id at the API boundary.
 *
 * `position` controls the order attributes are surfaced to the admin Product
 * editor. Foreign-key cascades are owned by migration 102:
 *   - On AttributeSet delete → CASCADE (assignments removed with the set).
 *   - On definition delete → RESTRICT (the catalog delete command refuses
 *     while the attribute is still wired to any set; admin must un-assign
 *     first — same semantics as the pre-061 attribute RESTRICT).
 *
 * Modeled as a standalone entity (not auto-pivot) so services can query
 * `position` directly and so seeds can reuse the standard EM-flush path.
 */
@GlobalEntity()
@Entity({ tableName: 'attribute_set_attributes' })
export class AttributeSetAttribute {
  [OptionalProps]?: 'position';

  @PrimaryKey({ type: 'uuid' })
  @Index({ name: 'attribute_set_attributes_set_id_index' })
  attributeSetId!: string;

  @PrimaryKey({ type: 'uuid' })
  @Index({ name: 'attribute_set_attributes_definition_id_index' })
  customFieldDefinitionId!: string;

  @Property({ type: 'integer' })
  position: number = 0;
}
