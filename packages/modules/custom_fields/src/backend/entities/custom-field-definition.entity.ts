import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { CustomFieldValueType, SupportedEntityType } from '@endora-commerce/contracts';

/**
 * CustomFieldDefinition — an operator-defined field for one host entity type
 * (feature 055, FR-001/FR-002).
 *
 * Entity-agnostic by construction (FR-006): it carries a `key`, a per-locale
 * `label` + `labelDefault`, a `valueType`, a `required` flag, ordering, and an
 * opaque `config` JSONB for host-capability opt-in that the generic core stores
 * but never interprets. It deliberately omits the catalog-only capability flags
 * that made the product-attribute registry un-reusable — those stay behind host
 * extension points. Platform-global (`@GlobalEntity`), like the product-attribute
 * registry; the VALUES live on the host row's JSONB column and inherit that
 * host's tenant scope.
 *
 * Unique on `(entity_type, key)` so a key is a clean identifier within an
 * entity type. Options for `select` / `multiselect` live on
 * `custom_field_options` (FK ON DELETE CASCADE).
 */
@GlobalEntity()
@Entity({ tableName: 'custom_field_definitions' })
@Unique({ properties: ['entityType', 'key'] })
export class CustomFieldDefinition {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'required'
    | 'sortOrder'
    | 'label'
    | 'config';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 32 })
  @Index()
  entityType!: SupportedEntityType;

  @Property({ type: 'string', length: 64 })
  key!: string;

  /** Per-locale label map (BCP-47-keyed). Empty `{}` is allowed when only `labelDefault` is filled. */
  @Property({ type: 'json' })
  label: Record<string, string> = {};

  /** Fallback label used when the active locale is missing from `label` (US1 scenario 4). */
  @Property({ type: 'string', length: 200 })
  labelDefault!: string;

  @Property({ type: 'string', length: 16 })
  valueType!: CustomFieldValueType;

  @Property({ type: 'boolean' })
  required: boolean = false;

  @Property({ type: 'integer' })
  sortOrder: number = 0;

  /** Opaque host-capability flags (FR-006). The core stores but never reads this for meaning. */
  @Property({ type: 'json' })
  config: Record<string, unknown> = {};

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
