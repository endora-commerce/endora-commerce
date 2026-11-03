import type { z } from 'zod';
import { isCalendarDate } from './common.js';
import { normalizeEmailAddress } from './email-address.js';
import {
  FORM_CONDITION_OPERATORS_BY_TYPE,
  FORM_CONSENT_TYPES,
  FORM_DATETIME_PATTERNS,
  FORM_LAYOUT_ELEMENT_TYPES,
  FORMS_LIMITS,
  type answerValueSchema,
  type FormCondition,
  type FormDefinition,
  type FormDefinitionIssue,
  type FormDefinitionIssueCode,
  type FormField,
  type FormFieldErrorCode,
  type FormFieldType,
  type FormInputField,
  type VisibilityRule,
} from './forms.js';

/**
 * The forms evaluator (`specs/170-forms-module/contracts/form-definition.md` §2–§3): visibility,
 * the publish rules, server-authoritative validation, text resolution and the small helpers the
 * entry pipeline shares. **Pure and browser-safe** — no Node built-in, no I/O — because the backend,
 * the storefront renderer and the admin preview must evaluate one implementation (research R-5);
 * the shared fixture set beside this file is run by all three (B12).
 */

export type AnswerValue = z.infer<typeof answerValueSchema>;

/** A visible consent as the shopper answered it; the server attaches the text shown (B11). */
export interface ConsentInput {
  fieldKey: string;
  kind: 'privacy' | 'marketing' | 'terms';
  given: boolean;
}

export interface SubmissionContext {
  /** Validates a country code; the server passes the dictionary check, the client a set lookup. */
  isKnownCountry(code: string): boolean;
  /** "Now" for date bounds that are relative — none in Phase 1; reserved for determinism in tests. */
  now?: Date;
}

export type SubmissionResult =
  | { ok: true; answers: Record<string, AnswerValue>; consents: ConsentInput[] }
  | { ok: false; errors: { fieldKey: string; code: FormFieldErrorCode }[] };

// --- Shared reading of a definition ------------------------------------------------------------

/**
 * The part of a definition visibility reads. Structural, so the storefront renderer can evaluate
 * the **public** read (whose fields carry the same ids, keys, types and rules) with this function.
 */
export interface VisibilitySource {
  readonly sections: readonly {
    readonly id: string;
    readonly visibility?: VisibilityRule | undefined;
    readonly fields: readonly {
      readonly id: string;
      readonly type: FormFieldType;
      readonly key?: string;
      readonly visibility?: VisibilityRule | undefined;
    }[];
  }[];
}

type SourceField = VisibilitySource['sections'][number]['fields'][number];

const LAYOUT_TYPES: ReadonlySet<string> = new Set(FORM_LAYOUT_ELEMENT_TYPES);
const CONSENT_TYPES: ReadonlySet<string> = new Set(FORM_CONSENT_TYPES);
const TEXT_LIKE_TYPES: ReadonlySet<string> = new Set(['text', 'email', 'phone', 'textarea', 'hidden']);
const BOOLEAN_TYPES: ReadonlySet<string> = new Set(['checkbox', ...FORM_CONSENT_TYPES]);

const isLayout = (type: string): boolean => LAYOUT_TYPES.has(type);

const nonBlank = (value: string | undefined): string | undefined =>
  value !== undefined && value.trim() !== '' ? value : undefined;

function isInputField(field: FormField): field is FormInputField {
  return !isLayout(field.type);
}

/**
 * The elements that sit on a dependency cycle. Edges: an element → every field its rule names, and a
 * field → its section (a field is visible only inside a visible section). Tarjan's SCC; an element
 * is cyclic when its component has more than one member or it names itself.
 */
function cyclicElements(source: VisibilitySource): Set<string> {
  const edges = new Map<string, string[]>();
  const known = new Set<string>();
  for (const section of source.sections) {
    known.add(section.id);
    edges.set(section.id, section.visibility ? section.visibility.groups.flat().map((c) => c.fieldId) : []);
    for (const field of section.fields) {
      known.add(field.id);
      const named = field.visibility ? field.visibility.groups.flat().map((c) => c.fieldId) : [];
      edges.set(field.id, [section.id, ...named]);
    }
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cyclic = new Set<string>();
  let next = 0;

  const connect = (node: string): void => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of edges.get(node) ?? []) {
      if (!known.has(target)) continue;
      if (!index.has(target)) {
        connect(target);
        low.set(node, Math.min(low.get(node)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node)!, index.get(target)!));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || (edges.get(node) ?? []).includes(node)) {
      for (const id of component) cyclic.add(id);
    }
  };

  for (const id of known) if (!index.has(id)) connect(id);
  return cyclic;
}

