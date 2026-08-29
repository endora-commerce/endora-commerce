import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * CustomFieldOption — one selectable value for a `select` / `multiselect`
 * custom-field definition (feature 055, FR-002). Shape lifted from the catalog
 * `AttributeOption`: stable `value`, per-locale label + default fallback,
 * `isDefault`, `sortOrder`.
 *
 * Unique on `(definitionId, value)`. FK-by-id to `custom_field_definitions`
 * with ON DELETE CASCADE (enforced at migration level, mirroring
 * `attribute_options`). Platform-global (`@GlobalEntity`).
 */
@GlobalEntity()
@Entity({ tableName: 'custom_field_options' })
@Unique({ properties: ['definitionId', 'value'] })
export class CustomFieldOption {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'isDefault'
    | 'sortOrder'
    | 'label';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  definitionId!: string;

  @Property({ type: 'string', length: 200 })
  value!: string;

  /** Per-locale label map (BCP-47-keyed). Empty `{}` is allowed when only `labelDefault` is filled. */
  @Property({ type: 'json' })
  label: Record<string, string> = {};

  @Property({ type: 'string', length: 200 })
  labelDefault!: string;

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  sortOrder: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
