import type {
  CustomFieldDefinitionReadPort,
  CustomFieldDefinitionRecord,
  CustomFieldDefinitionWithOptions,
  CustomFieldOptionRecord,
  SupportedEntityType,
} from '@endora-commerce/contracts';
import type { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import type { CustomFieldOption } from '../entities/custom-field-option.entity.js';
import type { CachedDefinition } from './custom-field-definitions-cache.js';
import type { DefinitionSource } from './custom-field-value.service.js';

/**
 * What the read port needs beyond {@link DefinitionSource}: the cache-bypassing
 * read D-97.1 publishes. `CustomFieldDefinitionService` satisfies both; the
 * interface stays here so this adapter has no concrete dependency on it.
 */
export interface FreshDefinitionSource extends DefinitionSource {
  listForEntityFresh(entityType: SupportedEntityType): Promise<CachedDefinition[]>;
}

/**
 * The published face of `custom_fields`' definition read model (feature 075,
 * Phase P).
 *
 * `DefinitionSource` already had the right *shape* — one question, taken as an
 * interface so the value service has no concrete dependency on the definition
 * service. What it did not have was a published one: `CachedDefinition` holds
 * the two ORM entities, so a consumer typing itself against it imports both
 * classes, which is what seven modules do today.
 *
 * The mapping is per definition rather than per read: the underlying call
 * rides the per-entity in-process cache, so the entities are already in
 * memory, and copying twenty fields off them costs nothing measurable against
 * the query it replaces in each consumer.
 */
export class CustomFieldDefinitionReadService implements CustomFieldDefinitionReadPort {
  constructor(private readonly source: FreshDefinitionSource) {}

  async listForEntity(
    entityType: SupportedEntityType,
  ): Promise<CustomFieldDefinitionWithOptions[]> {
    return (await this.source.listForEntity(entityType)).map(toDefinitionWithOptions);
  }

  /**
   * D-97.1 — the freshness guarantee, expressed as a read.
   *
   * The cache, its local drop and its cross-process fan-out never leave this
   * module: a consumer asks for definitions it can trust, not for somebody
   * else's cache to be flushed.
   */
  async listForEntityFresh(
    entityType: SupportedEntityType,
  ): Promise<CustomFieldDefinitionWithOptions[]> {
    return (await this.source.listForEntityFresh(entityType)).map(toDefinitionWithOptions);
  }
}

export function toDefinitionWithOptions(
  cached: CachedDefinition,
): CustomFieldDefinitionWithOptions {
  return {
    definition: toCustomFieldDefinitionRecord(cached.definition),
    options: cached.options.map(toCustomFieldOptionRecord),
  };
}

export function toCustomFieldDefinitionRecord(
  definition: CustomFieldDefinition,
): CustomFieldDefinitionRecord {
  return {
    id: definition.id,
    entityType: definition.entityType,
    key: definition.key,
    label: definition.label ?? {},
    labelDefault: definition.labelDefault,
    valueType: definition.valueType,
    required: definition.required,
    sortOrder: definition.sortOrder,
    config: definition.config ?? {},
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

export function toCustomFieldOptionRecord(option: CustomFieldOption): CustomFieldOptionRecord {
  return {
    id: option.id,
    definitionId: option.definitionId,
    value: option.value,
    label: option.label ?? {},
    labelDefault: option.labelDefault,
    isDefault: option.isDefault,
    sortOrder: option.sortOrder,
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
  };
}