// --- Condition evaluation ----------------------------------------------------------------------

/** A hidden or unknown field's value: empty for every test (B3). */
const EMPTY = Symbol('empty');
type ConditionValue = typeof EMPTY | string | number | boolean | string[] | null;

const firstString = (raw: unknown): string => {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : '';
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
};

const stringList = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter((v) => v !== '');
};

const isTicked = (raw: unknown): boolean => {
  if (raw === true) return true;
  const value = firstString(raw).trim().toLowerCase();
  return value === 'on' || value === 'true';
};

/** `.` or `,` decimal; anything else is not a number (B5). */
function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const value = firstString(raw).trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(value)) return null;
  return Number(value.replace(',', '.'));
}

/** A field's value as a condition reads it, from raw posted values or normalised answers alike (B2). */
function readValue(field: SourceField, answers: Readonly<Record<string, unknown>>): ConditionValue {
  const key = field.key ?? '';
  const raw = answers[key];
  if (field.type === 'number') return parseNumber(raw);
  if (field.type === 'checkboxes') return stringList(raw);
  if (BOOLEAN_TYPES.has(field.type)) return isTicked(raw);
  if (field.type === 'address') {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return Object.values(raw).some((v) => typeof v === 'string' && v.trim() !== '');
    }
    return Object.keys(answers).some((k) => k.startsWith(`${key}.`) && firstString(answers[k]).trim() !== '');
  }
  return firstString(raw).trim();
}

