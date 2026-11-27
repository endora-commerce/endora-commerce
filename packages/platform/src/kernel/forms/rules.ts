import {
  isEmptyFieldValue,
  type FieldDeclaration,
  type FieldRuleCode,
  type FieldValidationTightening,
  type FieldValueType,
} from '@endora-commerce/contracts';

/**
 * Tightened field rules: how several modules' tightenings on one field merge
 * (`specs/193-admin-form-extensions/` `contracts/field-rules.md` §1 — by
 * conjunction: max of mins, min of maxes, intersection of options, all
 * patterns, all formats) and how a value is held to them. Pure; the seal uses
 * the merge to refuse a contradiction, the field-rule check to refuse a write.
 */

/** One module's contribution to a merged rule: who it came from, and its message key. */
export interface RuleSource {
  readonly moduleId: string;
  readonly messageKey?: string | undefined;
}

interface Bound<T> extends RuleSource {
  readonly value: T;
}

/** A field's tightenings merged across contributors, each bound with the module that set it. */
export interface MergedValidation {
  readonly required?: RuleSource | undefined;
  readonly minLength?: Bound<number> | undefined;
  readonly maxLength?: Bound<number> | undefined;
  readonly min?: Bound<number> | undefined;
  readonly max?: Bound<number> | undefined;
  readonly options?: Bound<readonly string[]> | undefined;
  readonly patterns: readonly Bound<string>[];
  readonly formats: readonly Bound<string>[];
}

export interface ValidationContribution {
  readonly moduleId: string;
  readonly validation: FieldValidationTightening;
}

const larger = <T extends number>(current: Bound<T> | undefined, next: Bound<T>): Bound<T> =>
  current === undefined || next.value > current.value ? next : current;
const smaller = <T extends number>(current: Bound<T> | undefined, next: Bound<T>): Bound<T> =>
  current === undefined || next.value < current.value ? next : current;

/**
 * Merge `contributions` in the order given. Callers pass them sorted by module
 * id, so which module a tie is attributed to does not depend on registration
 * order.
 */
export function mergeValidation(contributions: readonly ValidationContribution[]): MergedValidation {
  let required: RuleSource | undefined;
  let minLength: Bound<number> | undefined;
  let maxLength: Bound<number> | undefined;
  let min: Bound<number> | undefined;
  let max: Bound<number> | undefined;
  let options: Bound<readonly string[]> | undefined;
  const patterns: Bound<string>[] = [];
  const formats: Bound<string>[] = [];
  for (const { moduleId, validation } of contributions) {
    const source = { moduleId, messageKey: validation.messageKey };
    if (validation.required === true && required === undefined) required = source;
    if (validation.minLength !== undefined) minLength = larger(minLength, { ...source, value: validation.minLength });
    if (validation.maxLength !== undefined) maxLength = smaller(maxLength, { ...source, value: validation.maxLength });
    if (validation.min !== undefined) min = larger(min, { ...source, value: validation.min });
    if (validation.max !== undefined) max = smaller(max, { ...source, value: validation.max });
    if (validation.options !== undefined) {
      options =
        options === undefined
          ? { ...source, value: [...validation.options] }
          : { ...options, value: options.value.filter((option) => validation.options!.includes(option)) };
    }
    if (validation.pattern !== undefined) patterns.push({ ...source, value: validation.pattern });
    if (validation.format !== undefined && !formats.some((format) => format.value === validation.format)) {
      formats.push({ ...source, value: validation.format });
    }
  }
  return { required, minLength, maxLength, min, max, options, patterns, formats };
}

/** Why a merged rule admits no value, or `null` when some value satisfies it. */
export function contradictionOf(field: FieldDeclaration, merged: MergedValidation): string | null {
  const minLength = Math.max(field.bounds?.minLength ?? 0, merged.minLength?.value ?? 0);
  const maxLength = Math.min(field.bounds?.maxLength ?? Infinity, merged.maxLength?.value ?? Infinity);
  if (minLength > maxLength) return `at least ${minLength} and at most ${maxLength} characters`;
  const min = Math.max(field.bounds?.min ?? -Infinity, merged.min?.value ?? -Infinity);
  const max = Math.min(field.bounds?.max ?? Infinity, merged.max?.value ?? Infinity);
  if (min > max) return `at least ${min} and at most ${max}`;
  if (merged.options !== undefined && merged.options.value.length === 0) return 'no option every module allows';
  if (merged.formats.length > 1) return `two formats at once (${merged.formats.map((format) => format.value).join(', ')})`;
  return null;
}

/** One broken rule of one value. */
export interface RuleViolation extends RuleSource {
  readonly code: FieldRuleCode;
  readonly params?: { readonly limit?: number; readonly format?: string };
}

export type FormatValidator = (format: string, value: string) => boolean;

const STRING_TYPES: ReadonlySet<FieldValueType> = new Set(['string', 'string[]', 'enum', 'enum[]', 'reference', 'reference[]', 'date', 'datetime']);

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * The rules `value` breaks, when it is present (an empty value breaks only
 * `required`, which the caller decides — D-300.4). An array field is held
 * element by element. A pattern is an ECMAScript source compiled with `u` and
 * tested anywhere in the value, so an author who means the whole value anchors
 * it (`^…$`); the admin-kit twin does the same.
 */
export function violationsOf(
  type: FieldValueType,
  value: unknown,
  merged: MergedValidation,
  validateFormat: FormatValidator,
): RuleViolation[] {
  if (isEmptyFieldValue(value)) return [];
  const elements = Array.isArray(value) ? value : [value];
  const found: RuleViolation[] = [];
  const once = (violation: RuleViolation): void => {
    if (!found.some((existing) => existing.code === violation.code)) found.push(violation);
  };
  for (const element of elements) {
    if (typeof element === 'string' && STRING_TYPES.has(type)) {
      if (merged.minLength !== undefined && element.length < merged.minLength.value) {
        once({ ...merged.minLength, code: 'too_short', params: { limit: merged.minLength.value } });
      }
      if (merged.maxLength !== undefined && element.length > merged.maxLength.value) {
        once({ ...merged.maxLength, code: 'too_long', params: { limit: merged.maxLength.value } });
      }
      for (const pattern of merged.patterns) {
        if (!new RegExp(pattern.value, 'u').test(element)) once({ ...pattern, code: 'pattern' });
      }
      for (const format of merged.formats) {
        if (!validateFormat(format.value, element)) once({ ...format, code: 'format', params: { format: format.value } });
      }
    }
    if (merged.options !== undefined && (typeof element === 'string' || typeof element === 'number')) {
      if (!merged.options.value.includes(String(element))) once({ ...merged.options, code: 'not_an_option' });
    }
    if (type === 'integer' || type === 'decimal') {
      const number = numberOf(element);
      if (number !== null && merged.min !== undefined && number < merged.min.value) {
        once({ ...merged.min, code: 'below_min', params: { limit: merged.min.value } });
      }
      if (number !== null && merged.max !== undefined && number > merged.max.value) {
        once({ ...merged.max, code: 'above_max', params: { limit: merged.max.value } });
      }
    }
  }
  return found;
}

/**
 * Order two identifiers by code point, never by locale (D-300.14): the
 * layout and every list the seal or the effective forms sort must come out
 * the same on every machine, whatever its ICU data says about `_` or case.
 * Module ids, field keys and form ids are ASCII, where UTF-16 code units are
 * code points.
 */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
