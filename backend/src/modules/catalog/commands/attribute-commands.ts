import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  isCustomFieldDefinitionFailure,
  type CreateAttributeRequest,
  type CustomFieldDefinitionWithOptions,
  type CustomFieldOptionDto,
  type UpdateAttributeRequest,
} from '@b2b/contracts';
import type { Command } from '../../../commands/index.js';
import { HttpError } from '../../../http/error-envelope.js';
import type { CustomFieldDefinitionApplyApi } from '../../custom_fields/services/custom-field-definition.service.js';

import { ProductAttribute } from '../entities/product-attribute.entity.js';
import {
  cfToLegacyValueType,
  legacyToCfType,
  resolveAttributeApiType,
} from '../services/attribute-type-mapping.js';
import {
  isValidOptionValue,
  validateOptionList,
} from '../services/attribute-option-validator.js';
import type { CatalogAttributeOptionView } from '../services/catalog-attribute-read.service.js';

/**
 * Catalog attribute + option Commands (feature 061, Principle XIII).
 *
 * Each factory returns a {@link Command} the CommandBus runs co-transactionally:
 * the definition write goes through the custom_fields transactional apply seam
 * (`CustomFieldDefinitionApplyApi`, contracts/custom-fields-product-host.md §3)
 * on the SAME EntityManager as the catalog extension write, so the total-1:1
 * definition⇄extension invariant holds atomically (research §R4). The bus
 * writes exactly one audit row per operator action; the caller
 * (CatalogAdminService) publishes the CF cache invalidation post-commit.
 *
 * `attribute.updated.v1` keeps its legacy emission points: attribute create +
 * every attribute update — never option CRUD (reindex trigger contract,
 * research §R10).
 */

/**
 * The apply seam's type, named **once** in this module (D-77).
 *
 * `catalog` reached `custom_fields`' definition service from two files; the
 * second was `catalog-admin.service.ts`, which extends this interface into
 * `CatalogCustomFieldsPort`. It names this re-export now, so the permanent
 * residue is one type in one file rather than one type in two — and the entry
 * that stays in the boundary ledger is the entry the foreign key actually
 * entails.
 *
 * It is a re-export rather than a local declaration on purpose. `lazyPort<T>`
 * is an unchecked cast: with the type declared on the consumer's side nothing
 * would verify that `custom_fields` still satisfies it, and today's
 * compile-time proof — the provider's class implements the interface the
 * consumer imports — is what stands between an FK-backed invariant and a
 * runtime surprise.
 */
export type { CustomFieldDefinitionApplyApi };

export interface AttributeCommandDeps {
  /** The custom_fields transactional apply seam (definition/option writes). */
  apply: CustomFieldDefinitionApplyApi;
  /** Committed-state definition read (capture snapshots + guard inputs). */
  readDefinition: (id: string) => Promise<CustomFieldDefinitionWithOptions | null>;
}

export interface AttributeMutationResult {
  extensionId: string;
  definitionId: string;
  key: string;
  isSearchable: boolean;
  isFilterable: boolean;
}

/**
 * Map an apply-seam failure onto the catalog admin API's legacy HTTP surface.
 *
 * D-77's second narrowing: this used to be `err instanceof
 * CustomFieldDefinitionError`, which imported a constructor out of another
 * module to read a string field off it. `isCustomFieldDefinitionFailure` is the
 * published guard over the published code union, so the narrowing is structural
 * and the class stops crossing the boundary.
 */
