import {
  customFieldDefinitionSchema,
  type CustomFieldAdminAccess,
  type CustomFieldAudience,
  type CustomFieldOptionDto,
  type CustomFieldValueType,
  type LocalizedLabel,
} from '@endora-commerce/contracts';

/**
 * The checks the definition form runs before it sends anything (issue #447).
 * They are the same in the create and the edit view; what differs is only what
 * each view lets the operator change — the key is fixed once a field exists,
 * and an existing field's options are saved one action at a time, so in the
 * edit view they are checked as each action is made (`optionValueIssue`,
 * `singleDefaultConflict`) rather than here.
 *
 * Every issue is a bundle key of this module's namespace, so the form says it
 * in the operator's language and never shows a code.
 */

const SELECT_TYPES: ReadonlySet<CustomFieldValueType> = new Set(['select', 'multiselect']);

export function hasOptions(valueType: CustomFieldValueType): boolean {
  return SELECT_TYPES.has(valueType);
}

/**
 * How many options may be marked as the default (the value a new record starts
 * with). The server stores the flag per option and enforces no count; the form
 * holds the one the value type implies: a single-choice field holds one value,
 * so it can start with one at most, while a multiple-choice field can start
 * with any of its options selected. None is always allowed.
 */
export function maxDefaultOptions(valueType: CustomFieldValueType): number {
  if (valueType === 'select') return 1;
  if (valueType === 'multiselect') return Number.POSITIVE_INFINITY;
  return 0;
}

/** What the form checks: the identity, the default label and the options. */
export interface DefinitionDraft {
  key: string;
  labelDefault: string;
  valueType: CustomFieldValueType;
  options: readonly CustomFieldOptionDto[];
}

export interface OptionIssues {
  value?: string;
  labelDefault?: string;
  isDefault?: string;
}

export interface DefinitionDraftIssues {
  key?: string;
  labelDefault?: string;
  /** About the option list as a whole — it is empty. */
  options?: string;
  /** Per option row, by its position in the list. */
  optionRows: Record<number, OptionIssues>;
}

/** The key the server accepts — the contract's own pattern, not a copy of it. */
const keySchema = customFieldDefinitionSchema.shape.key;

/** A new option's stored value: present, and not one another option already uses. */
export function optionValueIssue(value: string, otherValues: readonly string[]): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return 'customFields.validation.optionValueRequired';
  if (otherValues.some((other) => other.trim() === trimmed)) return 'customFields.validation.optionValueDuplicate';
  return undefined;
}

/**
 * The option already marked as the default when marking `value` would give a
 * single-choice field a second one; `null` when marking it is allowed.
 */
export function singleDefaultConflict(
  valueType: CustomFieldValueType,
  options: readonly CustomFieldOptionDto[],
  value: string,
): CustomFieldOptionDto | null {
  if (maxDefaultOptions(valueType) !== 1) return null;
  return options.find((option) => option.isDefault && option.value !== value) ?? null;
}

export function validateDefinitionDraft(draft: DefinitionDraft, mode: 'create' | 'edit'): DefinitionDraftIssues {
  const issues: DefinitionDraftIssues = { optionRows: {} };
  if (mode === 'create') {
    const key = draft.key.trim();
    if (key === '') issues.key = 'customFields.validation.keyRequired';
    else if (!keySchema.safeParse(key).success) issues.key = 'customFields.validation.keyFormat';
  }
  if (draft.labelDefault.trim() === '') issues.labelDefault = 'customFields.editor.labelDefaultRequired';
  // An existing field's options are checked one action at a time, as they are saved.
  if (mode === 'edit' || !hasOptions(draft.valueType)) return issues;

  if (draft.options.length === 0) issues.options = 'customFields.validation.optionsRequired';
  const limit = maxDefaultOptions(draft.valueType);
  let defaults = 0;
  draft.options.forEach((option, index) => {
    const row: OptionIssues = {};
    const earlier = draft.options.slice(0, index).map((other) => other.value);
    const valueIssue = optionValueIssue(option.value, earlier);
    if (valueIssue !== undefined) row.value = valueIssue;
    if (option.labelDefault.trim() === '') row.labelDefault = 'customFields.editor.labelDefaultRequired';
    if (option.isDefault && ++defaults > limit) row.isDefault = 'customFields.validation.singleDefault';
    if (Object.keys(row).length > 0) issues.optionRows[index] = row;
  });
  return issues;
}

export function hasIssues(issues: DefinitionDraftIssues): boolean {
  return (
    issues.key !== undefined ||
    issues.labelDefault !== undefined ||
    issues.options !== undefined ||
    Object.keys(issues.optionRows).length > 0
  );
}

/** The issue focus goes to, in the order the form shows its sections. */
export function firstIssue(
  issues: DefinitionDraftIssues,
): 'key' | 'labelDefault' | 'options' | { row: number; field: keyof OptionIssues } | null {
  if (issues.key !== undefined) return 'key';
  if (issues.labelDefault !== undefined) return 'labelDefault';
  if (issues.options !== undefined) return 'options';
  const rows = Object.keys(issues.optionRows)
    .map(Number)
    .sort((a, b) => a - b);
  const row = rows[0];
  if (row === undefined) return null;
  const fields = issues.optionRows[row]!;
  const field = (['value', 'labelDefault', 'isDefault'] as const).find((name) => fields[name] !== undefined)!;
  return { row, field };
}

/** `label` with surrounding spaces trimmed and the languages left empty dropped. */
export function trimmedLabel(label: LocalizedLabel): LocalizedLabel {
  const next: LocalizedLabel = {};
  for (const [language, text] of Object.entries(label)) {
    const trimmed = text.trim();
    if (trimmed !== '') next[language] = trimmed;
  }
  return next;
}

/** The draft options as the create request carries them: trimmed, numbered in their order. */
export function toCreateOptions(options: readonly CustomFieldOptionDto[]): CustomFieldOptionDto[] {
  return options.map((option, index) => ({
    value: option.value.trim(),
    labelDefault: option.labelDefault.trim(),
    label: trimmedLabel(option.label),
    isDefault: option.isDefault,
    sortOrder: index,
  }));
}

/**
 * Why the buyer-input option cannot be turned on for this definition, as a
 * bundle key; `null` when it can (feature 175, FR-035). The server refuses the
 * same two states (`customer_input_audience`, `customer_input_value_type`) —
 * the form says it before anything is sent.
 */
export function customerInputBlockReason(definition: {
  audience: CustomFieldAudience;
  valueType: CustomFieldValueType;
}): string | null {
  if (definition.valueType === 'page_builder') return 'customFields.customerInput.disabledPageBuilder';
  if (definition.audience !== 'customer') return 'customFields.customerInput.disabledAudience';
  return null;
}

/** The admin access levels, in the order the form offers them (feature 175). */
export const ADMIN_ACCESS_LEVELS: readonly CustomFieldAdminAccess[] = ['edit', 'read', 'hidden'];

/**
 * Whether `level` may be chosen alongside `required` — a required field stays
 * editable in the admin (SD-2; the server's `admin_access_required`).
 */
export function adminAccessAllowed(level: CustomFieldAdminAccess, required: boolean): boolean {
  return level === 'edit' || !required;
}
