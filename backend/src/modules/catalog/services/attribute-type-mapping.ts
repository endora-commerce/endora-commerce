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