function toCatalogHttpError(err: unknown, keyForMessage?: string): never {
  if (isCustomFieldDefinitionFailure(err)) {
    switch (err.code) {
      case 'duplicate_key':
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Attribute key "${keyForMessage ?? ''}" already exists.`,
        );
      case 'not_found':
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, err.message);
      case 'value_type_locked':
      case 'option_in_use':
        throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, err.message);
      default:
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, err.message);
    }
  }
  throw err;
}

function attributeEvent(result: AttributeMutationResult): {
  eventName: 'attribute.updated.v1';
  payload: {
    eventId: string;
    occurredAt: string;
    attributeKey: string;
    isSearchable: boolean;
    isFilterable: boolean;
  };
} {
  return {
    eventName: 'attribute.updated.v1',
    payload: {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      attributeKey: result.key,
      isSearchable: result.isSearchable,
      isFilterable: result.isFilterable,
    },
  };
}

/** Normalize the create request's option forms (rich `options` wins over legacy `enumValues`). */
function normalizeCreateOptions(req: CreateAttributeRequest): CustomFieldOptionDto[] {
  if (req.options && req.options.length > 0) {
    return req.options.map((o, i) => ({
      value: o.value,
      label: o.label ?? {},
      labelDefault: o.labelDefault,
      isDefault: o.isDefault ?? false,
      sortOrder: o.sortOrder ?? i,
    }));
  }
  if (req.enumValues && req.enumValues.length > 0) {
    return req.enumValues.map((v, i) => ({
      value: v,
      label: {},
      labelDefault: v,
      isDefault: false,
      sortOrder: i,
    }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Attribute commands
// ---------------------------------------------------------------------------

export function createAttributeCommand(
  deps: AttributeCommandDeps,
  req: CreateAttributeRequest,
  input: { extensionId: string; sortOrder: number },
): Command<AttributeMutationResult> {
  return {
    action: 'catalog.attribute.create',
    objectType: 'product_attribute',
    objectId: input.extensionId,
    run: async ({ em }) => {
      const resolved = resolveAttributeApiType(req);
      if (
        resolved.displayAsSlider &&
        resolved.valueType !== 'number' &&
        resolved.valueType !== 'price'
      ) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `displayAsSlider is only valid for valueType="number" or "price"; got "${resolved.valueType}".`,
        );
      }
      const labelDefault =
        req.labelDefault ??
        req.label['en-US'] ??
        Object.values(req.label)[0] ??
        req.key;
      const triple = legacyToCfType(resolved.valueType);
      const options = normalizeCreateOptions(req);
      // Catalog option guards (at-most-one default for single-select styles).
      if (options.length > 0 && triple.cfValueType !== 'multiselect') {
        const check = validateOptionList(options, resolved.valueType);
        if (!check.ok) {
          const first = check.errors[0]!;
          throw new HttpError(
            first.code === 'attribute_type_unsupported' || first.code === 'invalid_option_value'
              ? 400
              : 409,
            ERROR_CODES.VALIDATION_FAILED,
            first.message,
          );
        }
      }

      let definitionId: string;
      try {
        const def = await deps.apply.applyCreate(em, {
          entityType: 'product',
          key: req.key,
          label: req.label,
          labelDefault,
          valueType: triple.cfValueType,
          required: req.isRequired ?? false,
          sortOrder: input.sortOrder,
          config: {},
          options,
        });
        definitionId = def.id;
        // The extension references the definition by plain uuid (no ORM
        // relation), so the definition row MUST hit the DB before the
        // extension insert — MikroORM cannot infer the ordering itself.
        await em.flush();
      } catch (err) {
        toCatalogHttpError(err, req.key);
      }

      em.create(ProductAttribute, {
        id: input.extensionId,
        customFieldDefinitionId: definitionId,
        selectDisplay: triple.selectDisplay,
        numericKind: triple.numericKind,
        isSearchable: req.isSearchable,
        isFilterable: req.isFilterable,
        isVariantAxis: req.isVariantAxis,
        displayAsSlider: resolved.displayAsSlider,
        isComparable: req.isComparable ?? false,
        isPromoRule: req.isPromoRule ?? false,
        filterPosition: req.filterPosition ?? 0,
        isVisibleOnProductPage: req.isVisibleOnProductPage ?? false,
        channelScoped: req.channelScoped ?? false,
        languageScoped: req.languageScoped ?? false,
        massEditable: req.massEditable ?? false,
        quickSearchable: req.quickSearchable ?? false,
      });
      await em.flush();

      return {
        result: {
          extensionId: input.extensionId,
          definitionId,
          key: req.key,
          isSearchable: req.isSearchable,
          isFilterable: req.isFilterable,
        },
        before: null,
        after: { key: req.key, valueType: resolved.valueType },
      };
    },
    event: attributeEvent,
  };
}

export function updateAttributeCommand(
  deps: AttributeCommandDeps,
  extensionId: string,
  req: UpdateAttributeRequest,
): Command<AttributeMutationResult> {
  return {
    action: 'catalog.attribute.update',
    objectType: 'product_attribute',
    objectId: extensionId,
    run: async ({ em }) => {
      const ext = await em.findOne(ProductAttribute, { id: extensionId });
      if (!ext) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${extensionId}" not found.`);
      }
      const cached = await deps.readDefinition(ext.customFieldDefinitionId);
      if (!cached) {
        throw new HttpError(
          404,
          ERROR_CODES.NOT_FOUND,
          `Attribute "${extensionId}" has no backing definition.`,
        );
      }
      const def = cached.definition;
      const currentLegacyType = cfToLegacyValueType(
        def.valueType,
        ext.selectDisplay,
        ext.numericKind,
      );
      const before = {
        label: def.label,
        labelDefault: def.labelDefault,
        isSearchable: ext.isSearchable,
        isFilterable: ext.isFilterable,
        valueType: currentLegacyType,
      };

      // -- Extension flags -------------------------------------------------
      if (req.isSearchable !== undefined) ext.isSearchable = req.isSearchable;
      if (req.isFilterable !== undefined) ext.isFilterable = req.isFilterable;
      if (req.isVariantAxis !== undefined) ext.isVariantAxis = req.isVariantAxis;
      if (req.isComparable !== undefined) ext.isComparable = req.isComparable;
      if (req.isPromoRule !== undefined) ext.isPromoRule = req.isPromoRule;
      if (req.filterPosition !== undefined) ext.filterPosition = req.filterPosition;
      if (req.isVisibleOnProductPage !== undefined) {
        ext.isVisibleOnProductPage = req.isVisibleOnProductPage;
      }
      if (req.channelScoped !== undefined) ext.channelScoped = req.channelScoped;
      if (req.languageScoped !== undefined) ext.languageScoped = req.languageScoped;
      if (req.massEditable !== undefined) ext.massEditable = req.massEditable;
      if (req.quickSearchable !== undefined) ext.quickSearchable = req.quickSearchable;

      // -- Type change (API form) — re-derives valueType + displayAsSlider ---
      let newLegacyType = currentLegacyType;
      if (req.type !== undefined) {
        const resolved = resolveAttributeApiType({
          type: req.type,
          ...(req.numericKind !== undefined ? { numericKind: req.numericKind } : {}),
          ...(req.displayAsSlider !== undefined
            ? { displayAsSlider: req.displayAsSlider }
            : {}),
        });
        newLegacyType = resolved.valueType;
        ext.displayAsSlider = resolved.displayAsSlider;
      } else if (req.displayAsSlider !== undefined) {
        // Same valueType-vs-displayAsSlider rule as create.
        if (
          req.displayAsSlider &&
          currentLegacyType !== 'number' &&
          currentLegacyType !== 'price'
        ) {
          throw new HttpError(
            400,
            ERROR_CODES.VALIDATION_FAILED,
            `displayAsSlider is only valid for valueType="number" or "price"; got "${currentLegacyType}".`,
          );
        }
        ext.displayAsSlider = req.displayAsSlider;
      }
      const triple = legacyToCfType(newLegacyType);
      ext.selectDisplay = triple.selectDisplay;
      ext.numericKind = triple.numericKind;

      // -- Generic-part patch through the apply seam -------------------------
      const patch: Record<string, unknown> = {};
      if (req.label !== undefined) patch['label'] = req.label;
      if (req.labelDefault !== undefined) patch['labelDefault'] = req.labelDefault;
      if (req.isRequired !== undefined) patch['required'] = req.isRequired;
      if (triple.cfValueType !== def.valueType) patch['valueType'] = triple.cfValueType;
      if (Object.keys(patch).length > 0) {
        try {
          await deps.apply.applyUpdate(em, def.id, patch);
        } catch (err) {
          toCatalogHttpError(err, def.key);
        }
      }
      await em.flush();

      return {
        result: {
          extensionId,
          definitionId: def.id,
          key: def.key,
          isSearchable: ext.isSearchable,
          isFilterable: ext.isFilterable,
        },
        before,
        after: {
          isSearchable: ext.isSearchable,
          isFilterable: ext.isFilterable,
          valueType: newLegacyType,
        },
      };
    },
    event: attributeEvent,
  };
}

