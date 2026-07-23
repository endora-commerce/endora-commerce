import {
  ERROR_CODES,
  type ApiAttributeType as ContractApiAttributeType,
  type AttributeValueType,
  type NumericKind,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';

/**
 * Attribute type mapping between the API surface (feature 002) and the DB
 * `value_type` column inherited from foundation 001.
 *
 * See:
 *   - specs/002-catalog-module/data-model.md §1.2 (mapping table)
 *   - specs/002-catalog-module/research.md R-7 (decision: keep DB enum
 *     primitive-typed, derive presentation hints in the contract layer).
 *
 * Implementation lands in T022/T023; this module currently exposes only
 * the type signatures so failing unit tests (T011) can compile.
 */

export type ApiAttributeType =
  | 'input'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'price'
  | 'slider';

/** DB-level types — superset of foundation 001's `attributeValueTypeSchema`. */
export type DbAttributeValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'multiselect'
  | 'price';

export interface ApiAttributeShape {
  type: ApiAttributeType;
  enumValues?: string[];
  /** Required when `type === 'slider'`: which numeric DB type backs the slider. */
  numericKind?: 'number' | 'price';
}

// ---------------------------------------------------------------------------
// Feature 061 — legacy 8-value form ⇄ Custom Fields triple (research §R7).
// ---------------------------------------------------------------------------

/** The legacy persisted form (pre-061 `product_attributes.value_type`). */
export type LegacyAttributeValueType = DbAttributeValueType | 'select';

/** Generic Custom Fields value types the product host maps onto. */
export type CfAttributeValueType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect';

/** Extension refinement: how a cf `select` renders (legacy `enum` vs `select`). */
export type SelectDisplay = 'pill' | 'dropdown';

/** Extension refinement: which numeric semantics back a cf `number`. */
export type NumericKindRefinement = 'number' | 'price';

export interface CfTypeTriple {
  cfValueType: CfAttributeValueType;
  selectDisplay: SelectDisplay | null;
  numericKind: NumericKindRefinement | null;
}

/**
 * Legacy `value_type` → (cf `value_type`, selectDisplay, numericKind).
 * Bijective per research §R7 — every legacy value produces a distinct triple.
 */
export function legacyToCfType(valueType: LegacyAttributeValueType): CfTypeTriple {
  switch (valueType) {
    case 'string':
      return { cfValueType: 'text', selectDisplay: null, numericKind: null };
    case 'number':
      return { cfValueType: 'number', selectDisplay: null, numericKind: 'number' };
    case 'price':
      return { cfValueType: 'number', selectDisplay: null, numericKind: 'price' };
    case 'boolean':
      return { cfValueType: 'boolean', selectDisplay: null, numericKind: null };
    case 'date':
      return { cfValueType: 'date', selectDisplay: null, numericKind: null };
    case 'enum':
      return { cfValueType: 'select', selectDisplay: 'pill', numericKind: null };
    case 'select':
      return { cfValueType: 'select', selectDisplay: 'dropdown', numericKind: null };
    case 'multiselect':
      return { cfValueType: 'multiselect', selectDisplay: null, numericKind: null };
    default: {
      const _exhaustive: never = valueType;
      throw new InvalidAttributeMappingError(
        `Unsupported legacy attribute valueType: ${String(_exhaustive)}`,
        'INVALID_DB_TYPE',
      );
    }
  }
}

/**
 * (cf `value_type`, selectDisplay, numericKind) → legacy 8-value form.
 * Inverse of {@link legacyToCfType}. A missing refinement defaults to the
 * non-refined legacy value (`number` / `select`).
 */
export function cfToLegacyValueType(
  cfValueType: string,
  selectDisplay: SelectDisplay | null | undefined,
  numericKind: NumericKindRefinement | null | undefined,
): LegacyAttributeValueType {
  switch (cfValueType) {
    case 'text':
      return 'string';
    case 'number':
      return numericKind === 'price' ? 'price' : 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'select':
      return selectDisplay === 'pill' ? 'enum' : 'select';
    case 'multiselect':
      return 'multiselect';
    default:
      throw new InvalidAttributeMappingError(
        `Unsupported cf attribute valueType: ${cfValueType}`,
        'INVALID_DB_TYPE',
      );
  }
}

// ---------------------------------------------------------------------------
// API-form resolution (feature 002; moved here from catalog-admin.service.ts by
// feature 061 so the attribute Commands can consume it without an import cycle).
// ---------------------------------------------------------------------------

/**
 * Maps an API-form attribute request onto the persisted `valueType` +
 * `displayAsSlider` pair (research R-7). Either `type` (preferred) or
 * `valueType` (legacy) MUST be set — Zod refines guarantee it for create;
 * update callers pass `type` explicitly so it's always present here.
 */
export function resolveAttributeApiType(req: {
  type?: ContractApiAttributeType | undefined;
  valueType?: AttributeValueType | undefined;
  numericKind?: NumericKind | undefined;
  displayAsSlider?: boolean | undefined;
}): { valueType: AttributeValueType; displayAsSlider: boolean } {
  if (req.type === undefined) {
    if (req.valueType === undefined) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'either type or valueType is required',
      );
    }
    return {
      valueType: req.valueType,
      displayAsSlider: req.displayAsSlider ?? false,
    };
  }
  switch (req.type) {
    case 'input':
      return { valueType: 'string', displayAsSlider: false };
    case 'number':
      return { valueType: 'number', displayAsSlider: req.displayAsSlider ?? false };
    case 'select':
      return { valueType: 'enum', displayAsSlider: false };
    case 'multiselect':
      return { valueType: 'multiselect', displayAsSlider: false };
    case 'price':
      return { valueType: 'price', displayAsSlider: req.displayAsSlider ?? false };
    case 'slider': {
      // Zod refine catches the missing-numericKind path; this is a
      // belt-and-braces guard for direct service callers (seeders, etc).
      if (req.numericKind === undefined) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'numericKind is required when type=slider',
        );
      }
      return {
        valueType: req.numericKind === 'price' ? 'price' : 'number',
        displayAsSlider: true,
      };
    }
  }
}

