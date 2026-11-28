import {
  OPERATOR_KINDS,
  applyFieldMoves,
  type FormLayoutMove,
  type EffectiveField,
  type EffectiveFormsResponse,
  type EffectiveText,
  type FieldCondition,
  type FieldDeclaration,
  type FieldOverrideKind,
  type FieldValidationTightening,
  type FormLayoutOverrideRow,
  type OperatorKind,
} from '@endora-commerce/contracts';
import { byCodePoint, mergeValidation } from './rules.js';
import type { SealedFieldSet, SealedForm, SealedForms, SealedOverride } from './seal.js';

/**
 * The effective forms (`specs/193-admin-form-extensions/` FR-023, FR-052,
 * FR-094, `contracts/field-overrides.md` §2, `operator-form-layout.md` §3,
 * `field-slots.md` §5 step 1): every present form's core fields, each with
 * what is in force on it — layered core → deployment code (or a granted
 * package) → the operator — for the admin to render from. Pure: the registry
 * memoises it per presence snapshot and operator-layer generation.
 *
 * Slot fields are not here: they are admin contributions, laid out by the kit
 * around these core keys. An operator row on a slot key is the kit's to apply.
 */

const SERVER_KINDS: ReadonlySet<FieldOverrideKind> = new Set(['validation', 'requiredWhen', 'writePermission']);

/** The module an operator layout move sorts as (`operator-form-layout.md` §3, R-24.6). */
const OPERATOR_LAYER_MODULE = 'custom_fields';

/** The operator kinds a stored row sets. */
function operatorKindsOf(row: FormLayoutOverrideRow): OperatorKind[] {
  const set: OperatorKind[] = [];
  if (row.labels !== null) set.push('label');
  if (row.helps !== null) set.push('help');
  if (row.placeholders !== null) set.push('placeholder');
  if (row.section !== null || row.before !== null || row.after !== null) set.push('position');
  if (row.hidden) set.push('hidden');
  if (row.readOnly) set.push('readOnly');
  return OPERATOR_KINDS.filter((kind) => set.includes(kind));
}

/**
 * A row in force on `field`, or `null` (operator-form-layout.md §3): every kind
 * it sets must be one the field accepts — a row holding one the field no
 * longer accepts is `no-longer-accepted` and ignored whole — and a required
 * field is never hidden.
 */
function rowInForce(row: FormLayoutOverrideRow | undefined, field: FieldDeclaration): { row: FormLayoutOverrideRow; kinds: OperatorKind[] } | null {
  if (row === undefined) return null;
  const kinds = operatorKindsOf(row);
  if (kinds.some((kind) => !field.accepts.includes(kind))) return null;
  if (row.hidden && field.required) return null;
  return { row, kinds };
}

/**
 * Several modules' patterns as one ECMAScript source that holds when all of
 * them do — each tested anywhere in the value, as the check tests them.
 */
function conjoinPatterns(patterns: readonly string[]): string {
  if (patterns.length === 1) return patterns[0]!;
  return `^${patterns.map((pattern) => `(?=[\\s\\S]*?(?:${pattern}))`).join('')}`;
}

