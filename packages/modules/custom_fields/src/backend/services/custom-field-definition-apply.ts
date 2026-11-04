import type { EntityManager } from '@mikro-orm/postgresql';
import {
  assessCustomFieldCarry,
  customFieldDefinitionSchema,
  type CustomFieldAudience,
  type CustomFieldOptionDto,
  type CustomFieldValueType,
  type SupportedEntityType,
  type UpdateCustomFieldDefinitionRequest,
} from '@endora-commerce/contracts';
import { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../entities/custom-field-option.entity.js';
import type { CustomFieldDefinitionApplyCreateInput } from '../../ports/index.js';
import {
  carryTargetsOf,
  isEntityTypeServed,
  isSupportedEntityType,
  offersListFilter,
  offersPageBuilderValues,
} from './custom-field-registry.js';

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
      | 'stored_values_exist'
      | 'option_in_use'
      | 'key_changed'
      | 'invalid_key'
      | 'list_filter_unsupported'
      | 'carry_incompatible'
      | 'value_type_unsupported',
    message: string,
    /**
     * What a refusal's sentence names (feature 157): the field `key`, an
     * option's `value` and `label`. A carry refusal (feature 162) adds its
     * reason token as `code` and the missing option values as a list.
     */
    readonly details?: Readonly<Record<string, string | readonly string[]>>,
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

/**
 * `listFilter: true` only where the entity type's registry entry offers the
 * option (feature 157); `false` and absence are always accepted.
 */
export function assertListFilterSupported(entityType: string, listFilter: boolean | undefined): void {
  if (listFilter === true && !offersListFilter(entityType)) {
    throw new CustomFieldDefinitionError(
      'list_filter_unsupported',
      `Fields of entity type "${entityType}" cannot be used as list filters.`,
    );
  }
}

/**
 * `page_builder` only where the entity type's registry entry offers it
 * (feature 172, research R-5): a Page Builder document is stored by its host,
 * so a type whose host stores none must not accept a definition of it.
 */
export function assertValueTypeOffered(entityType: string, valueType: string): void {
  if (valueType === 'page_builder' && !offersPageBuilderValues(entityType)) {
    throw new CustomFieldDefinitionError(
      'value_type_unsupported',
      `Fields of entity type "${entityType}" cannot hold Page Builder content.`,
      { valueType },
    );
  }
}

/**
 * A definition's value type never moves to or from `page_builder` (feature
 * 172, FR-005), whatever the stored values: a document and a field value are
 * not convertible into each other.
 */
export function assertValueTypeChangeAllowed(key: string, from: string, to: string | undefined): void {
  if (to === undefined || to === from) return;
  if (from === 'page_builder' || to === 'page_builder') {
    throw new CustomFieldDefinitionError(
      'value_type_locked',
      `The value type of "${key}" cannot be changed to or from Page Builder content.`,
      { key },
    );
  }
}

/** One definition as a carry judgement reads it (feature 162). */
export interface CarrySourceDefinition {
  readonly entityType: SupportedEntityType;
  readonly key: string;
  readonly valueType: CustomFieldValueType;
  readonly audience: CustomFieldAudience;
  readonly options: ReadonlyArray<{ value: string }>;
}

function carryRefusal(
  source: CarrySourceDefinition,
  target: SupportedEntityType,
  token: string,
  message: string,
  extra: Record<string, string | readonly string[]> = {},
): CustomFieldDefinitionError {
  return new CustomFieldDefinitionError('carry_incompatible', message, {
    code: token,
    targetEntityType: target,
    key: source.key,
    ...extra,
  });
}

/**
 * Judge the carry targets a definition write **adds** (feature 162, research
 * R-4), on the Command's own transaction. Each must be offered by the source
 * type's registry entry (`pair_unsupported`), have its owner module present
 * (`target_unavailable`), and pass {@link assessCustomFieldCarry} against the
 * same-key definition of the target type; the first reason refuses the write
 * with `carry_incompatible`. A target already on is never passed here: a
 * drifted carry stays as configured (FR-019).
 */
export async function assertCarryTargetsAccepted(
  em: EntityManager,
  source: CarrySourceDefinition,
  added: readonly SupportedEntityType[],
): Promise<void> {
  const offered = carryTargetsOf(source.entityType);
  for (const target of added) {
    if (!offered.includes(target)) {
      throw carryRefusal(
        source,
        target,
        'pair_unsupported',
        `Values of "${source.key}" cannot be carried to ${target}.`,
      );
    }
    if (!isEntityTypeServed(target)) {
      throw carryRefusal(
        source,
        target,
        'target_unavailable',
        `${target} is switched off, so values cannot be carried to it.`,
      );
    }
    const targetDefinition = await em.findOne(CustomFieldDefinition, { entityType: target, key: source.key });
    const targetOptions = targetDefinition
      ? await em.find(CustomFieldOption, { definitionId: targetDefinition.id })
      : [];
    const [first] = assessCustomFieldCarry(
      { valueType: source.valueType, audience: source.audience, options: source.options },
      targetDefinition
        ? { valueType: targetDefinition.valueType, audience: targetDefinition.audience, options: targetOptions }
        : null,
    );
    if (first === undefined) continue;
    switch (first.reason) {
      case 'target_missing':
        throw carryRefusal(
          source,
          target,
          first.reason,
          `No field with the key "${source.key}" exists on ${target}.`,
        );
      case 'value_type_mismatch':
        throw carryRefusal(
          source,
          target,
          first.reason,
          `The field "${source.key}" on ${target} is ${first.targetValueType}, but this field is ${first.sourceValueType}.`,
          { sourceValueType: first.sourceValueType, targetValueType: first.targetValueType },
        );
      case 'options_missing':
        throw carryRefusal(
          source,
          target,
          first.reason,
          `The field "${source.key}" on ${target} lacks these options: ${first.missingOptionValues.join(', ')}.`,
          {
            missingOptionValues: first.missingOptionValues.join(', '),
            missingOptionValueList: [...first.missingOptionValues],
          },
        );
      case 'audience_mismatch':
        throw carryRefusal(
          source,
          target,
          first.reason,
          `The field "${source.key}" on ${target} is visible to customers, but this field is internal.`,
        );
    }
  }
}

/**
 * The apply seam's own floor for `carryTo` (feature 162): a host writing
 * through it may name only the pairs its type's registry entry offers. The
 * compatibility judgement is the definition Commands' (above); a host-managed
 * type offers no pair, so this refuses any carry a host names.
 */
function assertCarryPairsOffered(
  entityType: string,
  key: string,
  carryTo: readonly SupportedEntityType[] | undefined,
): void {
  const offered = carryTargetsOf(entityType);
  const unsupported = (carryTo ?? []).find((target) => !offered.includes(target));
  if (unsupported !== undefined) {
    throw new CustomFieldDefinitionError(
      'carry_incompatible',
      `Values of "${key}" cannot be carried to ${unsupported}.`,
      { code: 'pair_unsupported', targetEntityType: unsupported, key },
    );
  }
}

/** Create a definition (+ its options for select types) on the caller's EM. */
export async function applyCreateDefinition(
  em: EntityManager,
  input: CustomFieldDefinitionApplyCreateInput,
): Promise<CustomFieldDefinition> {
  // command-coverage-ignore: apply-seam primitive — mutates on the invoking Command's
  // transactional EM; the caller (custom_fields definition command or a host command,
  // e.g. catalog.attribute.*) records the single audit row co-transactionally.
  // Contract: specs/061-attributes-on-custom-fields/contracts/custom-fields-product-host.md.
  if (!isSupportedEntityType(input.entityType)) {
    throw new CustomFieldDefinitionError('entity_type_unknown', `Unknown entity type "${input.entityType}".`);
  }
  assertValueTypeOffered(input.entityType, input.valueType);
  assertOptionsRule(input.valueType, input.options);
  assertListFilterSupported(input.entityType, input.listFilter);
  assertCarryPairsOffered(input.entityType, input.key, input.carryTo);
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
    audience: input.audience,
    sortOrder: input.sortOrder,
    config: input.config,
    listFilter: input.listFilter ?? false,
    carryTo: [...(input.carryTo ?? [])],
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
  assertValueTypeChangeAllowed(def.key, def.valueType, patch.valueType);
  assertListFilterSupported(def.entityType, patch.listFilter);
  assertCarryPairsOffered(
    def.entityType,
    def.key,
    patch.carryTo?.filter((target) => !def.carryTo.includes(target)),
  );
  // FR-010: changing valueType while values exist is rejected (probe binding).
  if (patch.valueType !== undefined && patch.valueType !== def.valueType && probes) {
    const inUse = await probes.hasStoredValues(em, def.entityType, def.key);
    if (inUse) {
      throw new CustomFieldDefinitionError(
        'value_type_locked',
        `Cannot change the value type of "${def.key}" while records hold values. Clear them first.`,
        { key: def.key },
      );
    }
  }
  if (patch.label !== undefined) def.label = patch.label;
  if (patch.labelDefault !== undefined) def.labelDefault = patch.labelDefault;
  if (patch.valueType !== undefined) def.valueType = patch.valueType;
  if (patch.required !== undefined) def.required = patch.required;
  if (patch.audience !== undefined) def.audience = patch.audience;
  if (patch.sortOrder !== undefined) def.sortOrder = patch.sortOrder;
  if (patch.config !== undefined) def.config = patch.config;
  if (patch.listFilter !== undefined) def.listFilter = patch.listFilter;
  if (patch.carryTo !== undefined) def.carryTo = [...patch.carryTo];
  return def;
}

/**
 * Rename a definition's key on the caller's EM — the one path by which a key
 * changes after create (`specs/134-paid-module-extraction/research.md` D12).
 *
 * Not an edit: `UpdateCustomFieldDefinitionRequest` omits `key` on purpose,
 * because every host stores its values **under** the key and an ordinary rename
 * would orphan them. The caller of this function is therefore one that renames
 * the host's values in the same transaction — today a connector repairing keys
 * it derived itself, with `catalog` moving the product values beside it.
 *
 * `expectedKey` is the key the caller planned from. A definition whose key has
 * moved since is refused with `key_changed` rather than renamed from a state the
 * caller never saw. Flushes before it returns, so a caller sequencing a
 * two-phase rename (park, then move) gets its statements in the order it asked
 * for them and a unique-index violation surfaces at the call that caused it.
 */
export async function applyRenameDefinitionKey(
  em: EntityManager,
  id: string,
  expectedKey: string,
  newKey: string,
): Promise<CustomFieldDefinition> {
  // command-coverage-ignore: apply-seam primitive — mutates on the caller's
  // transactional EM. Its one caller is a system-invariant repair with no
  // operator and no actor (a connector re-keying the attributes it derived,
  // committed atomically with the host's value rename and the connector's own
  // repair checkpoint); an audit entry for it would have nobody to attribute.
  // Contract: specs/134-paid-module-extraction/research.md D12.
  const def = await em.findOne(CustomFieldDefinition, { id });
  if (!def) throw new CustomFieldDefinitionError('not_found', `Custom field ${id} not found.`);
  if (def.key !== expectedKey) {
    throw new CustomFieldDefinitionError(
      'key_changed',
      `Custom field ${id} is keyed "${def.key}", not "${expectedKey}"; nothing was renamed.`,
    );
  }
  if (!customFieldDefinitionSchema.shape.key.safeParse(newKey).success) {
    throw new CustomFieldDefinitionError('invalid_key', `"${newKey}" is not a valid field key.`);
  }
  if (newKey === def.key) return def;
  const holder = await em.findOne(CustomFieldDefinition, { entityType: def.entityType, key: newKey });
  if (holder) {
    throw new CustomFieldDefinitionError(
      'duplicate_key',
      `A field "${newKey}" already exists on ${def.entityType}.`,
    );
  }
  def.key = newKey;
  await em.flush();
  return def;
}

/** Delete a definition on the caller's EM. Options cascade; host values stay dormant (FR-010). */
export async function applyDeleteDefinition(em: EntityManager, id: string): Promise<CustomFieldDefinition> {
  // command-coverage-ignore: apply-seam primitive — mutates on the invoking Command's
  // transactional EM; the caller (custom_fields definition command or a host command,
  // e.g. catalog.attribute.*) records the single audit row co-transactionally.
  // Contract: specs/061-attributes-on-custom-fields/contracts/custom-fields-product-host.md.
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
  // command-coverage-ignore: apply-seam primitive — mutates on the invoking Command's
  // transactional EM; the caller (custom_fields definition command or a host command,
  // e.g. catalog.attribute.*) records the single audit row co-transactionally.
  // Contract: specs/061-attributes-on-custom-fields/contracts/custom-fields-product-host.md.
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
        { value: option.value, label: option.labelDefault },
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
  // command-coverage-ignore: apply-seam primitive, exactly like the two exported
  // functions that call it — the `em.create` queues the row on the invoking
  // Command's transactional EM and is flushed by that Command, which records the
  // single audit row co-transactionally. The marker belongs here rather than only
  // on the callers because this is the function that writes (D-89).
  // Contract: specs/061-attributes-on-custom-fields/contracts/custom-fields-product-host.md.
  return em.create(CustomFieldOption, {
    definitionId,
    value: input.value,
    label: input.label,
    labelDefault: input.labelDefault,
    isDefault: input.isDefault,
    sortOrder: input.sortOrder,
  });
}
