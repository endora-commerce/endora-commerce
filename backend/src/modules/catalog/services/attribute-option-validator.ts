/**
 * Attribute / option-list validator (feature 012, retained by feature 061).
 *
 * Pure functions used by the attribute Commands
 * (`catalog/commands/attribute-commands.ts`) to refuse bad input before it
 * reaches the DB. Attribute-key format is enforced at the API boundary by
 * the Zod schemas in `@b2b/contracts`.
 */

const OPTION_VALUE_REGEX = /^[a-z0-9_-]{1,200}$/;

/**
 * Value types whose options live in `custom_field_options` (feature 061;
 * previously the catalog-owned `attribute_options` table, FR-021 of 012).
 */
export const SELECT_STYLE_VALUE_TYPES = ['select', 'enum', 'multiselect'] as const;
export type SelectStyleValueType = (typeof SELECT_STYLE_VALUE_TYPES)[number];

export function isValidOptionValue(value: string): boolean {
  return OPTION_VALUE_REGEX.test(value);
}

export interface OptionInput {
  value: string;
  label?: Record<string, string>;
  labelDefault: string;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface ValidationError {
  code:
    | 'duplicate_value'
    | 'default_option_ambiguous'
    | 'invalid_option_value'
    | 'attribute_type_unsupported';
  /** The offending value (when applicable). */
  value?: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

/**
 * Validate an option list against the parent attribute's value type.
 *
 *   - The parent type MUST be one of `select` / `enum` / `multiselect`,
 *     otherwise the call returns `attribute_type_unsupported`.
 *   - Every option `value` MUST match `OPTION_VALUE_REGEX`.
 *   - Values MUST be unique within the list.
 *   - For `select` / `enum` types: at most one option MAY carry
 *     `isDefault = true` (FR-023). `multiselect` allows multiple
 *     defaults (FR-024).
 */
export function validateOptionList(
  options: readonly OptionInput[],
  parentValueType: string,
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!SELECT_STYLE_VALUE_TYPES.includes(parentValueType as SelectStyleValueType)) {
    errors.push({
      code: 'attribute_type_unsupported',
      message: `Options are only supported for ${SELECT_STYLE_VALUE_TYPES.join(' / ')} attributes (got '${parentValueType}').`,
    });
    return { ok: false, errors };
  }

  const seen = new Set<string>();
  let defaultCount = 0;
  for (const opt of options) {
    if (!isValidOptionValue(opt.value)) {
      errors.push({
        code: 'invalid_option_value',
        value: opt.value,
        message: `Option value '${opt.value}' must match /^[a-z0-9_-]{1,200}$/.`,
      });
      continue;
    }
    if (seen.has(opt.value)) {
      errors.push({
        code: 'duplicate_value',
        value: opt.value,
        message: `Duplicate option value '${opt.value}' within the attribute's option list.`,
      });
      continue;
    }
    seen.add(opt.value);
    if (opt.isDefault) defaultCount += 1;
  }

  if (defaultCount > 1 && parentValueType !== 'multiselect') {
    errors.push({
      code: 'default_option_ambiguous',
      message: `Attribute of type '${parentValueType}' allows at most one default option.`,
    });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
