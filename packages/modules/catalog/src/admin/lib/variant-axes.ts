/**
 * Issue #1457 (UX audit CAT-04) — the variant axes of a configurable product and the values a
 * variant holds on them.
 *
 * A variant's `variantAttributeValues` hold one value per **variant axis**: an attribute of the
 * product's attribute set flagged `isVariantAxis`. The Variants tab offers one control per axis,
 * driven by the attribute's type and options, instead of a free-text `key=value` string that
 * nothing checked. Each value is stored in its attribute's own type — an option value, a
 * boolean, a number, a date or a string — the same way the product's own attribute values are,
 * because price books and the quote documents overlay a variant's values on its product's.
 *
 * Pure functions, so the rules are tested without rendering the editor.
 */

export interface VariantAxisOption {
  value: string;
  label: string;
}

export interface VariantAxis {
  id: string;
  key: string;
  /** The attribute's label in the admin language. */
  label: string;
  valueType: string;
  /** The options of an option-typed attribute, in sort order; `null` for any other type. */
  options: VariantAxisOption[] | null;
}

/** The attribute types whose values are option values. */
export const OPTION_VALUE_TYPES: ReadonlySet<string> = new Set(['enum', 'select', 'multiselect']);

/** The types a variant axis can never be: a Page Builder document is no discriminating value. */
const NON_AXIS_TYPES: ReadonlySet<string> = new Set(['page_builder']);

/** A label in the admin's language (`pl` reads `pl-PL`), then English, then any, then the fallback. */
export function pickAttributeLabel(label: Record<string, string>, fallback: string, language = 'en'): string {
  const entries = Object.entries(label);
  const own = entries.find(([code]) => code === language || code.split('-')[0] === language)?.[1];
  return own ?? label['en-US'] ?? entries[0]?.[1] ?? fallback;
}

export interface SetAttributeForAxes {
  id: string;
  key: string;
  label: Record<string, string>;
  valueType: string;
  position: number;
}

/**
 * The variant axes of an attribute set: its attributes that are flagged as variant axes, in the
 * set's order. Options are filled in separately (they are a read per attribute).
 */
export function selectVariantAxes(
  setAttributes: readonly SetAttributeForAxes[],
  axisAttributeIds: ReadonlySet<string>,
  language: string,
): VariantAxis[] {
  return [...setAttributes]
    .filter((a) => axisAttributeIds.has(a.id) && !NON_AXIS_TYPES.has(a.valueType))
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
    .map((a) => ({
      id: a.id,
      key: a.key,
      label: pickAttributeLabel(a.label, a.key, language),
      valueType: a.valueType,
      options: null,
    }));
}

/** The form state of the axis controls: the raw control value per axis key, `''` when unset. */
export type VariantAxisDraft = Record<string, string>;

export interface BuiltVariantValues {
  values: Record<string, unknown>;
  /** Axis keys without a value. */
  missing: string[];
  /** Axis keys whose value is no option of the attribute, or no number. */
  invalid: string[];
}

function parseNumber(raw: string): number | null {
  const normalised = raw.replace(/\s+/g, '').replace(',', '.');
  if (normalised === '') return null;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/**
 * The `variantAttributeValues` the axis controls describe. `base` is the variant's stored values,
 * when editing: a stored key that is no axis is kept, so an edit never drops data the tab does
 * not show.
 */
export function buildVariantAttributeValues(
  axes: readonly VariantAxis[],
  draft: VariantAxisDraft,
  base: Record<string, unknown> = {},
): BuiltVariantValues {
  const values: Record<string, unknown> = { ...base };
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const axis of axes) {
    const raw = (draft[axis.key] ?? '').trim();
    if (raw === '') {
      missing.push(axis.key);
      delete values[axis.key];
      continue;
    }
    if (axis.valueType === 'boolean') {
      values[axis.key] = raw === 'true';
    } else if (axis.valueType === 'number' || axis.valueType === 'price') {
      const n = parseNumber(raw);
      if (n === null) invalid.push(axis.key);
      else values[axis.key] = n;
    } else if (axis.options && OPTION_VALUE_TYPES.has(axis.valueType)) {
      if (!axis.options.some((o) => o.value === raw)) invalid.push(axis.key);
      else values[axis.key] = raw;
    } else {
      values[axis.key] = raw;
    }
  }
  return { values, missing, invalid };
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** The axis controls' state for a stored variant. */
export function draftFromVariantValues(axes: readonly VariantAxis[], values: Record<string, unknown>): VariantAxisDraft {
  const draft: VariantAxisDraft = {};
  for (const axis of axes) {
    const value = values[axis.key];
    if (axis.valueType === 'boolean') {
      const b = asBoolean(value);
      draft[axis.key] = b === null ? '' : String(b);
    } else if (typeof value === 'string' || typeof value === 'number') {
      draft[axis.key] = String(value);
    } else {
      draft[axis.key] = '';
    }
  }
  return draft;
}

/** A stored axis value as the table shows it: the option label in the admin language, Yes / No, or the value. */
export function formatVariantAxisValue(
  axis: VariantAxis,
  value: unknown,
  labels: { yes: string; no: string; empty: string },
): string {
  if (value === null || value === undefined || value === '') return labels.empty;
  if (axis.valueType === 'boolean') {
    const b = asBoolean(value);
    if (b !== null) return b ? labels.yes : labels.no;
  }
  if (axis.options) {
    const option = axis.options.find((o) => o.value === String(value));
    if (option) return option.label;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** The stored keys no axis names (data written before the axes were enforced), sorted. */
export function unknownVariantKeys(
  axes: readonly VariantAxis[],
  variants: ReadonlyArray<{ variantAttributeValues: Record<string, unknown> }>,
): string[] {
  const axisKeys = new Set(axes.map((a) => a.key));
  const keys = new Set<string>();
  for (const v of variants) {
    for (const key of Object.keys(v.variantAttributeValues)) if (!axisKeys.has(key)) keys.add(key);
  }
  return [...keys].sort();
}

/** The variant that already holds the same value on every axis, ignoring `exceptId`; `null` when none. */
export function findVariantWithSameValues<V extends { id: string; variantAttributeValues: Record<string, unknown> }>(
  axes: readonly VariantAxis[],
  variants: readonly V[],
  values: Record<string, unknown>,
  exceptId?: string,
): V | null {
  if (axes.length === 0) return null;
  return (
    variants.find(
      (v) => v.id !== exceptId && axes.every((axis) => String(v.variantAttributeValues[axis.key]) === String(values[axis.key])),
    ) ?? null
  );
}
