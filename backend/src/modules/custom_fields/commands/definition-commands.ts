import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldOptionDto,
  UpdateCustomFieldDefinitionRequest,
} from '@b2b/contracts';
import type { Command } from '../../../commands/index.js';
import { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../entities/custom-field-option.entity.js';
import {
  applyCreateDefinition,
  applyCreateOption,
  applyDeleteDefinition,
  applyDeleteOption,
  applyUpdateDefinition,
  applyUpdateOption,
  type DefinitionChangeProbes,
} from '../services/custom-field-definition-apply.js';

/**
 * Command factories for custom-field definition/option mutations (feature 055,
 * Principle XIII). Each returns a named {@link Command} the {@link CommandBus}
 * runs co-transactionally — the bus writes exactly one audit entry, so the
 * module never calls the audit writer by hand.
 *
 * The command bodies delegate the entity writes + invariants to the shared
 * apply functions (feature 061) so the public CRUD and the host apply seam are
 * a single write path.
 */

function snapshotDefinition(def: CustomFieldDefinition): Record<string, unknown> {
  return {
    id: def.id,
    entityType: def.entityType,
    key: def.key,
    label: def.label,
    labelDefault: def.labelDefault,
    valueType: def.valueType,
    required: def.required,
    sortOrder: def.sortOrder,
    config: def.config,
  };
}

/** Create a definition (+ its options for select types). */
export function createDefinitionCommand(
  input: CreateCustomFieldDefinitionRequest,
): Command<CustomFieldDefinition> {
  return {
    action: 'custom_fields.definition.created',
    objectType: 'custom_field_definition',
    objectId: 'new',
    run: async ({ em }) => {
      const def = await applyCreateDefinition(em, input);
      return { result: def, after: snapshotDefinition(def) };
    },
  };
}

/** Patch a definition's scalar/label/config fields. Options are managed via option sub-commands. */
export function updateDefinitionCommand(
  id: string,
  patch: UpdateCustomFieldDefinitionRequest,
  probes?: DefinitionChangeProbes,
): Command<CustomFieldDefinition> {
  return {
    action: 'custom_fields.definition.updated',
    objectType: 'custom_field_definition',
    objectId: id,
    capture: async ({ em }) => {
      const def = await em.findOne(CustomFieldDefinition, { id });
      return def ? snapshotDefinition(def) : null;
    },
    run: async ({ em }) => {
      const def = await applyUpdateDefinition(em, id, patch, probes);
      return { result: def, after: snapshotDefinition(def) };
    },
  };
}

/** Delete a definition. Options cascade; host values are retained dormant (FR-010). */
export function deleteDefinitionCommand(id: string): Command<{ id: string }> {
  return {
    action: 'custom_fields.definition.deleted',
    objectType: 'custom_field_definition',
    objectId: id,
    capture: async ({ em }) => {
      const def = await em.findOne(CustomFieldDefinition, { id });
      return def ? snapshotDefinition(def) : null;
    },
    run: async ({ em }) => {
      await applyDeleteDefinition(em, id);
      return { result: { id }, after: null };
    },
  };
}

/** Add one option to a select/multiselect definition. */
export function createOptionCommand(
  definitionId: string,
  input: CustomFieldOptionDto,
): Command<CustomFieldOption> {
  return {
    action: 'custom_fields.option.created',
    objectType: 'custom_field_option',
    objectId: 'new',
    run: async ({ em }) => {
      const opt = await applyCreateOption(em, definitionId, input);
      return { result: opt, after: { id: opt.id, definitionId, value: opt.value } };
    },
  };
}

/** Patch one option's label/default/ordering. */
export function updateOptionCommand(
  definitionId: string,
  optionId: string,
  patch: Partial<Pick<CustomFieldOptionDto, 'label' | 'labelDefault' | 'isDefault' | 'sortOrder'>>,
): Command<CustomFieldOption> {
  return {
    action: 'custom_fields.option.updated',
    objectType: 'custom_field_option',
    objectId: optionId,
    capture: async ({ em }) => {
      const o = await em.findOne(CustomFieldOption, { id: optionId });
      return o ? { id: o.id, value: o.value, labelDefault: o.labelDefault } : null;
    },
    run: async ({ em }) => {
      const o = await applyUpdateOption(em, definitionId, optionId, patch);
      return { result: o, after: { id: o.id, value: o.value, labelDefault: o.labelDefault } };
    },
  };
}

/** Delete one option (the in-use guard also runs in the service before dispatch). */
export function deleteOptionCommand(
  definitionId: string,
  optionId: string,
  probes?: DefinitionChangeProbes,
): Command<{ id: string }> {
  return {
    action: 'custom_fields.option.deleted',
    objectType: 'custom_field_option',
    objectId: optionId,
    capture: async ({ em }) => {
      const o = await em.findOne(CustomFieldOption, { id: optionId });
      return o ? { id: o.id, value: o.value } : null;
    },
    run: async ({ em }) => {
      await applyDeleteOption(em, definitionId, optionId, probes);
      return { result: { id: optionId }, after: null };
    },
  };
}
