import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldOptionDto,
  UpdateCustomFieldDefinitionRequest,
} from '@b2b/contracts';
import type { Command } from '../../../commands/index.js';
import { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../entities/custom-field-option.entity.js';

/**
 * Command factories for custom-field definition/option mutations (feature 055,
 * Principle XIII). Each returns a named {@link Command} the {@link CommandBus}
 * runs co-transactionally — the bus writes exactly one audit entry, so the
 * module never calls the audit writer by hand.
 */

const SELECT_TYPES = new Set(['select', 'multiselect']);

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
        for (const opt of input.options) createOption(em, def.id, opt);
      }
      return { result: def, after: snapshotDefinition(def) };
    },
  };
}

/** Patch a definition's scalar/label/config fields. Options are managed via option sub-commands. */
export function updateDefinitionCommand(
  id: string,
  patch: UpdateCustomFieldDefinitionRequest,
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
      const def = await em.findOneOrFail(CustomFieldDefinition, { id });
      if (patch.label !== undefined) def.label = patch.label;
      if (patch.labelDefault !== undefined) def.labelDefault = patch.labelDefault;
      if (patch.valueType !== undefined) def.valueType = patch.valueType;
      if (patch.required !== undefined) def.required = patch.required;
      if (patch.sortOrder !== undefined) def.sortOrder = patch.sortOrder;
      if (patch.config !== undefined) def.config = patch.config;
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
      const def = await em.findOneOrFail(CustomFieldDefinition, { id });
      const options = await em.find(CustomFieldOption, { definitionId: id });
      for (const o of options) em.remove(o);
      em.remove(def);
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
      const opt = createOption(em, definitionId, input);
      return { result: opt, after: { id: opt.id, definitionId, value: opt.value } };
    },
  };
}

/** Patch one option's label/default/ordering. */
export function updateOptionCommand(
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
      const o = await em.findOneOrFail(CustomFieldOption, { id: optionId });
      if (patch.label !== undefined) o.label = patch.label;
      if (patch.labelDefault !== undefined) o.labelDefault = patch.labelDefault;
      if (patch.isDefault !== undefined) o.isDefault = patch.isDefault;
      if (patch.sortOrder !== undefined) o.sortOrder = patch.sortOrder;
      return { result: o, after: { id: o.id, value: o.value, labelDefault: o.labelDefault } };
    },
  };
}

/** Delete one option (the in-use guard runs in the service before dispatch). */
export function deleteOptionCommand(optionId: string): Command<{ id: string }> {
  return {
    action: 'custom_fields.option.deleted',
    objectType: 'custom_field_option',
    objectId: optionId,
    capture: async ({ em }) => {
      const o = await em.findOne(CustomFieldOption, { id: optionId });
      return o ? { id: o.id, value: o.value } : null;
    },
    run: async ({ em }) => {
      const o = await em.findOneOrFail(CustomFieldOption, { id: optionId });
      em.remove(o);
      return { result: { id: optionId }, after: null };
    },
  };
}

function createOption(
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
