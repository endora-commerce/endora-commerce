/**
 * The client half of the field-rule check (`specs/193-admin-form-extensions/`
 * `contracts/field-rules.md` §5 – §6, FR-040, D-300.4, D-300.11).
 *
 * The form evaluates the **effective** rules — the merged tightenings, the
 * `requiredWhen` conditions and the formats the server serves on
 * `GET /api/v1/admin/effective-forms` — with the contracts' one condition
 * evaluator and the platform formats' client twins, over **the same held set
 * the server uses**, so an operator meets the refusal before the round trip
 * and never one the server would not raise:
 *
 * - a create holds every field;
 * - an edit holds a field only when the operator changed or cleared it, and a
 *   `requiredWhen` also when a field its condition reads changed — so a record
 *   stored before a rule existed stays editable in its other fields.
 *
 * The core declaration's own `required` and bounds are the host's to validate,
 * as they were before it adopted (its write schema answers them); this check
 * adds only what a deployment tightened. The server stays the authority: a
 * module format, which only its backend can judge, is left to it.
 */
import {
  evaluateFieldCondition,
  isEmptyFieldValue,
  type EffectiveField,
  type FieldCondition,
  type FieldRuleCode,
  type FieldSetDeclaration,
  type FieldValueType,
} from '@endora-commerce/contracts';
import { checkPlatformFieldFormat } from './formats.js';

export interface ClientFieldViolation {
  /** A core key, as the server's `details[].path`. */
  readonly path: string;
  readonly code: FieldRuleCode;
  readonly params?: { readonly limit?: number; readonly format?: string };
  /** The module whose bundle holds `messageKey`, when the rule declared one. */
  readonly messageModule?: string;
  readonly messageKey?: string;
}

export interface ClientFieldViolationsInput {
  readonly mode: 'create' | 'edit';
  readonly fieldSet: Pick<FieldSetDeclaration, 'fields'>;
  /** The form's effective fields. */
  readonly fields: readonly EffectiveField[];
  /** The keys this submission carries: rendered and writable (or derived). Nothing else can be fixed here. */
  readonly keys: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
  /** The loaded values on an edit form; what "changed" is measured against. */
  readonly initialValues?: Readonly<Record<string, unknown>>;
}

function conditionFields(condition: FieldCondition): string[] {
  if ('all' in condition) return condition.all.flatMap(conditionFields);
  if ('any' in condition) return condition.any.flatMap(conditionFields);
  if ('not' in condition) return conditionFields(condition.not);
  return [condition.field];
}

const own = (values: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;

/** The server's comparison (`changedKeys`): by JSON, so an array or a composite compares by value. */
export function fieldValueChanged(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

const STRING_TYPES: ReadonlySet<FieldValueType> = new Set(['string', 'string[]', 'enum', 'enum[]', 'reference', 'reference[]', 'date', 'datetime']);

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** The single module that set `validation` on the field, whose bundle holds its `messageKey`. */
function validationModule(field: EffectiveField): string | undefined {
  const setters = field.overriddenBy.filter((entry) => entry.kinds.includes('validation'));
  return setters.length === 1 ? setters[0]!.module : undefined;
}

/**
 * The rules a present value breaks — the server's `violationsOf`, element by
 * element on an array, a pattern tested anywhere in the value with the `u`
 * flag. An empty value breaks only `required`, which the caller decides.
 */
function violationsOf(type: FieldValueType, field: EffectiveField, value: unknown): Omit<ClientFieldViolation, 'path'>[] {
  if (isEmptyFieldValue(value)) return [];
  const rules = field.validation ?? {};
  const message = rules.messageKey === undefined ? {} : { messageKey: rules.messageKey, ...(validationModule(field) === undefined ? {} : { messageModule: validationModule(field)! }) };
  const found: Omit<ClientFieldViolation, 'path'>[] = [];
  const once = (violation: Omit<ClientFieldViolation, 'path'>): void => {
    if (!found.some((existing) => existing.code === violation.code)) found.push({ ...violation, ...message });
  };
  const wholeNumber = type === 'decimal' && field.control === 'platform.integer';
  for (const element of Array.isArray(value) ? value : [value]) {
    if (typeof element === 'string' && STRING_TYPES.has(type)) {
      if (rules.minLength !== undefined && element.length < rules.minLength) once({ code: 'too_short', params: { limit: rules.minLength } });
      if (rules.maxLength !== undefined && element.length > rules.maxLength) once({ code: 'too_long', params: { limit: rules.maxLength } });
      if (rules.pattern !== undefined && !new RegExp(rules.pattern, 'u').test(element)) once({ code: 'pattern' });
      if (rules.format !== undefined && checkPlatformFieldFormat(rules.format, element) === false) {
        once({ code: 'format', params: { format: rules.format } });
      }
    }
    if (rules.options !== undefined && (typeof element === 'string' || typeof element === 'number')) {
      if (!rules.options.includes(String(element))) once({ code: 'not_an_option' });
    }
    if (type === 'integer' || type === 'decimal') {
      const number = numberOf(element);
      if (number !== null && rules.min !== undefined && number < rules.min) once({ code: 'below_min', params: { limit: rules.min } });
      if (number !== null && rules.max !== undefined && number > rules.max) once({ code: 'above_max', params: { limit: rules.max } });
      if (number !== null && wholeNumber && !Number.isInteger(number)) once({ code: 'format', params: { format: 'integer' } });
    }
  }
  return found;
}

/** Whether the effective field is required for these values: tightened `required`, or a true `requiredWhen`. */
export function isEffectivelyRequired(field: EffectiveField | undefined, values: Readonly<Record<string, unknown>>): boolean {
  if (field === undefined) return false;
  return field.validation?.required === true || (field.requiredWhen !== undefined && evaluateFieldCondition(field.requiredWhen, values));
}

/** The effective rules the submission breaks, over the server's held set (D-300.11). */
export function clientFieldViolations(input: ClientFieldViolationsInput): ClientFieldViolation[] {
  const types = new Map(input.fieldSet.fields.map((field) => [field.key as string, field.type]));
  const initial = input.initialValues ?? {};
  const isCreate = input.mode === 'create';
  const changed = (key: string): boolean => fieldValueChanged(own(initial, key), own(input.values, key));
  const keys = new Set(input.keys);
  const violations: ClientFieldViolation[] = [];
  for (const field of input.fields) {
    if (!keys.has(field.key)) continue;
    const touched = isCreate || changed(field.key);
    const condition = field.requiredWhen;
    const conditionHeld = condition !== undefined && (touched || conditionFields(condition).some(changed));
    if (!touched && !conditionHeld) continue;
    const value = own(input.values, field.key);
    const required =
      (touched && field.validation?.required === true) || (conditionHeld && evaluateFieldCondition(condition!, input.values));
    if (required && isEmptyFieldValue(value)) {
      const message = field.validation?.messageKey === undefined ? {} : { messageKey: field.validation.messageKey, ...(validationModule(field) === undefined ? {} : { messageModule: validationModule(field)! }) };
      violations.push({ path: field.key, code: 'required', ...message });
    }
    if (!touched) continue;
    for (const violation of violationsOf(types.get(field.key) ?? 'string', field, value)) {
      violations.push({ path: field.key, ...violation });
    }
  }
  return violations;
}
