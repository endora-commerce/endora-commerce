import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldOptionDto,
  SupportedEntityType,
  UpdateCustomFieldDefinitionRequest,
} from '@b2b/contracts';
import { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../entities/custom-field-option.entity.js';
import { isSupportedEntityType } from './custom-field-registry.js';

/**
 * Transactional apply functions for custom-field definition/option writes
 * (feature 061, contracts/custom-fields-product-host.md §3).
 *
 * Every function runs entirely on the CALLER-provided EntityManager and
 * enforces the same invariants as the public CRUD (duplicate key, options
 * rule, entity type known, value-type lock via the probe binding,
 * option-in-use). They dispatch NO command, write NO audit entry, and publish
 * NO cache invalidation — a host command audits its composite operation and
 * calls `publishInvalidate` post-commit; the module's own definition commands
 * share these bodies so there is a single write path (Principle XIII).
 */

/** Typed failures the routes map to HTTP status codes. */
export class CustomFieldDefinitionError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'duplicate_key'
      | 'options_required'
      | 'options_forbidden'
      | 'entity_type_unknown'
      | 'value_type_locked'
      | 'option_in_use',
    message: string,
  ) {
    super(message);
    this.name = 'CustomFieldDefinitionError';
  }
}

const SELECT_TYPES = new Set(['select', 'multiselect']);

/**
 * Change-guard probes over the host's value storage (structurally satisfied by
 * `CustomFieldValueService`). Optional: when absent, the corresponding guard
 * is the caller's responsibility (e.g. a host running its own authoritative
 * in-use checks first — research §R9).
 */
export interface DefinitionChangeProbes {
  hasStoredValues(em: EntityManager, entityType: SupportedEntityType, key: string): Promise<boolean>;
  isOptionInUse(
    em: EntityManager,
    entityType: SupportedEntityType,
    key: string,
    optionValue: string,
  ): Promise<boolean>;
}

/** Select fields require ≥ 1 option; non-select fields must not carry any. */
export function assertOptionsRule(valueType: string, options: CustomFieldOptionDto[]): void {
  const isSelect = SELECT_TYPES.has(valueType);
  if (isSelect && options.length === 0) {
    throw new CustomFieldDefinitionError('options_required', 'Select fields require at least one option.');
  }
  if (!isSelect && options.length > 0) {
    throw new CustomFieldDefinitionError('options_forbidden', 'Only select fields may carry options.');
  }
}

/** Create a definition (+ its options for select types) on the caller's EM. */
export async function applyCreateDefinition(
  em: EntityManager,
  input: CreateCustomFieldDefinitionRequest,
): Promise<CustomFieldDefinition> {
  if (!isSupportedEntityType(input.entityType)) {
    throw new CustomFieldDefinitionError('entity_type_unknown', `Unknown entity type "${input.entityType}".`);
  }
  assertOptionsRule(input.valueType, input.options);
  const existing = await em.findOne(CustomFieldDefinition, {
    entityType: input.entityType,
    key: input.key,
  });
  if (existing) {
    throw new CustomFieldDefinitionError(
      'duplicate_key',
      `A field "${input.key}" already exists on ${input.entityType}.`,
    );
  }
  const def = em.create(CustomFieldDefinition, {
    entityType: input.entityType,
    key: input.key,
    label: input.label,
    labelDefault: input.labelDefault,
    valueType: input.valueType,
    required: input.required,
    sortOrder: input.sortOrder,
    config: input.config,
  });
  if (SELECT_TYPES.has(input.valueType)) {
    // Flush the definition first: options reference it by id (no ORM relation),
    // so MikroORM cannot infer the insert order and would violate the FK.
    await em.flush();
    for (const opt of input.options) createOptionEntity(em, def.id, opt);
  }
  return def;
}