function effectiveValidation(set: SealedFieldSet, key: string, isPresent: (moduleId: string) => boolean): {
  validation?: FieldValidationTightening;
  requiredWhen?: FieldCondition;
  writePermission?: string;
} {
  const contributions = (set.rules.get(key) ?? []).filter((contribution) => contribution.requires.every(isPresent));
  const merged = mergeValidation(contributions.flatMap((c) => (c.validation === undefined ? [] : [{ moduleId: c.moduleId, validation: c.validation }])));
  const validation: { -readonly [K in keyof FieldValidationTightening]: FieldValidationTightening[K] } = {};
  if (merged.required !== undefined) validation.required = true;
  if (merged.minLength !== undefined) validation.minLength = merged.minLength.value;
  if (merged.maxLength !== undefined) validation.maxLength = merged.maxLength.value;
  if (merged.min !== undefined) validation.min = merged.min.value;
  if (merged.max !== undefined) validation.max = merged.max.value;
  if (merged.patterns.length > 0) validation.pattern = conjoinPatterns(merged.patterns.map((pattern) => pattern.value));
  if (merged.options !== undefined) validation.options = [...merged.options.value];
  if (merged.formats.length > 0) validation.format = merged.formats[0]!.value;
  // One contributor's message key is that contributor's sentence for its own rule.
  const keys = new Set(contributions.flatMap((c) => (c.validation?.messageKey === undefined ? [] : [c.validation.messageKey])));
  if (keys.size === 1 && contributions.filter((c) => c.validation !== undefined).length === 1) validation.messageKey = [...keys][0]!;
  const conditions = contributions.flatMap((c) => (c.requiredWhen === undefined ? [] : [c.requiredWhen]));
  const writePermission = set.ownerWritePermissions.get(key) ?? contributions.find((c) => c.writePermission !== undefined)?.writePermission;
  return {
    ...(Object.keys(validation).length > 0 ? { validation } : {}),
    ...(conditions.length === 0 ? {} : { requiredWhen: conditions.length === 1 ? conditions[0]! : { any: conditions } }),
    ...(writePermission === undefined ? {} : { writePermission }),
  };
}

function text(sealed: SealedOverride | undefined, property: 'labelKey' | 'helpKey' | 'placeholderKey'): EffectiveText | undefined {
  const key = sealed?.override[property];
  return sealed === undefined || key === undefined ? undefined : { source: 'code', module: sealed.moduleId, key };
}

