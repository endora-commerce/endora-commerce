import {
  ERROR_CODES,
  apiAttributeTypeOf,
  type ApiAttributeType as ContractApiAttributeType,
  type AttributeValueType,
  type NumericKind,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Attribute type mapping between the API surface (feature 002) and the
 * legacy 8-value `value_type` form inherited from foundation 001, plus the
 * feature-061 bijection onto the Custom Fields triple
 * (`cf value_type`, `select_display`, `numeric_kind`).
 *
 * See:
 *   - specs/002-catalog-module/data-model.md §1.2 (mapping table)
 *   - specs/061-attributes-on-custom-fields/research.md §R7 (CF triple map)
 */

/** Legacy DB-level types — superset of foundation 001's `attributeValueTypeSchema`. */
export type DbAttributeValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'multiselect'
  | 'price';

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
  // The `type` is the contract's single projection (`apiAttributeTypeOf`,
  // feature 134 D19); `numericKind` is this module's own business: it names
  // the numeric storage a slider sits on so an update can round-trip it.
  const type = apiAttributeTypeOf(valueType, displayAsSlider);
  if (type === 'slider' && (valueType === 'number' || valueType === 'price')) {
    return { type, numericKind: valueType };
  }
  return { type, numericKind: null };
}

export class InvalidAttributeMappingError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_DB_TYPE',
  ) {
    super(message);
    this.name = 'InvalidAttributeMappingError';
  }
}