/** Patch a definition's scalar/label/config fields on the caller's EM. */
export async function applyUpdateDefinition(
  em: EntityManager,
  id: string,
  patch: UpdateCustomFieldDefinitionRequest,
  probes?: DefinitionChangeProbes,
): Promise<CustomFieldDefinition> {
  const def = await em.findOne(CustomFieldDefinition, { id });
  if (!def) throw new CustomFieldDefinitionError('not_found', `Custom field ${id} not found.`);
  // FR-010: changing valueType while values exist is rejected (probe binding).
  if (patch.valueType !== undefined && patch.valueType !== def.valueType && probes) {
    const inUse = await probes.hasStoredValues(em, def.entityType, def.key);
    if (inUse) {
      throw new CustomFieldDefinitionError(
        'value_type_locked',
        `Cannot change the value type of "${def.key}" while records hold values. Clear them first.`,
      );
    }
  }
  if (patch.label !== undefined) def.label = patch.label;
  if (patch.labelDefault !== undefined) def.labelDefault = patch.labelDefault;
  if (patch.valueType !== undefined) def.valueType = patch.valueType;
  if (patch.required !== undefined) def.required = patch.required;
  if (patch.sortOrder !== undefined) def.sortOrder = patch.sortOrder;
  if (patch.config !== undefined) def.config = patch.config;
  return def;
}

/** Delete a definition on the caller's EM. Options cascade; host values stay dormant (FR-010). */
export async function applyDeleteDefinition(em: EntityManager, id: string): Promise<CustomFieldDefinition> {
  const def = await em.findOne(CustomFieldDefinition, { id });
  if (!def) throw new CustomFieldDefinitionError('not_found', `Custom field ${id} not found.`);
  const options = await em.find(CustomFieldOption, { definitionId: id });
  for (const o of options) em.remove(o);
  em.remove(def);
  return def;
}

/** Add one option to a select/multiselect definition on the caller's EM. */
export async function applyCreateOption(
  em: EntityManager,
  definitionId: string,
  input: CustomFieldOptionDto,
): Promise<CustomFieldOption> {
  const def = await em.findOne(CustomFieldDefinition, { id: definitionId });
  if (!def) throw new CustomFieldDefinitionError('not_found', `Custom field ${definitionId} not found.`);
  if (!SELECT_TYPES.has(def.valueType)) {
    throw new CustomFieldDefinitionError('options_forbidden', `Field "${def.key}" does not take options.`);
  }
  return createOptionEntity(em, definitionId, input);
}

/** Patch one option's label/default/ordering on the caller's EM. */
export async function applyUpdateOption(
  em: EntityManager,
  definitionId: string,
  optionId: string,
  patch: Partial<Pick<CustomFieldOptionDto, 'label' | 'labelDefault' | 'isDefault' | 'sortOrder'>>,
): Promise<CustomFieldOption> {
  const option = await em.findOne(CustomFieldOption, { id: optionId });
  if (!option || option.definitionId !== definitionId) {
    throw new CustomFieldDefinitionError('not_found', `Option ${optionId} not found.`);
  }
  if (patch.label !== undefined) option.label = patch.label;
  if (patch.labelDefault !== undefined) option.labelDefault = patch.labelDefault;
  if (patch.isDefault !== undefined) option.isDefault = patch.isDefault;
  if (patch.sortOrder !== undefined) option.sortOrder = patch.sortOrder;
  return option;
}

/** Delete one option on the caller's EM (in-use guard via the probe binding). */
export async function applyDeleteOption(
  em: EntityManager,
  definitionId: string,
  optionId: string,
  probes?: DefinitionChangeProbes,
): Promise<CustomFieldOption> {
  const def = await em.findOne(CustomFieldDefinition, { id: definitionId });
  if (!def) throw new CustomFieldDefinitionError('not_found', `Custom field ${definitionId} not found.`);
  const option = await em.findOne(CustomFieldOption, { id: optionId });
  if (!option || option.definitionId !== definitionId) {
    throw new CustomFieldDefinitionError('not_found', `Option ${optionId} not found.`);
  }
  // FR-010: an in-use option cannot be removed while records reference it.
  if (probes) {
    const inUse = await probes.isOptionInUse(em, def.entityType, def.key, option.value);
    if (inUse) {
      throw new CustomFieldDefinitionError(
        'option_in_use',
        `Option "${option.value}" is in use and cannot be removed.`,
      );
    }
  }
  em.remove(option);
  return option;
}

function createOptionEntity(
  em: EntityManager,
  definitionId: string,
  input: CustomFieldOptionDto,
): CustomFieldOption {
  return em.create(CustomFieldOption, {
    definitionId,
    value: input.value,
    label: input.label,
    labelDefault: input.labelDefault,
    isDefault: input.isDefault,
    sortOrder: input.sortOrder,
  });
}
