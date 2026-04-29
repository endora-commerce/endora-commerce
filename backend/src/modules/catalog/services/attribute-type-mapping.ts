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
 *
 * NOTE: stub — implementation lands in T022.
 */
export function apiTypeToDb(_input: ApiAttributeShape): DbAttributeShape {
  throw new Error('not implemented');
}

/**
 * Convert a DB-shaped attribute spec back to its API representation.
 * Honors the rule that an `enum` with `enumValues.length === 1` surfaces
 * as `select` while `length > 1` surfaces as `multiselect`; a numeric/price
 * attribute with `displayAsSlider=true` surfaces as `slider`.
 *
 * NOTE: stub — implementation lands in T022.
 */
export function dbTypeToApi(_input: DbAttributeShape): ApiAttributeShape {
  throw new Error('not implemented');
}