function isEmptyValue(value: ConditionValue): boolean {
  if (value === EMPTY || value === null || value === false) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function equalsValue(field: SourceField | undefined, value: ConditionValue, expected: FormCondition['value']): boolean {
  if (value === EMPTY || value === null) return false;
  const wanted = expected === undefined ? '' : String(expected);
  if (typeof value === 'boolean') return (value ? 'true' : 'false') === wanted.trim().toLowerCase();
  if (typeof value === 'number') {
    const n = parseNumber(wanted);
    return n !== null && n === value;
  }
  if (Array.isArray(value)) return value.includes(wanted.trim());
  if (value === '') return false;
  if (field && (TEXT_LIKE_TYPES.has(field.type) || field.type === 'country')) {
    return value.toLowerCase() === wanted.trim().toLowerCase();
  }
  return value === wanted.trim();
}

function compareValue(value: ConditionValue, expected: FormCondition['value']): number | null {
  if (value === EMPTY || value === null) return null;
  if (typeof value === 'number') {
    const n = parseNumber(expected === undefined ? '' : expected);
    return n === null ? null : value - n;
  }
  if (typeof value === 'string' && value !== '' && expected !== undefined) {
    const wanted = String(expected).trim();
    return value < wanted ? -1 : value > wanted ? 1 : 0;
  }
  return null;
}

function containsValue(value: ConditionValue, expected: FormCondition['value']): boolean {
  if (value === EMPTY || value === null || expected === undefined) return false;
  const wanted = String(expected).trim();
  if (Array.isArray(value)) return value.includes(wanted);
  if (typeof value === 'string') return wanted !== '' && value.toLowerCase().includes(wanted.toLowerCase());
  return false;
}

function conditionHolds(condition: FormCondition, field: SourceField | undefined, value: ConditionValue): boolean {
  switch (condition.operator) {
    case 'is_empty':
      return isEmptyValue(value);
    case 'is_not_empty':
      return !isEmptyValue(value);
    case 'equals':
      return equalsValue(field, value, condition.value);
    case 'not_equals':
      return !equalsValue(field, value, condition.value);
    case 'greater_than': {
      const order = compareValue(value, condition.value);
      return order !== null && order > 0;
    }
    case 'less_than': {
      const order = compareValue(value, condition.value);
      return order !== null && order < 0;
    }
    case 'contains':
      return containsValue(value, condition.value);
    case 'not_contains':
      return !containsValue(value, condition.value);
  }
}

/** `and`: any group whose conditions all hold. `or`: every group with a condition that holds (FR-030). */
function ruleHolds(rule: VisibilityRule, holds: (condition: FormCondition) => boolean): boolean {
  return rule.connective === 'and'
    ? rule.groups.some((group) => group.every(holds))
    : rule.groups.every((group) => group.some(holds));
}

// --- visibleElements ---------------------------------------------------------------------------

/** Element ids visible for these answers (sections and fields), FR-030–FR-032. */
export function visibleElements(
  definition: VisibilitySource,
  answers: Readonly<Record<string, unknown>>,
): { sections: ReadonlySet<string>; fields: ReadonlySet<string> } {
  const cyclic = cyclicElements(definition);
  const fieldById = new Map<string, SourceField>();
  const sectionOf = new Map<string, string>();
  const sectionById = new Map<string, VisibilitySource['sections'][number]>();
  for (const section of definition.sections) {
    sectionById.set(section.id, section);
    for (const field of section.fields) {
      fieldById.set(field.id, field);
      sectionOf.set(field.id, section.id);
    }
  }

  const memo = new Map<string, boolean>();

  const valueOf = (fieldId: string): { field: SourceField | undefined; value: ConditionValue } => {
    const field = fieldById.get(fieldId);
    if (!field || isLayout(field.type) || !fieldVisible(fieldId)) return { field, value: EMPTY };
    return { field, value: readValue(field, answers) };
  };

  const holds = (rule: VisibilityRule | undefined): boolean =>
    rule === undefined ||
    ruleHolds(rule, (condition) => {
      const { field, value } = valueOf(condition.fieldId);
      return conditionHolds(condition, field, value);
    });

  // No element on a cycle is ever evaluated (B4), so the recursion below terminates.
  const sectionVisible = (sectionId: string): boolean => {
    const cached = memo.get(sectionId);
    if (cached !== undefined) return cached;
    const visible = !cyclic.has(sectionId) && holds(sectionById.get(sectionId)?.visibility);
    memo.set(sectionId, visible);
    return visible;
  };

  function fieldVisible(fieldId: string): boolean {
    const cached = memo.get(fieldId);
    if (cached !== undefined) return cached;
    const field = fieldById.get(fieldId);
    const sectionId = sectionOf.get(fieldId);
    const visible =
      field !== undefined &&
      sectionId !== undefined &&
      !cyclic.has(fieldId) &&
      sectionVisible(sectionId) &&
      holds(field.visibility);
    memo.set(fieldId, visible);
    return visible;
  }

  const sections = new Set<string>();
  const fields = new Set<string>();
  for (const section of definition.sections) {
    if (sectionVisible(section.id)) sections.add(section.id);
    for (const field of section.fields) if (fieldVisible(field.id)) fields.add(field.id);
  }
  return { sections, fields };
}

// --- definitionIssues --------------------------------------------------------------------------

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An absolute `http(s)` address: a scheme, a host, then anything without whitespace. A pattern
 * rather than `new URL()`, because this file runs in the browser and in Node alike and the
 * package's program declares neither runtime's globals.
 */
const ABSOLUTE_HTTP_URL = /^https?:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/i;

function isAbsoluteHttpUrl(value: string): boolean {
  return value.length <= FORMS_LIMITS.pageUrlChars && ABSOLUTE_HTTP_URL.test(value);
}

/**
 * The publish-time rules; `[]` = publishable (data-model §3.5, FR-011, FR-033). The default
 * language is the form row's (it is live, not part of the definition), so it is passed in.
 */
export function definitionIssues(definition: FormDefinition, defaultLanguage: string): FormDefinitionIssue[] {
  const issues: FormDefinitionIssue[] = [];
  const issue = (code: FormDefinitionIssueCode, elementId: string | null, path: string): void => {
    issues.push({ code, elementId, path });
  };

  const fieldById = new Map<string, FormField>();
  for (const section of definition.sections) for (const field of section.fields) fieldById.set(field.id, field);

  if (definition.sections.length > FORMS_LIMITS.sectionsPerForm) issue('too_many_sections', null, 'sections');
  const fieldCount = definition.sections.reduce((n, s) => n + s.fields.length, 0);
  if (fieldCount > FORMS_LIMITS.fieldsPerForm) issue('too_many_fields', null, 'sections');

  const checkRule = (rule: VisibilityRule | undefined, elementId: string, path: string): void => {
    if (!rule) return;
    if (rule.groups.length > FORMS_LIMITS.groupsPerRule || rule.groups.flat().length > FORMS_LIMITS.conditionsPerRule) {
      issue('too_many_conditions', elementId, `${path}.visibility`);
    }
    rule.groups.forEach((group, g) =>
      group.forEach((condition, c) => {
        const at = `${path}.visibility.groups[${g}][${c}]`;
        const target = fieldById.get(condition.fieldId);
        if (!target) issue('unknown_condition_field', elementId, at);
        else if (isLayout(target.type)) issue('condition_on_layout_element', elementId, at);
        else if (!FORM_CONDITION_OPERATORS_BY_TYPE[target.type].includes(condition.operator)) {
          issue('operator_not_allowed', elementId, at);
        }
      }),
    );
  };

  const seenKeys = new Set<string>();
  let submitterEmails = 0;
  const labels = definition.texts[defaultLanguage] ?? {};

  definition.sections.forEach((section, s) => {
    const sectionPath = `sections[${s}]`;
    checkRule(section.visibility, section.id, sectionPath);
    section.fields.forEach((field, f) => {
      const path = `${sectionPath}.fields[${f}]`;
      if (field.width > section.columns) issue('width_exceeds_columns', field.id, `${path}.width`);
      checkRule(field.visibility, field.id, path);
      if (!isInputField(field)) return;

      if (!KEY_PATTERN.test(field.key)) issue('invalid_key', field.id, `${path}.key`);
      else if (seenKeys.has(field.key)) issue('duplicate_key', field.id, `${path}.key`);
      seenKeys.add(field.key);

      if (field.type !== 'hidden') {
        const label = CONSENT_TYPES.has(field.type)
          ? (nonBlank(labels[`fields.${field.id}.content`]) ?? nonBlank(labels[`fields.${field.id}.label`]))
          : nonBlank(labels[`fields.${field.id}.label`]);
        if (label === undefined) issue('missing_default_language_label', field.id, `texts.${defaultLanguage}`);
      }

      switch (field.type) {
        case 'select':
        case 'radio':
        case 'checkboxes': {
          if (field.options.length === 0) issue('missing_options', field.id, `${path}.options`);
          if (field.options.length > FORMS_LIMITS.optionsPerChoice) issue('too_many_options', field.id, `${path}.options`);
          const values = new Set<string>();
          field.options.forEach((option, o) => {
            if (values.has(option.value)) issue('duplicate_option_value', field.id, `${path}.options[${o}].value`);
            values.add(option.value);
          });
          if (
            field.type === 'checkboxes' &&
            field.minSelected !== undefined &&
            field.maxSelected !== undefined &&
            field.minSelected > field.maxSelected
          ) {
            issue('min_above_max', field.id, `${path}.minSelected`);
          }
          break;
        }
        case 'text':
        case 'textarea':
          if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
            issue('min_above_max', field.id, `${path}.minLength`);
          }
          break;
        case 'number':
          if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
            issue('min_above_max', field.id, `${path}.min`);
          }
          break;
        case 'datetime':
          if (field.earliest !== undefined && field.latest !== undefined && field.earliest > field.latest) {
            issue('min_above_max', field.id, `${path}.earliest`);
          }
          break;
        case 'email':
          if (field.submitterEmail) {
            submitterEmails += 1;
            if (submitterEmails > 1) issue('multiple_submitter_email', field.id, `${path}.submitterEmail`);
          }
          break;
        case 'privacy_consent':
        case 'terms':
          if (!field.required) issue('consent_must_be_required', field.id, `${path}.required`);
          break;
        case 'marketing_consent':
          if (field.required) issue('marketing_consent_required', field.id, `${path}.required`);
          break;
        default:
          break;
      }
    });
  });

  const cyclic = cyclicElements(definition);
  definition.sections.forEach((section, s) => {
    if (cyclic.has(section.id)) issue('cyclic_visibility', section.id, `sections[${s}].visibility`);
    section.fields.forEach((field, f) => {
      if (cyclic.has(field.id)) issue('cyclic_visibility', field.id, `sections[${s}].fields[${f}].visibility`);
    });
  });

  const confirmation = definition.behaviour.confirmation;
  if (confirmation.type === 'redirect' && !isAbsoluteHttpUrl(confirmation.url)) {
    issue('invalid_redirect_url', null, 'behaviour.confirmation.url');
  }
  if (confirmation.type === 'page' && !UUID_PATTERN.test(confirmation.cmsPageId)) {
    issue('invalid_page_reference', null, 'behaviour.confirmation.cmsPageId');
  }

  const { availableFrom, availableUntil } = definition.restrictions;
  if (availableFrom !== null && availableUntil !== null && Date.parse(availableUntil) <= Date.parse(availableFrom)) {
    issue('invalid_window', null, 'restrictions.availableUntil');
  }

  return issues;
}

