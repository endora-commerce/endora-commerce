/**
 * Issue #1527 (UX audit CAT-12) — the pure half of the attribute list: what a
 * search and a type filter keep, which capabilities a row shows as badges, and
 * which translation key names a value type. Kept out of the page so it is
 * testable without rendering.
 */
import { foldDiacritics } from '@endora-commerce/contracts';

/** DB-level value types (feature 002, 061, 172). */
export const VALUE_TYPES = ['string', 'number', 'boolean', 'enum', 'select', 'multiselect', 'price', 'page_builder'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

/** The boolean capabilities of an attribute, in the order the list and the editor show them. */
export const ATTRIBUTE_CAPABILITIES = [
  'isSearchable',
  'isFilterable',
  'isVariantAxis',
  'isComparable',
  'massEditable',
  'quickSearchable',
  'isPromoRule',
  'isPriceRule',
] as const;
export type AttributeCapability = (typeof ATTRIBUTE_CAPABILITIES)[number];

/** The short name of each capability: a list badge and the editor group's entries share it. */
export const CAPABILITY_LABEL_KEYS: Record<AttributeCapability, string> = {
  isSearchable: 'attributes.column.searchable',
  isFilterable: 'attributes.column.filterable',
  isVariantAxis: 'attributes.column.variantAxis',
  isComparable: 'attributes.column.comparable',
  massEditable: 'attributes.column.massEditable',
  quickSearchable: 'attributes.column.quickSearchable',
  isPromoRule: 'attributes.column.promoRule',
  isPriceRule: 'attributes.column.priceRule',
};

export type AttributeListEntry = {
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: ValueType;
} & Record<AttributeCapability, boolean>;

export interface AttributeListFilter {
  /** What the operator typed; trimmed and folded here. */
  query: string;
  /** `''` for every type. */
  valueType: ValueType | '';
}

/**
 * Lower case, no diacritics, trimmed (Postel): the repository's one fold,
 * which also maps `ł` — a letter NFD leaves standing.
 */
export function foldForSearch(text: string): string {
  return foldDiacritics(text).trim();
}

/** Does the attribute pass the list's search (key and every label) and type filter? */
export function attributeMatches(entry: AttributeListEntry, filter: AttributeListFilter): boolean {
  if (filter.valueType !== '' && entry.valueType !== filter.valueType) return false;
  const needle = foldForSearch(filter.query);
  if (needle === '') return true;
  return [entry.key, entry.labelDefault, ...Object.values(entry.label)].some((text) =>
    foldForSearch(text).includes(needle),
  );
}

/** The capabilities switched on, in {@link ATTRIBUTE_CAPABILITIES} order. */
export function enabledCapabilities(entry: Record<AttributeCapability, boolean>): AttributeCapability[] {
  return ATTRIBUTE_CAPABILITIES.filter((capability) => entry[capability]);
}

/** The catalog bundle key naming a value type — the operator's word, not the stored enum. */
export function valueTypeLabelKey(valueType: ValueType): string {
  return valueType === 'page_builder' ? 'attributes.type.pageBuilder' : `attributes.type.${valueType}`;
}