/**
 * Inverse of `resolveAttributeApiType` — derives the API-form `type` +
 * `numericKind` from the persisted (`valueType`, `displayAsSlider`) pair
 * so list/detail responses surface the form admins authored against.
 */
export function dbToApiAttributeType(
  valueType: AttributeValueType,
  displayAsSlider: boolean,
): { type: ContractApiAttributeType; numericKind: NumericKind | null } {
  if (displayAsSlider && (valueType === 'number' || valueType === 'price')) {
    return { type: 'slider', numericKind: valueType };
  }
  switch (valueType) {
    case 'string':
      return { type: 'input', numericKind: null };
    case 'number':
      return { type: 'number', numericKind: null };
    case 'enum':
      return { type: 'select', numericKind: null };
    case 'select':
      // Feature 012 — `'select'` shares storage with `'enum'`; differs only in
      // rendering intent (compact pill vs full dropdown). Maps to the same
      // API affordance for now.
      return { type: 'select', numericKind: null };
    case 'multiselect':
      return { type: 'multiselect', numericKind: null };
    case 'price':
      return { type: 'price', numericKind: null };
    case 'boolean':
    case 'date':
      // These DB-only types have no API alias; surface the legacy form.
      return { type: 'input', numericKind: null };
  }
}

export interface DbAttributeShape {
  valueType: DbAttributeValueType;
  enumValues?: string[];
  displayAsSlider: boolean;
}

export class InvalidAttributeMappingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_DISPLAY_AS_SLIDER'
      | 'ENUM_VALUES_REQUIRED'
      | 'INVALID_API_TYPE'
      | 'INVALID_DB_TYPE',
  ) {
    super(message);
    this.name = 'InvalidAttributeMappingError';
  }
}

/**
 * Convert an API-shaped attribute spec to its DB representation.
 * Throws `InvalidAttributeMappingError` if the API spec is malformed
 * (e.g. `type='select'` with no `enumValues`, `type='slider'` with no
 * `numericKind`).
 */