// --- validateSubmission ------------------------------------------------------------------------

const PHONE_PATTERN = /^\+?[0-9][0-9 ()./-]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINE_BREAK = /[\r\n]/;

const TEXT_PATTERNS: Readonly<Record<'digits' | 'letters' | 'alphanumeric', RegExp>> = {
  digits: /^[0-9]+$/,
  letters: /^\p{L}+$/u,
  alphanumeric: /^[\p{L}0-9]+$/u,
};

function matchesPattern(pattern: 'digits' | 'letters' | 'alphanumeric' | 'url', value: string): boolean {
  return pattern === 'url' ? isAbsoluteHttpUrl(value) : TEXT_PATTERNS[pattern].test(value);
}

const CONSENT_KIND: Readonly<Record<string, ConsentInput['kind']>> = {
  privacy_consent: 'privacy',
  marketing_consent: 'marketing',
  terms: 'terms',
};

type FieldOutcome = { value: AnswerValue } | { skip: true } | { errors: { fieldKey: string; code: FormFieldErrorCode }[] };

const fail = (fieldKey: string, code: FormFieldErrorCode): FieldOutcome => ({ errors: [{ fieldKey, code }] });
const SKIP: FieldOutcome = { skip: true };

/** Length checks of a string answer: the field's own limits, then the global cap (B7). */
function lengthError(
  value: string,
  limits: { minLength?: number | undefined; maxLength?: number | undefined },
  cap: number,
): FormFieldErrorCode | null {
  if (limits.minLength !== undefined && value.length < limits.minLength) return 'too_short';
  if (limits.maxLength !== undefined && value.length > limits.maxLength) return 'too_long';
  if (value.length > cap) return 'too_long';
  return null;
}