function formFields(set: SealedFieldSet, form: SealedForm, isPresent: (moduleId: string) => boolean, rows: ReadonlyMap<string, FormLayoutOverrideRow>): EffectiveField[] {
  const present = set.overrides.filter((sealed) => isPresent(sealed.moduleId));
  const onForm = (key: string) => present.filter((sealed) => sealed.fieldKey === key && sealed.forms.includes(form.id));

  const keys = form.sections.flatMap((section) => [...section.keys]);
  const operator = new Map<string, { row: FormLayoutOverrideRow; kinds: OperatorKind[] }>();
  for (const key of keys) {
    const inForce = rowInForce(rows.get(`${form.id}\0${key}`), set.field(key)!);
    if (inForce !== null) operator.set(key, inForce);
  }

  // Layout (D-300.14): contracts' one implementation. Each key's move is the
  // operator's when the row sets a position whose anchor or section is on the
  // form — sorting as module `custom_fields` (R-24.6) — and otherwise the code
  // override's (one per key and form; a second is `override-conflict`).
  const sectionKeys = new Set(form.sections.map((section) => section.key));
  const onTheForm = (row: FormLayoutOverrideRow): boolean => {
    const anchor = row.before ?? row.after;
    return anchor !== null ? keys.includes(anchor) && anchor !== row.fieldKey : row.section !== null && sectionKeys.has(row.section);
  };
  const moves: FormLayoutMove[] = [];
  for (const key of keys) {
    const fromOperator = operator.get(key);
    if (fromOperator !== undefined && fromOperator.kinds.includes('position') && onTheForm(fromOperator.row)) {
      const { row } = fromOperator;
      moves.push({
        moduleId: OPERATOR_LAYER_MODULE,
        key,
        ...(row.section === null ? {} : { section: row.section }),
        ...(row.before === null ? {} : { before: row.before }),
        ...(row.after === null ? {} : { after: row.after }),
      });
      continue;
    }
    const code = present.find((sealed) => sealed.fieldKey === key && sealed.forms.includes(form.id) && sealed.override.position !== undefined);
    if (code !== undefined) {
      const { section, before, after } = code.override.position!;
      moves.push({
        moduleId: code.moduleId,
        key,
        ...(section === undefined ? {} : { section }),
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
      });
    }
  }
  const layout = applyFieldMoves(form.sections, moves);

  let order = 0;
  const placed = new Map<string, { section: string; order: number }>();
  for (const section of layout) for (const key of section.keys) placed.set(key, { section: section.key, order: order++ });

  return [...placed.keys()].map((key): EffectiveField => {
    const field = set.field(key)!;
    const overrides = onForm(key);
    const pick = (kind: FieldOverrideKind) => overrides.find((sealed) => sealed.kinds.includes(kind));
    const inForce = operator.get(key);
    const opText = (kind: OperatorKind, value: Readonly<Record<string, string>> | null | undefined): EffectiveText | undefined =>
      inForce !== undefined && inForce.kinds.includes(kind) && value ? { source: 'operator', text: { ...value } } : undefined;
    const label = opText('label', inForce?.row.labels) ?? text(pick('label'), 'labelKey');
    const help = opText('help', inForce?.row.helps) ?? text(pick('help'), 'helpKey');
    const placeholder = opText('placeholder', inForce?.row.placeholders) ?? text(pick('placeholder'), 'placeholderKey');
    const control = pick('control');
    const controlId = control === undefined || (control.controlModuleId !== null && !isPresent(control.controlModuleId)) ? null : control.override.control!;
    const defaulted = pick('default');
    const visible = pick('visibleWhen');
    const hidden = !field.required && (overrides.some((sealed) => sealed.override.hidden === true) || (inForce?.row.hidden ?? false));
    const readOnly = overrides.some((sealed) => sealed.override.readOnly === true) || (inForce?.row.readOnly ?? false);

    // Who overrides it: presentation kinds on this form, server kinds everywhere.
    const by = new Map<string, { origin: SealedOverride['origin']; kinds: Set<FieldOverrideKind> }>();
    for (const sealed of present.filter((s) => s.fieldKey === key)) {
      const kinds = sealed.kinds.filter((kind) => SERVER_KINDS.has(kind) || sealed.forms.includes(form.id));
      if (kinds.length === 0) continue;
      const entry = by.get(sealed.moduleId) ?? { origin: sealed.origin, kinds: new Set<FieldOverrideKind>() };
      for (const kind of kinds) entry.kinds.add(kind);
      by.set(sealed.moduleId, entry);
    }
    const kindOrder = (kinds: Set<FieldOverrideKind>) => [...kinds].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

    return {
      key,
      ...(label === undefined ? {} : { label }),
      ...(help === undefined ? {} : { help }),
      ...(placeholder === undefined ? {} : { placeholder }),
      section: placed.get(key)!.section,
      order: placed.get(key)!.order,
      ...(defaulted === undefined ? {} : { default: defaulted.override.default }),
      readOnly,
      hidden,
      control: controlId,
      ...(visible === undefined ? {} : { visibleWhen: visible.override.visibleWhen! }),
      ...effectiveValidation(set, key, isPresent),
      overriddenBy: [...by]
        .sort(([a], [b]) => byCodePoint(a, b))
        .map(([module, entry]) => ({ module, origin: entry.origin, kinds: kindOrder(entry.kinds) })),
      operatorKinds: inForce === undefined ? [] : [...inForce.kinds],
    };
  });
}

const ORDER: readonly FieldOverrideKind[] = [
  'label', 'help', 'placeholder', 'position', 'default', 'readOnly', 'hidden', 'control', 'behaviour', 'visibleWhen', 'validation', 'requiredWhen', 'writePermission',
];

/**
 * The response for one presence snapshot and one set of operator rows. A form
 * is served while its field set's owner and its declaring module are both
 * present (FR-052, FR-098); a row on any other form is ignored and kept.
 */
export function computeEffectiveForms(
  sealed: SealedForms,
  isPresent: (moduleId: string) => boolean,
  operatorRows: readonly FormLayoutOverrideRow[],
): EffectiveFormsResponse {
  const rows = new Map(operatorRows.map((row) => [`${row.formId}\0${row.fieldKey}`, row]));
  const forms: EffectiveFormsResponse['forms'] = [];
  for (const form of sealed.forms) {
    const set = sealed.fieldSets.get(form.fieldSet)!;
    if (!isPresent(set.ownerModuleId) || !isPresent(form.moduleId)) continue;
    forms.push({ id: form.id, fieldSet: form.fieldSet, fields: formFields(set, form, isPresent, rows) });
  }
  return { forms };
}
