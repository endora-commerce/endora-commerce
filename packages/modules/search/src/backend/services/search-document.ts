import { effectiveScopedValue, effectiveSystemText, type OverrideRow, type ScopeLevel } from '@endora-commerce/contracts';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/contracts/search-index.md`, FR-033) — the
 * language-keyed half of a channel index document, and the field paths a query names.
 *
 * One index per sales channel stays. Each document carries `texts.<L>` for **every language the
 * channel offers** — not only the live ones, so a language that turns live needs no reindex of
 * text — each holding the product's name, description and searchable text attributes effective
 * at (channel, L) along C×L → C → Global, and the option labels of its searchable select
 * attributes in L. A query in language L searches `texts.<L>.*` only: a Polish shopper typing
 * "drill" does not find "Wiertarka X" through its English name.
 */

/** One language's texts of a document. `''` = nothing at this scope (none, or an empty override). */
export interface DocumentTexts {
  name: string;
  description: string;
  /** Searchable text attributes, effective at (C, L). */
  attributes: Record<string, string>;
  /** Option labels of the searchable select attributes the product carries, in L. */
  options: string[];
}

/** A text attribute that is searched, with the scope set its definition derives (R15). */
export interface SearchableTextAttribute {
  key: string;
  scopeLevels: readonly ScopeLevel[];
}

/**
 * The languages an index carries texts for: the channel's languages, with its default language
 * first when the list does not name it (a channel whose list is empty still has the default).
 */
export function indexLanguagesOf(channel: { languages: readonly string[]; defaultLanguage: string }): string[] {
  const out: string[] = [];
  for (const language of [channel.defaultLanguage, ...channel.languages]) {
    if (language && !out.includes(language)) out.push(language);
  }
  return out;
}

/**
 * The document's `texts`, one entry per language. `overrides` may hold rows of other channels;
 * only `channelId`'s are read. `optionLabels`: language → attribute key → option value → label.
 */
export function documentTexts(
  product: { name: string; description: string | null; attributeValues: Readonly<Record<string, unknown>> },
  input: {
    channelId: string;
    languages: readonly string[];
    overrides: readonly OverrideRow[];
    textAttributes: readonly SearchableTextAttribute[];
    optionLabels: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, string>>>;
  },
): Record<string, DocumentTexts> {
  const rows = input.overrides.filter((row) => row.channelId === input.channelId);
  const out: Record<string, DocumentTexts> = {};
  for (const languageCode of input.languages) {
    const ctx = { channelId: input.channelId, languageCode };
    const attributes: Record<string, string> = {};
    for (const attribute of input.textAttributes) {
      const value = effectiveScopedValue(
        rows,
        attribute.key,
        attribute.scopeLevels,
        ctx,
        product.attributeValues[attribute.key],
      );
      if (typeof value === 'string' && value !== '') attributes[attribute.key] = value;
    }
    const options: string[] = [];
    for (const [key, labels] of input.optionLabels.get(languageCode) ?? []) {
      const raw = product.attributeValues[key];
      for (const value of Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]) {
        const label = labels.get(String(value));
        if (label) options.push(label);
      }
    }
    out[languageCode] = {
      name: effectiveSystemText(rows, 'name', ctx, product.name) ?? '',
      description: effectiveSystemText(rows, 'description', ctx, product.description) ?? '',
      attributes,
      options,
    };
  }
  return out;
}

/**
 * The document's `attributes`: every value a filter or a non-text search may name, flattened as
 * before. The values of `textKeys` — searchable text attributes no filter names — are left out:
 * their text lives in `texts.<L>.attributes`, at the shopper's language.
 */
export function documentAttributes(
  values: Readonly<Record<string, unknown>>,
  textKeys: ReadonlySet<string>,
): Record<string, string | number | boolean | string[] | null> {
  const out: Record<string, string | number | boolean | string[] | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (textKeys.has(key)) continue;
    if (value === null || value === undefined) out[key] = null;
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    // Issue #684 — a multiselect is the array of its options, so `attributes.<key> = "<option>"`
    // matches any of them.
    else if (Array.isArray(value)) out[key] = value.map(String);
    // Unexpected shapes as JSON, so the document still upserts.
    else out[key] = JSON.stringify(value);
  }
  return out;
}

/**
 * What a query in `languageCode` searches (§3). The caller validates `languageCode` against the
 * channel's languages **before** it reaches a field path (R21).
 */
export function attributesToSearchOnFor(languageCode: string, searchableNonTextKeys: readonly string[]): string[] {
  return [
    `texts.${languageCode}.name`,
    `texts.${languageCode}.description`,
    `texts.${languageCode}.attributes`,
    `texts.${languageCode}.options`,
    'sku',
    ...searchableNonTextKeys.map((key) => `attributes.${key}`),
  ];
}

/** The searchable attributes of a channel index (§2): the language-keyed texts, the SKU, the values. */
export const SEARCHABLE_ATTRIBUTES = ['sku', 'texts', 'attributes'] as const;

/** The field a document is sorted by name on, in `languageCode`. */
export function nameSortField(languageCode: string): `texts.${string}.name` {
  return `texts.${languageCode}.name`;
}

/** The sortable attributes of a channel index carrying `languages` (issue #287, feature 172). */
export function sortableAttributesFor(languages: readonly string[]): string[] {
  return ['createdAt', ...languages.map(nameSortField)];
}