function validateField(
  field: FormInputField,
  raw: Readonly<Record<string, string | readonly string[]>>,
  ctx: SubmissionContext,
): FieldOutcome {
  const key = field.key;
  const single = firstString(raw[key]).trim();
  const required = field.required;

  switch (field.type) {
    case 'text': {
      if (LINE_BREAK.test(single)) return fail(key, 'single_line');
      if (single === '') return required ? fail(key, 'required') : SKIP;
      const length = lengthError(single, field, FORMS_LIMITS.singleLineChars);
      if (length) return fail(key, length);
      if (field.pattern && !matchesPattern(field.pattern, single)) return fail(key, 'pattern');
      return { value: single };
    }
    case 'email': {
      if (LINE_BREAK.test(single)) return fail(key, 'single_line');
      if (single === '') return required ? fail(key, 'required') : SKIP;
      if (single.length > FORMS_LIMITS.singleLineChars) return fail(key, 'too_long');
      const email = normalizeEmailAddress(single);
      if (email.length > 320 || !EMAIL_PATTERN.test(email)) return fail(key, 'invalid_email');
      return { value: email };
    }
    case 'phone': {
      if (LINE_BREAK.test(single)) return fail(key, 'single_line');
      if (single === '') return required ? fail(key, 'required') : SKIP;
      const digits = single.replace(/[^0-9]/g, '').length;
      if (!PHONE_PATTERN.test(single) || digits < 4) return fail(key, 'invalid_phone');
      return { value: single };
    }
    case 'number': {
      if (single === '') return required ? fail(key, 'required') : SKIP;
      const value = parseNumber(single);
      if (value === null) return fail(key, 'invalid_number');
      if (field.min !== undefined && value < field.min) return fail(key, 'below_min');
      if (field.max !== undefined && value > field.max) return fail(key, 'above_max');
      if (field.step !== undefined) {
        const steps = (value - (field.min ?? 0)) / field.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-9) return fail(key, 'step_mismatch');
      }
      return { value };
    }
    case 'textarea': {
      if (single === '') return required ? fail(key, 'required') : SKIP;
      const length = lengthError(single, field, FORMS_LIMITS.multiLineChars);
      if (length) return fail(key, length);
      return { value: single };
    }
    case 'select':
    case 'radio': {
      if (LINE_BREAK.test(single)) return fail(key, 'single_line');
      if (single === '') return required ? fail(key, 'required') : SKIP;
      if (!field.options.some((option) => option.value === single)) return fail(key, 'unknown_option');
      return { value: single };
    }
    case 'checkboxes': {
      const chosen = new Set(stringList(raw[key]));
      if (chosen.size === 0) return required ? fail(key, 'required') : SKIP;
      const values = field.options.map((option) => option.value);
      if ([...chosen].some((value) => !values.includes(value))) return fail(key, 'unknown_option');
      if (field.minSelected !== undefined && chosen.size < field.minSelected) return fail(key, 'too_few');
      if (field.maxSelected !== undefined && chosen.size > field.maxSelected) return fail(key, 'too_many');
      return { value: values.filter((value) => chosen.has(value)) };
    }
    case 'checkbox': {
      const ticked = isTicked(raw[key]);
      if (!ticked && required) return fail(key, 'required');
      return { value: ticked };
    }
    case 'datetime': {
      if (LINE_BREAK.test(single)) return fail(key, 'single_line');
      if (single === '') return required ? fail(key, 'required') : SKIP;
      if (!FORM_DATETIME_PATTERNS[field.mode].test(single)) return fail(key, 'invalid_date');
      if (field.mode !== 'time' && !isCalendarDate(single.slice(0, 10))) return fail(key, 'invalid_date');
      if (field.earliest !== undefined && single < field.earliest) return fail(key, 'too_early');
      if (field.latest !== undefined && single > field.latest) return fail(key, 'too_late');
      return { value: single };
    }
    case 'country': {
      if (LINE_BREAK.test(single)) return fail(key, 'single_line');
      if (single === '') return required ? fail(key, 'required') : SKIP;
      const code = single.toUpperCase();
      const allowed = field.allowedCountries === undefined || field.allowedCountries.includes(code);
      if (!allowed || !/^[A-Z]{2}$/.test(code) || !ctx.isKnownCountry(code)) return fail(key, 'invalid_country');
      return { value: code };
    }
    case 'address': {
      const parts = Object.entries(field.parts).filter(([, part]) => part.enabled) as [
        keyof typeof field.parts,
        { enabled: boolean; required: boolean },
      ][];
      const typed = parts.map(([name]) => [name, firstString(raw[`${key}.${name}`]).trim()] as const);
      const anyTyped = typed.some(([, value]) => value !== '');
      if (!anyTyped && !required) return SKIP;
      const errors: { fieldKey: string; code: FormFieldErrorCode }[] = [];
      const answer: Record<string, string> = {};
      for (const [name, value] of typed) {
        const partKey = `${key}.${name}`;
        const part = field.parts[name];
        if (LINE_BREAK.test(value)) errors.push({ fieldKey: partKey, code: 'single_line' });
        else if (value === '') {
          if (part.required) errors.push({ fieldKey: partKey, code: 'required' });
        } else if (value.length > FORMS_LIMITS.singleLineChars) errors.push({ fieldKey: partKey, code: 'too_long' });
        else if (name === 'country') {
          const code = value.toUpperCase();
          if (!/^[A-Z]{2}$/.test(code) || !ctx.isKnownCountry(code)) {
            errors.push({ fieldKey: partKey, code: 'invalid_country' });
          } else answer[name] = code;
        } else answer[name] = value;
      }
      return errors.length > 0 ? { errors } : { value: answer };
    }
    case 'hidden': {
      // Never required: the shopper cannot fill a hidden field. Over the cap it is truncated,
      // not refused (the spec's edge case) — the value came from the page, not from the shopper.
      if (LINE_BREAK.test(single)) return fail(key, 'single_line');
      if (single === '') return SKIP;
      return { value: single.slice(0, FORMS_LIMITS.hiddenChars) };
    }
    case 'privacy_consent':
    case 'terms': {
      const given = isTicked(raw[key]);
      if (!given) return fail(key, 'consent_required');
      return { value: true };
    }
    case 'marketing_consent':
      return { value: isTicked(raw[key]) };
  }
}

