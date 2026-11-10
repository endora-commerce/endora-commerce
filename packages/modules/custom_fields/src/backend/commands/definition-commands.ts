import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldOptionDto,
  UpdateCustomFieldDefinitionRequest,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../entities/custom-field-option.entity.js';
import {
  applyCreateDefinition,
  assertCarryTargetsAccepted,
  CustomFieldDefinitionError,
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
    audience: def.audience,
    sortOrder: def.sortOrder,
    config: def.config,
    listFilter: def.listFilter,
    carryTo: [...def.carryTo],
    // Feature 175 (FR-008) — both attributes are audited like any other.
    customerInput: [...(def.customerInput ?? [])],
    adminAccess: def.adminAccess ?? 'edit',
  };
}

/**
 * Every member an option edit can change (feature 157): an audit entry whose
 * before and after differ in exactly what the operator changed — the labels,
 * the default flag or the position — rather than looking unchanged.
 */
function snapshotOption(o: CustomFieldOption): Record<string, unknown> {
  return {
    id: o.id,
    value: o.value,
    label: o.label,
    labelDefault: o.labelDefault,
    isDefault: o.isDefault,
    sortOrder: o.sortOrder,
  };
}

/** Create a definition (+ its options for select types). */
export function createDefinitionCommand(
  input: CreateCustomFieldDefinitionRequest,
  probes?: DefinitionChangeProbes,
): Command<CustomFieldDefinition> {
  return {
    action: 'custom_fields.definition.created',
    objectType: 'custom_field_definition',
    objectId: 'new',
    run: async ({ em }) => {
      // Deleting a definition keeps its stored values, and nothing says any
      // longer who those were meant for. A new `customer` definition under the
      // same key would answer them to customers the moment it exists, so it is
      // refused: create the field as internal, then open it — a second,
      // deliberate step taken with the old values in view.
      if (
        input.audience === 'customer' &&
        probes &&
        (await probes.hasStoredValues(em, input.entityType, input.key))
      ) {
        throw new CustomFieldDefinitionError(
          'stored_values_exist',
          `Records already hold values under "${input.key}", left by a field that was deleted. ` +
            'Create the field as internal, review those values, then change who can see it.',
          { key: input.key },
        );
      }
      // Feature 162 — every carry target of a new definition is judged now,
      // in this transaction, against the same-key definition of the target.
      await assertCarryTargetsAccepted(
        em,
        {
          entityType: input.entityType,
          key: input.key,
          valueType: input.valueType,
          audience: input.audience,
          options: input.options,
        },
        input.carryTo,
      );
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
      // Feature 162 — only the carry targets this patch turns on are judged:
      // one already on stays as configured whatever has drifted since (FR-019).
      const current = await em.findOne(CustomFieldDefinition, { id });
      const added = current
        ? (patch.carryTo ?? []).filter((target) => !current.carryTo.includes(target))
        : [];
      if (current && added.length > 0) {
        await assertCarryTargetsAccepted(
          em,
          {
            entityType: current.entityType,
            key: current.key,
            valueType: patch.valueType ?? current.valueType,
            audience: patch.audience ?? current.audience,
            options: await em.find(CustomFieldOption, { definitionId: id }),
          },
          added,
        );
      }
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
      return o ? snapshotOption(o) : null;
    },
    run: async ({ em }) => {
      const o = await applyUpdateOption(em, definitionId, optionId, patch);
      return { result: o, after: snapshotOption(o) };
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
