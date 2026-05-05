import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * AttributeOption — one selectable value for a `select` / `enum` /
 * `multiselect` attribute (feature 012 / FR-021..FR-026).
 *
 * Carries a stable per-attribute `value` (used in product data + filter
 * URLs), per-locale label map with a default fallback, and an optional
 * `isDefault` flag that pre-selects the option on a new product.
 *
 * Unique on `(attributeId, value)` so the option list is a clean set
 * within each attribute. Sort order on `(attributeId, sortOrder)`
 * supports the editor's manual reordering.
 *
 * Owned by the catalog module (research.md R-1). Cascade-deleted with
 * the parent attribute via FK ON DELETE CASCADE — but the attribute
 * service refuses to delete an attribute while any product still
 * carries one of its option values (FR-006, FR-025).
 */
@Entity({ tableName: 'attribute_options' })
@Unique({ properties: ['attributeId', 'value'] })
export class AttributeOption {
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
  attributeId!: string;

  @Property({ type: 'string', length: 200 })
  value!: string;

  /** Per-locale label map (BCP-47-keyed). Empty `{}` is allowed when the operator only filled `labelDefault`. */
  @Property({ type: 'json' })
  label: Record<string, string> = {};

  @Property({ type: 'string', length: 200 })
  labelDefault!: string;

  /** Optional pre-selection on a new product. Service layer enforces at-most-one for `select` / `enum`. */
  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  sortOrder: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