/**
 * Server-authoritative validation of raw posted values against a version: drops values of hidden
 * and unknown fields, coerces by type, applies required/limits/patterns, and returns either the
 * normalised answers + consents or per-field errors. FR-032, FR-034, FR-036.
 */
export function validateSubmission(
  definition: FormDefinition,
  raw: Readonly<Record<string, string | readonly string[]>>,
  ctx: SubmissionContext,
): SubmissionResult {
  const visible = visibleElements(definition, raw);
  const answers: Record<string, AnswerValue> = {};
  const consents: ConsentInput[] = [];
  const errors: { fieldKey: string; code: FormFieldErrorCode }[] = [];

  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (!isInputField(field) || !visible.fields.has(field.id)) continue;
      const outcome = validateField(field, raw, ctx);
      if ('errors' in outcome) {
        errors.push(...outcome.errors);
        continue;
      }
      if ('skip' in outcome) continue;
      answers[field.key] = outcome.value;
      const kind = CONSENT_KIND[field.type];
      if (kind) consents.push({ fieldKey: field.key, kind, given: outcome.value === true });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers, consents };
}

// --- Texts -------------------------------------------------------------------------------------

/** Texts for one language with the R-7 fallback; built-ins are the caller's. */
export function resolveTexts(
  definition: Pick<FormDefinition, 'texts'>,
  language: string,
  defaultLanguage: string,
): (textId: string) => string | undefined {
  const own = definition.texts[language] ?? {};
  const fallback = definition.texts[defaultLanguage] ?? {};
  return (textId) => nonBlank(own[textId]) ?? nonBlank(fallback[textId]);
}