export function deleteAttributeCommand(
  deps: AttributeCommandDeps,
  target: {
    /** The route affordance the operator used — kept as the audit objectId (legacy parity). */
    idOrKey: string;
    extensionId: string;
    definitionId: string;
    key: string;
    legacyValueType: string;
  },
): Command<void> {
  return {
    action: 'catalog.attribute.delete',
    objectType: 'product_attribute',
    objectId: target.idOrKey,
    run: async ({ em }) => {
      const ext = await em.findOne(ProductAttribute, { id: target.extensionId });
      if (!ext) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${target.idOrKey}" not found.`);
      }
      // `em.execute`, not `em.getConnection().execute`: a Command's `run` is
      // inside `CommandBus.run`'s transaction, and a connection-level execute
      // takes its own connection — so these reference guards read the state
      // outside the very transaction whose write they are guarding (issue #200).
      const setRefs = (await em
        .execute<Array<{ attribute_set_id: string }>>(
          `select attribute_set_id from attribute_set_attributes where custom_field_definition_id = ?`,
          [target.definitionId],
        )) as Array<{ attribute_set_id: string }>;
      if (setRefs.length > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Attribute is still referenced by ${setRefs.length} attribute set(s); remove from sets first.`,
        );
      }
      const productRefs = (await em
        .execute<Array<{ count: string }>>(
          `select count(*)::text as count from products where attribute_values \\? ?`,
          [target.key],
        )) as Array<{ count: string }>;
      const productCount = Number(productRefs[0]?.count ?? '0');
      if (productCount > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Attribute is still referenced by ${productCount} product(s); clear values first.`,
        );
      }
      // Remove the extension FIRST (FK RESTRICT extension → definition), then
      // the definition (+ options) through the apply seam.
      em.remove(ext);
      await em.flush();
      try {
        await deps.apply.applyDelete(em, target.definitionId);
      } catch (err) {
        toCatalogHttpError(err, target.key);
      }
      await em.flush();
      return {
        result: undefined,
        before: { key: target.key, valueType: target.legacyValueType },
        after: null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Option commands
// ---------------------------------------------------------------------------

/** The slice of the composed view the option commands need. */
export interface AttributeOptionCommandTarget {
  extensionId: string;
  definitionId: string;
  key: string;
  /** Legacy 8-value form (drives the catalog option-list guards). */
  valueType: string;
  options: CatalogAttributeOptionView[];
}

export interface AttributeOptionResult {
  id: string;
  attributeId: string;
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

function optionResult(
  attr: AttributeOptionCommandTarget,
  option: {
    id: string;
    value: string;
    label: Record<string, string>;
    labelDefault: string;
    isDefault: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  },
): AttributeOptionResult {
  return {
    id: option.id,
    attributeId: attr.extensionId,
    value: option.value,
    label: option.label ?? {},
    labelDefault: option.labelDefault,
    isDefault: option.isDefault,
    sortOrder: option.sortOrder,
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
  };
}

export function createAttributeOptionCommand(
  deps: AttributeCommandDeps,
  attr: AttributeOptionCommandTarget,
  input: {
    value: string;
    label?: Record<string, string>;
    labelDefault: string;
    isDefault?: boolean;
    sortOrder?: number;
  },
): Command<AttributeOptionResult> {
  return {
    action: 'catalog.attribute_option.create',
    objectType: 'attribute_option',
    objectId: 'new',
    run: async ({ em }) => {
      if (!isValidOptionValue(input.value)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `invalid_option_value: ${input.value}`,
        );
      }
      const candidate = {
        value: input.value,
        labelDefault: input.labelDefault,
        isDefault: input.isDefault ?? false,
      };
      const result = validateOptionList(
        [
          ...attr.options.map((o) => ({
            value: o.value,
            labelDefault: o.labelDefault,
            isDefault: o.isDefault,
          })),
          candidate,
        ],
        attr.valueType,
      );
      if (!result.ok) {
        const first = result.errors[0]!;
        throw new HttpError(
          first.code === 'attribute_type_unsupported' ? 400 : 409,
          ERROR_CODES.VALIDATION_FAILED,
          first.message,
        );
      }
      const sortOrder =
        input.sortOrder ??
        (attr.options.length > 0
          ? Math.max(...attr.options.map((o) => o.sortOrder)) + 1
          : 0);
      try {
        const opt = await deps.apply.applyCreateOption(em, attr.definitionId, {
          value: input.value,
          label: input.label ?? {},
          labelDefault: input.labelDefault,
          isDefault: input.isDefault ?? false,
          sortOrder,
        });
        await em.flush();
        return {
          result: optionResult(attr, opt),
          before: null,
          after: { attributeId: attr.extensionId, value: input.value },
        };
      } catch (err) {
        toCatalogHttpError(err, attr.key);
      }
    },
  };
}

export function updateAttributeOptionCommand(
  deps: AttributeCommandDeps,
  attr: AttributeOptionCommandTarget,
  optionId: string,
  input: {
    label?: Record<string, string>;
    labelDefault?: string;
    isDefault?: boolean;
    sortOrder?: number;
  },
): Command<AttributeOptionResult> {
  return {
    action: 'catalog.attribute_option.update',
    objectType: 'attribute_option',
    objectId: optionId,
    run: async ({ em }) => {
      const existing = attr.options.find((o) => o.id === optionId);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute option ${optionId} not found.`);
      }
      const before = {
        label: existing.label,
        labelDefault: existing.labelDefault,
        sortOrder: existing.sortOrder,
        isDefault: existing.isDefault,
      };
      if (input.isDefault === true) {
        const reslist = attr.options.map((o) => ({
          value: o.value,
          labelDefault: o.labelDefault,
          isDefault: o.id === optionId ? true : o.isDefault,
        }));
        const result = validateOptionList(reslist, attr.valueType);
        if (!result.ok) {
          throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, result.errors[0]!.message);
        }
      }
      try {
        const opt = await deps.apply.applyUpdateOption(em, attr.definitionId, optionId, {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.labelDefault !== undefined ? { labelDefault: input.labelDefault } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        });
        await em.flush();
        return {
          result: optionResult(attr, opt),
          before,
          after: {
            labelDefault: opt.labelDefault,
            sortOrder: opt.sortOrder,
            isDefault: opt.isDefault,
          },
        };
      } catch (err) {
        toCatalogHttpError(err, attr.key);
      }
    },
  };
}

export function deleteAttributeOptionCommand(
  deps: AttributeCommandDeps,
  attr: AttributeOptionCommandTarget,
  optionId: string,
): Command<void> {
  return {
    action: 'catalog.attribute_option.delete',
    objectType: 'attribute_option',
    objectId: optionId,
    run: async ({ em }) => {
      const existing = attr.options.find((o) => o.id === optionId);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute option ${optionId} not found.`);
      }
      // Catalog's authoritative in-use check (the CF probe is defense-in-depth
      // for flat shapes — research §R9). Shape-aware: a language-scoped
      // attribute stores `{ "<key>": { "<lang>": value } }` (value is a scalar
      // for single-select styles or an array for multiselect), which the flat
      // `->>key = value` probe would miss — so every stored shape is checked:
      //   object → any language slot equals the value / contains it in-array;
      //   array  → flat multiselect containment;
      //   else   → flat scalar equality.
      // Inside the Command's transaction — see the note in the delete command.
      const refs = (await em
        .execute<Array<{ count: string }>>(
          `select count(*)::text as count
             from products p
            where case jsonb_typeof(p.attribute_values -> ?)
                    when 'object' then exists (
                      select 1
                        from jsonb_each(p.attribute_values -> ?) kv
                       where (jsonb_typeof(kv.value) = 'array' and kv.value \\? ?)
                          or kv.value #>> '{}' = ?
                    )
                    when 'array' then (p.attribute_values -> ?) \\? ?
                    else p.attribute_values ->> ? = ?
                  end`,
          [
            attr.key,
            attr.key,
            existing.value,
            existing.value,
            attr.key,
            existing.value,
            attr.key,
            existing.value,
          ],
        )) as Array<{ count: string }>;
      const productCount = Number(refs[0]?.count ?? '0');
      if (productCount > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `option_in_use: ${productCount} product(s) still carry value '${existing.value}'.`,
        );
      }
      try {
        await deps.apply.applyDeleteOption(em, attr.definitionId, optionId);
        await em.flush();
      } catch (err) {
        toCatalogHttpError(err, attr.key);
      }
      return {
        result: undefined,
        before: { attributeId: attr.extensionId, value: existing.value },
        after: null,
      };
    },
  };
}