export function apiTypeToDb(input: ApiAttributeShape): DbAttributeShape {
  switch (input.type) {
    case 'input':
      return { valueType: 'string', displayAsSlider: false };

    case 'number':
      return { valueType: 'number', displayAsSlider: false };

    case 'price':
      return { valueType: 'price', displayAsSlider: false };

    case 'slider': {
      if (input.numericKind !== 'number' && input.numericKind !== 'price') {
        throw new InvalidAttributeMappingError(
          'attribute type "slider" requires `numericKind` of "number" or "price".',
          'INVALID_DISPLAY_AS_SLIDER',
        );
      }
      return { valueType: input.numericKind, displayAsSlider: true };
    }

    case 'select': {
      if (!input.enumValues || input.enumValues.length === 0) {
        throw new InvalidAttributeMappingError(
          'attribute type "select" requires a non-empty `enumValues` list.',
          'ENUM_VALUES_REQUIRED',
        );
      }
      return {
        valueType: 'enum',
        enumValues: input.enumValues,
        displayAsSlider: false,
      };
    }

    case 'multiselect': {
      if (!input.enumValues || input.enumValues.length === 0) {
        throw new InvalidAttributeMappingError(
          'attribute type "multiselect" requires a non-empty `enumValues` list.',
          'ENUM_VALUES_REQUIRED',
        );
      }
      return {
        valueType: 'multiselect',
        enumValues: input.enumValues,
        displayAsSlider: false,
      };
    }

    default: {
      // Exhaustiveness check — TS narrows `input.type` to `never` here.
      const _exhaustive: never = input.type;
      throw new InvalidAttributeMappingError(
        `Unsupported API attribute type: ${String(_exhaustive)}`,
        'INVALID_API_TYPE',
      );
    }
  }
}

/**
 * Convert a DB-shaped attribute spec back to its API representation.
 *
 * Mapping rules (data-model.md §1.2 + research.md R-7):
 *   - `string` → `input`
 *   - `number` / `price` with `displayAsSlider=true` → `slider` + numericKind
 *   - `number` / `price` with `displayAsSlider=false` → `number` / `price`
 *   - `enum` with exactly one value → `select`
 *   - `enum` with several values → `multiselect` (legacy compatibility —
 *     foundation 001's `enum` collapses into `multiselect` when a Product
 *     can hold multiple values)
 *   - `multiselect` (new DB type) → `multiselect`
 *   - `displayAsSlider=true` on any non-numeric type → INVALID
 *   - `boolean` / `date` → not used by feature 002 surface; defensively
 *     mapped to `input` via the foundation primitive (preserved for
 *     backward compat with foundation 001 attributes).
 */
export function dbTypeToApi(input: DbAttributeShape): ApiAttributeShape {
  if (
    input.displayAsSlider &&
    input.valueType !== 'number' &&
    input.valueType !== 'price'
  ) {
    throw new InvalidAttributeMappingError(
      `displayAsSlider is only valid for valueType="number" or "price"; got "${input.valueType}".`,
      'INVALID_DISPLAY_AS_SLIDER',
    );
  }

  switch (input.valueType) {
    case 'string':
      return { type: 'input' };
    case 'number':
      return input.displayAsSlider
        ? { type: 'slider', numericKind: 'number' }
        : { type: 'number' };
    case 'price':
      return input.displayAsSlider
        ? { type: 'slider', numericKind: 'price' }
        : { type: 'price' };
    case 'enum': {
      const values = input.enumValues ?? [];
      if (values.length === 1) {
        return { type: 'select', enumValues: values };
      }
      return { type: 'multiselect', enumValues: values };
    }
    case 'multiselect':
      return {
        type: 'multiselect',
        enumValues: input.enumValues ?? [],
      };
    case 'boolean':
    case 'date':
      // Foundation 001 types not surfaced by feature 002 — fall back to
      // the closest API affordance. They're never produced by the new
      // creation paths; only legacy rows trigger this branch.
      return { type: 'input' };
    default: {
      const _exhaustive: never = input.valueType;
      throw new InvalidAttributeMappingError(
        `Unsupported DB attribute valueType: ${String(_exhaustive)}`,
        'INVALID_DB_TYPE',
      );
    }
  }
}