/** A text id that names an element no longer in the definition is not owed a translation. */
function isLiveTextId(textId: string, elementIds: ReadonlySet<string>): boolean {
  const match = /^(fields|sections)\.([^.]+)\./.exec(textId);
  return match === null || elementIds.has(match[2]!);
}

/** Per language, the text ids that fall back to the default language. FR-018, US7-2. */
export function textCompleteness(
  definition: FormDefinition,
  languages: readonly string[],
  defaultLanguage: string,
): { language: string; missing: string[] }[] {
  const elementIds = new Set(definition.sections.flatMap((s) => [s.id, ...s.fields.map((f) => f.id)]));
  const source = definition.texts[defaultLanguage] ?? {};
  const owed = Object.keys(source)
    .filter((id) => nonBlank(source[id]) !== undefined && isLiveTextId(id, elementIds))
    .sort();
  return languages.map((language) => {
    if (language === defaultLanguage) return { language, missing: [] };
    const own = definition.texts[language] ?? {};
    return { language, missing: owed.filter((id) => nonBlank(own[id]) === undefined) };
  });
}

// --- Entry helpers -----------------------------------------------------------------------------

function inputFields(definition: FormDefinition): FormInputField[] {
  return definition.sections.flatMap((section) => section.fields.filter(isInputField));
}

/** The answers that `shareWithIntegrations` fields of this version expose. FR-064. */
export function sharedAnswers(
  definition: FormDefinition,
  answers: Readonly<Record<string, AnswerValue>>,
): Record<string, AnswerValue> {
  const shared: Record<string, AnswerValue> = {};
  for (const field of inputFields(definition)) {
    if (field.shareWithIntegrations && Object.prototype.hasOwnProperty.call(answers, field.key)) {
      shared[field.key] = answers[field.key]!;
    }
  }
  return shared;
}

const SEARCHABLE_TYPES: ReadonlySet<string> = new Set(['text', 'textarea', 'email', 'phone']);

/** Text answers joined for search, lower-cased, capped. R-18 (hidden values excluded). */
export function searchTextOf(definition: FormDefinition, answers: Readonly<Record<string, AnswerValue>>): string {
  const parts: string[] = [];
  for (const field of inputFields(definition)) {
    const value = answers[field.key];
    if (SEARCHABLE_TYPES.has(field.type) && typeof value === 'string' && value !== '') parts.push(value.toLowerCase());
  }
  return parts.join('\n').slice(0, FORMS_LIMITS.searchTextChars);
}

/** One CSV-safe cell: prefixes =, +, -, @, TAB, CR with an apostrophe. R-18. */
export function neutraliseSpreadsheetCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
